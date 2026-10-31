import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { api, bearer } from "./helpers/apiClient.js";
import { uniqueDomain } from "./helpers/domainVerification.js";
import {
  createOrganization,
  createTestUser,
  destroyOrganization,
  destroyTestUser,
  type TestUser,
} from "./helpers/tenants.js";
import { supabaseAdmin, supabaseForUser } from "../src/config/supabase.js";
import { processOsintJob } from "../src/jobs/osintProcessor.js";
import { purgeOsintData } from "../src/services/dataRetentionEngine.js";
import { breachesSource, maskAlias } from "../src/services/osint/breaches.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RAW_ALIAS = "juan.perez";

describe("Módulo C (C3): brechas", () => {
  let hibp: Server;
  let hibpHits: string[];
  let lastApiKey: string | undefined;
  let domainResponses: Map<string, { status: number; body: string }>;
  let catalogStatus: number;
  let orgId: string;
  let otherOrgId: string;
  let ciso: TestUser;
  let auditor: TestUser;
  let viewer: TestUser;
  let otherCiso: TestUser;

  async function run(domain: string, auditId?: string) {
    const { data: asset, error: assetError } = await supabaseAdmin
      .from("assets")
      .upsert(
        { type: "domain", value: domain, organization_id: orgId, created_by: ciso.userId, verification_status: "verified" },
        { onConflict: "organization_id,type,value" }
      )
      .select("id")
      .single();
    if (assetError || !asset) throw new Error(`Activo de test: ${assetError?.message}`);

    const audit =
      auditId ??
      (
        await api
          .post("/api/v1/audits")
          .set("Authorization", bearer(ciso.accessToken))
          .send({ title: "Brechas - QA", framework: "iso27001" })
      ).body.data.id;
    const { data: runRow } = await supabaseAdmin
      .from("osint_runs")
      .insert({ organization_id: orgId, audit_id: audit })
      .select("id")
      .single();

    const status = await processOsintJob(
      {
        organizationId: orgId,
        auditId: audit,
        osintRunId: runRow!.id,
        actorId: ciso.userId,
        domains: [{ assetId: asset.id, value: domain }],
      },
      [breachesSource]
    );
    const { data: stored } = await supabaseAdmin
      .from("osint_runs")
      .select("status, source_status, summary")
      .eq("id", runRow!.id)
      .single();
    const { data: findings } = await supabaseAdmin
      .from("findings")
      .select("source_engine, title, severity, detail, remediation")
      .eq("audit_id", audit);
    return {
      status,
      auditId: audit as string,
      runId: runRow!.id as string,
      source: stored!.source_status[domain].breaches,
      summary: stored!.summary,
      findings: findings ?? [],
    };
  }

  beforeAll(async () => {
    hibp = createServer((req, res) => {
      const path = req.url ?? "";
      hibpHits.push(path);
      res.setHeader("Content-Type", "application/json");

      if (path === "/breaches") {
        res.statusCode = catalogStatus;
        res.end(
          JSON.stringify([
            { Name: "Vieja", BreachDate: "2015-01-01" },
            { Name: "Reciente", BreachDate: new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10) },
          ])
        );
        return;
      }
      lastApiKey = req.headers["hibp-api-key"] as string | undefined;
      const domain = decodeURIComponent(path.replace("/breacheddomain/", ""));
      const response = domainResponses.get(domain) ?? { status: 404, body: "" };
      res.statusCode = response.status;
      res.end(response.body);
    });
    await new Promise<void>((resolve) => hibp.listen(0, "127.0.0.1", resolve));
    process.env.OSINT_HIBP_BASE_URL = `http://127.0.0.1:${(hibp.address() as AddressInfo).port}`;
    domainResponses = new Map();

    orgId = await createOrganization("QA Org - Brechas");
    otherOrgId = await createOrganization("QA Org B - Brechas");
    ciso = await createTestUser(orgId, "ciso-brechas", "ciso");
    auditor = await createTestUser(orgId, "auditor-brechas", "auditor");
    viewer = await createTestUser(orgId, "viewer-brechas", "viewer");
    otherCiso = await createTestUser(otherOrgId, "ciso-b-brechas", "ciso");
  }, 60000);

  beforeEach(() => {
    hibpHits = [];
    catalogStatus = 200;
    process.env.HIBP_API_KEY = "clave-de-prueba";
  });

  afterAll(async () => {
    delete process.env.HIBP_API_KEY;
    delete process.env.OSINT_HIBP_BASE_URL;
    await new Promise((resolve) => hibp.close(resolve));
    await Promise.all([ciso, auditor, viewer, otherCiso].map(destroyTestUser));
    await Promise.all([destroyOrganization(orgId), destroyOrganization(otherOrgId)]);
  }, 60000);

  test("TC-OSINT-07: sin HIBP_API_KEY no consulta nada y la corrida termina bien", async () => {
    delete process.env.HIBP_API_KEY;
    const result = await run(uniqueDomain());

    expect(result.status).toBe("completed");
    expect(result.source.status).toBe("not_configured");
    expect(result.findings).toEqual([]);
    expect(hibpHits).toEqual([]);

    const { data: logs } = await supabaseAdmin
      .from("audit_logs")
      .select("id")
      .eq("resource_id", result.runId)
      .eq("action", "OSINT_SOURCE_NOT_CONFIGURED");
    expect(logs).toHaveLength(1);
  });

  test("TC-OSINT-06: el alias crudo no queda en ninguna tabla y el viewer no ve las cuentas", async () => {
    const domain = uniqueDomain();
    domainResponses.set(domain, {
      status: 200,
      body: JSON.stringify({ [RAW_ALIAS]: ["Vieja"], maria: ["Vieja", "Reciente"] }),
    });

    const result = await run(domain);
    expect(result.status).toBe("completed");
    expect(result.source).toMatchObject({ status: "ok", cached: false });
    expect(lastApiKey).toBe("clave-de-prueba");

    const { data: rows } = await supabaseAdmin
      .from("osint_breach_exposures")
      .select("alias_masked, breaches")
      .eq("osint_run_id", result.runId)
      .order("alias_masked");
    expect(rows).toEqual([
      { alias_masked: `j***@${domain}`, breaches: ["Vieja"] },
      { alias_masked: `m***@${domain}`, breaches: ["Vieja", "Reciente"] },
    ]);

    const { data: cache } = await supabaseAdmin.from("osint_source_cache").select("*").eq("organization_id", orgId);
    const { data: run_ } = await supabaseAdmin.from("osint_runs").select("*").eq("id", result.runId);
    const { data: logs } = await supabaseAdmin.from("audit_logs").select("*").eq("resource_id", result.runId);
    const everything = JSON.stringify([rows, cache, run_, logs, result.findings]);
    expect(everything).not.toContain(RAW_ALIAS);
    expect(everything).not.toContain("maria");

    const breaches = (user: TestUser) =>
      api.get(`/api/v1/audits/${result.auditId}/osint/breaches`).set("Authorization", bearer(user.accessToken));

    const own = await breaches(auditor);
    expect(own.status).toBe(200);
    expect(own.body.data).toEqual({
      accounts: 2,
      breaches: ["Reciente", "Vieja"],
      exposures: expect.arrayContaining([{ alias_masked: `j***@${domain}`, breaches: ["Vieja"] }]),
    });

    const denied = await breaches(viewer);
    expect(denied.status).toBe(403);
    expect((await breaches(otherCiso)).status).toBe(404);

    const { data: viewerRows } = await supabaseForUser(viewer.accessToken).from("osint_breach_exposures").select("id");
    expect(viewerRows).toEqual([]);
  });

  test("TC-OSINT-25: severidad según la fecha, y el hallazgo trae conteo, brechas y atribución", async () => {
    const recent = uniqueDomain();
    domainResponses.set(recent, { status: 200, body: JSON.stringify({ ana: ["Reciente"] }) });
    const recentResult = await run(recent);
    expect(recentResult.findings).toHaveLength(1);
    expect(recentResult.findings[0]).toMatchObject({
      source_engine: "osint-breach",
      title: "Cuentas del dominio en brechas públicas",
      severity: "high",
    });
    expect(recentResult.findings[0]!.detail).toContain("1 cuenta(s)");
    expect(recentResult.findings[0]!.detail).toContain("Reciente");
    expect(recentResult.findings[0]!.detail).toContain("haveibeenpwned.com");
    expect(recentResult.summary.domains[recent].breaches).toEqual({ accounts: 1, breaches: ["Reciente"], recent: true });

    const old = uniqueDomain();
    domainResponses.set(old, { status: 200, body: JSON.stringify({ ana: ["Vieja"] }) });
    expect((await run(old)).findings[0]!.severity).toBe("medium");
  });

  test("TC-OSINT-26: sin catálogo informa igual, con la severidad menor", async () => {
    await supabaseAdmin.from("osint_source_cache").delete().eq("organization_id", orgId).eq("query_key", "catalog");
    catalogStatus = 500;
    const domain = uniqueDomain();
    domainResponses.set(domain, { status: 200, body: JSON.stringify({ ana: ["Reciente"] }) });

    const result = await run(domain);
    expect(result.source.status).toBe("ok");
    expect(result.findings[0]!.severity).toBe("medium");
  }, 30000);

  test("TC-OSINT-27: sin resultados, con caché y con errores de HIBP", async () => {
    const clean = uniqueDomain();
    const noData = await run(clean);
    expect(noData.source.status).toBe("no_data");
    expect(noData.findings).toEqual([]);
    expect(hibpHits).toEqual([`/breacheddomain/${clean}`]);

    hibpHits = [];
    const again = await run(clean);
    expect(again.source).toMatchObject({ status: "no_data", cached: true });
    expect(hibpHits).toEqual([]);

    const unverified = uniqueDomain();
    domainResponses.set(unverified, { status: 403, body: "" });
    const rejected = await run(unverified);
    expect(rejected.status).toBe("failed");
    expect(rejected.source.detail).toContain("verificado");
    expect(JSON.stringify(rejected.source)).not.toContain("clave-de-prueba");
    expect(hibpHits.filter((path) => path.includes(unverified))).toHaveLength(1);

    expect(maskAlias(" Juan.Perez ", "empresa.cl")).toBe("j***@empresa.cl");
    expect(maskAlias("", "empresa.cl")).toBe("****@empresa.cl");
  }, 30000);

  test("TC-OSINT-28: la purga respeta la política, aplica el tope sin política y deja lo reciente", async () => {
    const withPolicyOrg = await createOrganization("QA Org - Purga con política");
    const withoutPolicyOrg = await createOrganization("QA Org - Purga sin política");
    await supabaseAdmin.from("organizations").update({ retention_period_days: 30 }).eq("id", withPolicyOrg);

    try {
      async function seedExposures(organizationId: string) {
        const owner = await createTestUser(organizationId, "ciso-purga", "ciso");
        const { data: audit } = await supabaseAdmin
          .from("audits")
          .insert({ title: "Purga", framework: "iso27001", status: "draft", organization_id: organizationId, created_by: owner.userId })
          .select("id")
          .single();
        const { data: runRow } = await supabaseAdmin
          .from("osint_runs")
          .insert({ organization_id: organizationId, audit_id: audit!.id, status: "completed" })
          .select("id")
          .single();
        const row = (label: string, ageDays: number) => ({
          organization_id: organizationId,
          audit_id: audit!.id,
          osint_run_id: runRow!.id,
          alias_masked: `${label}***@purga.test`,
          created_at: new Date(Date.now() - ageDays * DAY_MS).toISOString(),
        });
        const { error } = await supabaseAdmin
          .from("osint_breach_exposures")
          .insert([row("a", 10), row("b", 60), row("c", 400)]);
        if (error) throw new Error(error.message);
        await supabaseAdmin.from("osint_source_cache").insert([
          { organization_id: organizationId, source: "ct", query_key: "viva", payload: {}, expires_at: new Date(Date.now() + DAY_MS).toISOString() },
          { organization_id: organizationId, source: "ct", query_key: "vencida", payload: {}, expires_at: new Date(Date.now() - DAY_MS).toISOString() },
        ]);
        return owner;
      }

      const owners = [await seedExposures(withPolicyOrg), await seedExposures(withoutPolicyOrg)];
      const result = await purgeOsintData();
      expect(result.failures).toEqual([]);
      expect(result.breachRowsPurged).toBeGreaterThanOrEqual(3);

      const remaining = async (organizationId: string) => {
        const { data } = await supabaseAdmin
          .from("osint_breach_exposures")
          .select("alias_masked")
          .eq("organization_id", organizationId)
          .order("alias_masked");
        return data?.map((row) => row.alias_masked);
      };
      // 30 días de política: solo queda la de 10.
      expect(await remaining(withPolicyOrg)).toEqual(["a***@purga.test"]);
      // Sin política manda el tope de 365 días.
      expect(await remaining(withoutPolicyOrg)).toEqual(["a***@purga.test", "b***@purga.test"]);

      const { data: cache } = await supabaseAdmin
        .from("osint_source_cache")
        .select("query_key")
        .eq("organization_id", withoutPolicyOrg);
      expect(cache).toEqual([{ query_key: "viva" }]);

      const { data: logs } = await supabaseAdmin
        .from("audit_logs")
        .select("payload_after")
        .eq("organization_id", withPolicyOrg)
        .eq("action", "OSINT_DATA_PURGED");
      expect(logs).toEqual([{ payload_after: { breachRows: 2, cacheRows: 1, retentionDays: 30 } }]);

      await Promise.all(owners.map(destroyTestUser));
    } finally {
      await Promise.all([destroyOrganization(withPolicyOrg), destroyOrganization(withoutPolicyOrg)]);
    }
  }, 60000);
});
