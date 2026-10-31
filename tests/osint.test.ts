import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { api, bearer } from "./helpers/apiClient.js";
import {
  createOrganization,
  createTestUser,
  destroyOrganization,
  destroyTestUser,
  type TestUser,
} from "./helpers/tenants.js";
import { uniqueDomain } from "./helpers/domainVerification.js";
import { supabaseAdmin, supabaseForUser } from "../src/config/supabase.js";
import { osintQueue } from "../src/jobs/osintQueue.js";
import { finalOsintStatus, processOsintJob } from "../src/jobs/osintProcessor.js";
import { readOsintCache, writeOsintCache } from "../src/services/osint/cache.js";
import { OsintHttpError, osintFetch } from "../src/services/osint/httpClient.js";
import type { OsintSource } from "../src/services/osint/types.js";

describe("Módulo C (C0): fundaciones del reconocimiento pasivo", () => {
  let orgAId: string;
  let orgBId: string;
  let cisoA: TestUser;
  let viewerA: TestUser;
  let cisoB: TestUser;
  let verifiedAssetId: string;
  let verifiedDomain: string;
  let pendingAssetId: string;
  let foreignAssetId: string;
  let verifiedIpId: string;
  let auditId: string;

  async function insertAsset(user: TestUser, row: object): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from("assets")
      .insert({ organization_id: user.organizationId, created_by: user.userId, ...row })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el activo de test: ${error?.message}`);
    return data.id;
  }

  async function createAudit(user: TestUser): Promise<string> {
    const res = await api
      .post("/api/v1/audits")
      .set("Authorization", bearer(user.accessToken))
      .send({ title: "Auditoría OSINT - QA", framework: "iso27001" });
    return res.body.data.id;
  }

  function runOsint(user: TestUser, id: string, body: object) {
    return api.post(`/api/v1/audits/${id}/osint/run`).set("Authorization", bearer(user.accessToken)).send(body);
  }

  async function insertRun(organizationId: string, audit: string, status = "queued"): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from("osint_runs")
      .insert({ organization_id: organizationId, audit_id: audit, status })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la corrida de test: ${error?.message}`);
    return data.id;
  }

  beforeAll(async () => {
    orgAId = await createOrganization("QA Org A - OSINT");
    orgBId = await createOrganization("QA Org B - OSINT");
    cisoA = await createTestUser(orgAId, "ciso-a-osint", "ciso");
    viewerA = await createTestUser(orgAId, "viewer-a-osint", "viewer");
    cisoB = await createTestUser(orgBId, "ciso-b-osint", "ciso");

    verifiedDomain = uniqueDomain();
    verifiedAssetId = await insertAsset(cisoA, { type: "domain", value: verifiedDomain, verification_status: "verified" });
    pendingAssetId = await insertAsset(cisoA, { type: "domain", value: uniqueDomain() });
    verifiedIpId = await insertAsset(cisoA, { type: "ip", value: "203.0.113.40", verification_status: "verified" });
    foreignAssetId = await insertAsset(cisoB, { type: "domain", value: uniqueDomain(), verification_status: "verified" });
    auditId = await createAudit(cisoA);
  }, 60000);

  afterAll(async () => {
    await Promise.all([cisoA, viewerA, cisoB].map(destroyTestUser));
    await Promise.all([destroyOrganization(orgAId), destroyOrganization(orgBId)]);
  }, 60000);

  test("TC-OSINT-01: sin verificar, ajeno e inexistente reciben la misma respuesta y quedan auditados", async () => {
    const pending = await runOsint(cisoA, auditId, { asset_ids: [pendingAssetId] });
    const foreign = await runOsint(cisoA, auditId, { asset_ids: [foreignAssetId] });
    const missing = await runOsint(cisoA, auditId, { asset_ids: [randomUUID()] });

    expect(pending.status).toBe(403);
    expect(pending.body.error.code).toBe("UNAUTHORIZED_SCAN_TARGET");
    expect(foreign.status).toBe(403);
    expect(foreign.body).toEqual(pending.body);
    expect(missing.status).toBe(403);
    expect(missing.body).toEqual(pending.body);

    const { data: logs } = await supabaseAdmin
      .from("audit_logs")
      .select("id")
      .eq("resource_id", auditId)
      .eq("action", "UNAUTHORIZED_OSINT_BLOCKED");
    expect(logs).toHaveLength(3);

    const { count } = await supabaseAdmin
      .from("osint_runs")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);
    expect(count).toBe(0);
  });

  test("TC-OSINT-02: solo aplica a dominios, y un viewer no puede lanzarlo", async () => {
    const ip = await runOsint(cisoA, auditId, { asset_ids: [verifiedIpId] });
    expect(ip.status).toBe(422);
    expect(ip.body.error.code).toBe("OSINT_REQUIRES_DOMAIN");

    const viewer = await runOsint(viewerA, auditId, {});
    expect(viewer.status).toBe(403);
    expect(viewer.body.error.code).toBe("FORBIDDEN");

    const emptyOrgId = await createOrganization("QA Org C - OSINT");
    const emptyCiso = await createTestUser(emptyOrgId, "ciso-c-osint", "ciso");
    try {
      const noDomains = await runOsint(emptyCiso, await createAudit(emptyCiso), {});
      expect(noDomains.status).toBe(422);
      expect(noDomains.body.error.code).toBe("NO_VERIFIED_DOMAINS");
    } finally {
      await destroyTestUser(emptyCiso);
      await destroyOrganization(emptyOrgId);
    }
  });

  test("TC-OSINT-03: encola la corrida, y un segundo pedido se rechaza", async () => {
    const res = await runOsint(cisoA, auditId, {});
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ status: "queued", domains: [verifiedDomain] });
    expect(res.body.data.jobId).toBeTruthy();

    const job = await osintQueue.getJob(res.body.data.jobId);
    expect(job?.data).toMatchObject({
      organizationId: orgAId,
      auditId,
      osintRunId: res.body.data.osintRunId,
      actorId: cisoA.userId,
      domains: [{ assetId: verifiedAssetId, value: verifiedDomain }],
    });

    const again = await runOsint(cisoA, auditId, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("OSINT_ALREADY_IN_PROGRESS");

    const otherAudit = await createAudit(cisoA);
    const concurrent = await runOsint(cisoA, otherAudit, {});
    expect(concurrent.status).toBe(429);
    expect(concurrent.body.error.code).toBe("ORG_OSINT_CONCURRENCY_LIMIT");

    const status = await api.get(`/api/v1/audits/${auditId}/osint`).set("Authorization", bearer(viewerA.accessToken));
    expect(status.status).toBe(200);
    expect(status.body.data.latest).toMatchObject({ id: res.body.data.osintRunId, status: "queued" });

    await job?.remove();
    await supabaseAdmin.from("osint_runs").update({ status: "failed" }).eq("id", res.body.data.osintRunId);
  });

  test("TC-OSINT-04: otra organización no ve nada, y la caché es solo del backend", async () => {
    const runId = await insertRun(orgAId, auditId, "completed");
    await supabaseAdmin.from("osint_discovered_subdomains").insert({
      organization_id: orgAId,
      audit_id: auditId,
      osint_run_id: runId,
      hostname: `app.${verifiedDomain}`,
    });
    await supabaseAdmin.from("osint_breach_exposures").insert({
      organization_id: orgAId,
      audit_id: auditId,
      osint_run_id: runId,
      alias_masked: `j***@${verifiedDomain}`,
    });
    await writeOsintCache(orgAId, "ct", verifiedDomain, { hosts: [] });

    const denied = await api.get(`/api/v1/audits/${auditId}/osint`).set("Authorization", bearer(cisoB.accessToken));
    expect(denied.status).toBe(404);
    expect((await runOsint(cisoB, auditId, {})).status).toBe(404);

    const other = supabaseForUser(cisoB.accessToken);
    for (const table of ["osint_runs", "osint_discovered_subdomains", "osint_breach_exposures", "osint_source_cache"]) {
      const { data, error } = await other.from(table).select("id").eq("organization_id", orgAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }

    const own = supabaseForUser(cisoA.accessToken);
    const { data: ownCache } = await own.from("osint_source_cache").select("id");
    expect(ownCache).toEqual([]);
    const { data: ownBreaches } = await own.from("osint_breach_exposures").select("id");
    expect(ownBreaches).toHaveLength(1);

    const { data: viewerBreaches } = await supabaseForUser(viewerA.accessToken).from("osint_breach_exposures").select("id");
    expect(viewerBreaches).toEqual([]);

    const { error: writeError } = await own.from("osint_runs").insert({ organization_id: orgAId, audit_id: auditId });
    expect(writeError).not.toBeNull();
  });

  test("TC-OSINT-10: una fuente que falla no tumba a las demás ni toca el Módulo A", async () => {
    const audit = await createAudit(cisoA);
    const runId = await insertRun(orgAId, audit);
    const { data: before } = await supabaseAdmin.from("audits").select("status").eq("id", audit).single();

    const working: OsintSource = {
      id: "email_dns",
      run: async (context) => ({
        status: "ok",
        findings: [
          {
            audit_id: context.auditId,
            asset_id: context.assetId,
            source_engine: "osint-email-dns",
            title: "Sin DMARC",
            severity: "high",
            detail: "No hay registro DMARC",
            remediation: "Publicar DMARC",
          },
        ],
      }),
    };
    const broken: OsintSource = {
      id: "ct",
      run: async () => {
        throw new Error("fuente caída");
      },
    };

    const status = await processOsintJob(
      {
        organizationId: orgAId,
        auditId: audit,
        osintRunId: runId,
        actorId: cisoA.userId,
        domains: [{ assetId: verifiedAssetId, value: verifiedDomain }],
      },
      [working, broken]
    );
    expect(status).toBe("partial");

    const { data: run } = await supabaseAdmin
      .from("osint_runs")
      .select("status, source_status, summary, finished_at")
      .eq("id", runId)
      .single();
    expect(run?.status).toBe("partial");
    expect(run?.finished_at).not.toBeNull();
    expect(run?.summary).toEqual({ findingsCount: 1 });
    expect(run?.source_status[verifiedDomain].ct).toMatchObject({ status: "failed", detail: "fuente caída" });
    expect(run?.source_status[verifiedDomain].email_dns).toMatchObject({ status: "ok", cached: false });

    const { data: findings } = await supabaseAdmin.from("findings").select("source_engine").eq("audit_id", audit);
    expect(findings).toEqual([{ source_engine: "osint-email-dns" }]);

    const { data: after } = await supabaseAdmin.from("audits").select("status").eq("id", audit).single();
    expect(after?.status).toBe(before?.status);
    const { count: scanRuns } = await supabaseAdmin
      .from("scan_runs")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", audit);
    expect(scanRuns).toBe(0);

    const { data: logs } = await supabaseAdmin
      .from("audit_logs")
      .select("payload_after")
      .eq("resource_id", runId)
      .eq("action", "OSINT_SOURCE_EXECUTED");
    expect(logs).toHaveLength(2);
    expect((logs![0]!.payload_after as { findingsHash: string }).findingsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("TC-OSINT-11: estado final de una corrida", () => {
    expect(finalOsintStatus([])).toBe("completed");
    expect(finalOsintStatus(["ok", "no_data", "not_configured"])).toBe("completed");
    expect(finalOsintStatus(["ok", "partial"])).toBe("partial");
    expect(finalOsintStatus(["ok", "failed"])).toBe("partial");
    expect(finalOsintStatus(["failed", "failed"])).toBe("failed");
    expect(finalOsintStatus(["failed", "not_configured"])).toBe("partial");
  });

  test("TC-OSINT-12: la corrida de una auditoría borrada no falla el worker", async () => {
    await expect(
      processOsintJob({
        organizationId: orgAId,
        auditId,
        osintRunId: randomUUID(),
        actorId: cisoA.userId,
        domains: [],
      })
    ).resolves.toBe("failed");
  });

  test("TC-OSINT-13: la caché vence y no se comparte entre organizaciones", async () => {
    const key = uniqueDomain();
    await writeOsintCache(orgAId, "wayback", key, { urls: ["uno"] });
    await writeOsintCache(orgAId, "wayback", key, { urls: ["dos"] });

    await expect(readOsintCache(orgAId, "wayback", key)).resolves.toEqual({ urls: ["dos"] });
    await expect(readOsintCache(orgBId, "wayback", key)).resolves.toBeNull();

    await supabaseAdmin
      .from("osint_source_cache")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("organization_id", orgAId)
      .eq("query_key", key);
    await expect(readOsintCache(orgAId, "wayback", key)).resolves.toBeNull();
  });

  describe("TC-OSINT-14: cliente HTTP", () => {
    let server: Server;
    let baseUrl: string;
    let hits: Record<string, number>;
    let userAgent: string | undefined;

    beforeAll(async () => {
      server = createServer((req, res) => {
        const path = req.url ?? "";
        hits[path] = (hits[path] ?? 0) + 1;
        userAgent = req.headers["user-agent"];

        if (path === "/flaky" && hits[path]! < 3) {
          res.statusCode = 503;
          res.end();
        } else if (path === "/limited" && hits[path] === 1) {
          res.statusCode = 429;
          res.setHeader("Retry-After", "0");
          res.end();
        } else if (path === "/down") {
          res.statusCode = 500;
          res.end();
        } else if (path === "/missing") {
          res.statusCode = 404;
          res.end("nada");
        } else if (path === "/big") {
          res.end("x".repeat(2048));
        } else if (path === "/slow") {
          setTimeout(() => res.end("tarde"), 2000);
        } else {
          res.end("ok");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(() => {
      hits = {};
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });

    test("reintenta ante 5xx y 429, y se identifica", async () => {
      await expect(osintFetch(`${baseUrl}/flaky`, { baseDelayMs: 1 })).resolves.toEqual({ status: 200, body: "ok" });
      expect(hits["/flaky"]).toBe(3);
      expect(userAgent).toBe("AegisCyberAudit-OSINT/1.0");

      await expect(osintFetch(`${baseUrl}/limited`, { baseDelayMs: 1 })).resolves.toMatchObject({ status: 200 });
      expect(hits["/limited"]).toBe(2);
    });

    test("no reintenta un 404 y lo devuelve a la fuente", async () => {
      await expect(osintFetch(`${baseUrl}/missing`)).resolves.toEqual({ status: 404, body: "nada" });
      expect(hits["/missing"]).toBe(1);
    });

    test("agotados los intentos, lanza", async () => {
      await expect(osintFetch(`${baseUrl}/down`, { baseDelayMs: 1 })).rejects.toThrow(OsintHttpError);
      expect(hits["/down"]).toBe(3);
      await expect(osintFetch("http://127.0.0.1:1/", { baseDelayMs: 1 })).rejects.toThrow(OsintHttpError);
    });

    test("respeta el timeout y el tope de tamaño", async () => {
      await expect(osintFetch(`${baseUrl}/slow`, { timeoutMs: 50, retries: 0 })).rejects.toThrow(OsintHttpError);
      await expect(osintFetch(`${baseUrl}/big`, { maxBytes: 1024 })).rejects.toThrow("mayor a 1024 bytes");
      expect(hits["/big"]).toBe(1);
    });
  });
});
