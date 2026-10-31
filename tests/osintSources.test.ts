import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { api, bearer } from "./helpers/apiClient.js";
import { startDnsStub, type DnsRecords, type DnsStub } from "./helpers/dnsStub.js";
import { uniqueDomain } from "./helpers/domainVerification.js";
import {
  createOrganization,
  createTestUser,
  destroyOrganization,
  destroyTestUser,
  type TestUser,
} from "./helpers/tenants.js";
import { supabaseAdmin } from "../src/config/supabase.js";
import { processOsintJob } from "../src/jobs/osintProcessor.js";
import {
  buildArchiveFindings,
  buildCtFindings,
  buildEmailDnsFindings,
  classifyArchivedPath,
  type EmailDnsPosture,
} from "../src/services/findingsNormalization.js";
import { parseCrtShHosts } from "../src/services/osint/ctLogs.js";
import { parseCdxUrls } from "../src/services/osint/wayback.js";
import { isPublicIp } from "../src/services/osint/subdomainResolve.js";

const found = (...records: string[]) => ({ status: "found" as const, records });
const none = { status: "none" as const, records: [] };
const failed = { status: "error" as const, records: [] };

const SAFE_POSTURE: EmailDnsPosture = {
  spf: found("v=spf1 include:_spf.google.com -all"),
  dmarc: found("v=DMARC1; p=reject; rua=mailto:dmarc@empresa.cl"),
  mx: found("mx.empresa.cl"),
  dkimSelectors: ["google"],
  dkimComplete: true,
};

function emailTitles(posture: Partial<EmailDnsPosture>) {
  return buildEmailDnsFindings("audit", "asset", "empresa.cl", { ...SAFE_POSTURE, ...posture }).findings.map(
    ({ title, severity }) => [title, severity]
  );
}

describe("Módulo C (C1): certificados y DNS de correo", () => {
  let dns: DnsStub;
  let crt: Server;
  let crtHits: Record<string, number>;
  let crtResponses: Map<string, string>;
  let cdxHits: Record<string, number>;
  const cdxResponses = new Map<string, string>();
  const cdxFailures = new Set<string>();
  const visitedPaths: string[] = [];
  let orgId: string;
  let otherOrgId: string;
  let ciso: TestUser;
  let viewer: TestUser;
  let otherCiso: TestUser;
  const records: Required<Pick<DnsRecords, "a" | "mx" | "txt" | "nxdomain" | "servfail">> = {
    a: new Map(),
    mx: new Map(),
    txt: new Map(),
    nxdomain: new Set(),
    servfail: new Set(),
  };

  async function insertDomain(value: string): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from("assets")
      .insert({
        type: "domain",
        value,
        organization_id: orgId,
        created_by: ciso.userId,
        verification_status: "verified",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Activo de test: ${error?.message}`);
    return data.id;
  }

  async function run(assetId: string, domain: string, auditId?: string) {
    const audit =
      auditId ??
      (
        await api
          .post("/api/v1/audits")
          .set("Authorization", bearer(ciso.accessToken))
          .send({ title: "Fuentes OSINT - QA", framework: "iso27001" })
      ).body.data.id;
    const { data: runRow, error } = await supabaseAdmin
      .from("osint_runs")
      .insert({ organization_id: orgId, audit_id: audit })
      .select("id")
      .single();
    if (error || !runRow) throw new Error(`Corrida de test: ${error?.message}`);

    const status = await processOsintJob({
      organizationId: orgId,
      auditId: audit,
      osintRunId: runRow.id,
      actorId: ciso.userId,
      domains: [{ assetId, value: domain }],
    });
    const { data: stored } = await supabaseAdmin
      .from("osint_runs")
      .select("source_status, summary")
      .eq("id", runRow.id)
      .single();
    const { data: findings } = await supabaseAdmin
      .from("findings")
      .select("id, source_engine, title, severity, status")
      .eq("audit_id", audit);
    return {
      status,
      auditId: audit as string,
      runId: runRow.id as string,
      sources: stored!.source_status[domain],
      summary: stored!.summary,
      findings: findings ?? [],
    };
  }

  function configureSecureDomain(domain: string) {
    records.txt.set(domain, ["v=spf1 -all"]);
    records.txt.set(`_dmarc.${domain}`, ["v=DMARC1; p=reject; rua=mailto:d@x.cl"]);
    records.txt.set(`google._domainkey.${domain}`, ["v=DKIM1; k=rsa; p=ABC"]);
    records.mx.set(domain, [`mx.${domain}`]);
  }

  beforeAll(async () => {
    dns = await startDnsStub(records);
    process.env.DNS_RESOLVER_SERVER = dns.server;

    crtResponses = new Map();
    crt = createServer((req, res) => {
      const parsed = new URL(req.url ?? "", "http://x");
      if (parsed.pathname === "/cdx/search/cdx") {
        const target = parsed.searchParams.get("url") ?? "";
        cdxHits[target] = (cdxHits[target] ?? 0) + 1;
        if (cdxFailures.has(target)) res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(cdxResponses.get(target) ?? "[]");
        return;
      }
      // Cualquier otra ruta sería visitar una URL del cliente: ver TC-OSINT-22.
      if (parsed.pathname !== "/") visitedPaths.push(parsed.pathname);
      const query = parsed.searchParams.get("q") ?? "";
      const domain = query.replace(/^%\./, "");
      crtHits[domain] = (crtHits[domain] ?? 0) + 1;
      res.setHeader("Content-Type", "application/json");
      res.end(crtResponses.get(domain) ?? "[]");
    });
    await new Promise<void>((resolve) => crt.listen(0, "127.0.0.1", resolve));
    process.env.OSINT_CRTSH_BASE_URL = `http://127.0.0.1:${(crt.address() as AddressInfo).port}`;
    process.env.OSINT_WAYBACK_BASE_URL = process.env.OSINT_CRTSH_BASE_URL;

    orgId = await createOrganization("QA Org - Fuentes OSINT");
    otherOrgId = await createOrganization("QA Org B - Fuentes OSINT");
    ciso = await createTestUser(orgId, "ciso-fuentes", "ciso");
    viewer = await createTestUser(orgId, "viewer-fuentes", "viewer");
    otherCiso = await createTestUser(otherOrgId, "ciso-b-fuentes", "ciso");
  }, 60000);

  beforeEach(() => {
    crtHits = {};
    cdxHits = {};
  });

  afterAll(async () => {
    delete process.env.DNS_RESOLVER_SERVER;
    delete process.env.OSINT_CRTSH_BASE_URL;
    delete process.env.OSINT_WAYBACK_BASE_URL;
    dns.close();
    await new Promise((resolve) => crt.close(resolve));
    await Promise.all([ciso, viewer, otherCiso].map(destroyTestUser));
    await Promise.all([destroyOrganization(orgId), destroyOrganization(otherOrgId)]);
  }, 60000);

  test("TC-OSINT-15: reglas de SPF, DMARC y DKIM", () => {
    expect(emailTitles({})).toEqual([]);

    expect(emailTitles({ spf: none })).toEqual([["Sin registro SPF", "high"]]);
    expect(emailTitles({ spf: found("v=spf1 +all") })).toEqual([["SPF permite enviar desde cualquier servidor", "high"]]);
    expect(emailTitles({ spf: found("v=spf1 ?all") })).toEqual([["SPF no bloquea remitentes no autorizados", "medium"]]);
    expect(emailTitles({ spf: found("v=spf1 a") })).toEqual([["SPF no bloquea remitentes no autorizados", "medium"]]);
    expect(emailTitles({ spf: found("v=spf1 -all", "v=spf1 ~all") })).toEqual([["Más de un registro SPF", "medium"]]);
    const manyLookups = `v=spf1 ${Array.from({ length: 11 }, (_, i) => `include:s${i}.cl`).join(" ")} -all`;
    expect(emailTitles({ spf: found(manyLookups) })).toEqual([["SPF con más de 10 consultas DNS", "medium"]]);
    // Un TXT que no es SPF no cuenta como SPF.
    expect(emailTitles({ spf: found("google-site-verification=abc") })).toEqual([["Sin registro SPF", "high"]]);

    expect(emailTitles({ dmarc: none })).toEqual([["Sin registro DMARC", "high"]]);
    expect(emailTitles({ dmarc: found("v=DMARC1; p=none; rua=mailto:a@b.cl") })).toEqual([
      ["DMARC solo observa y no bloquea", "medium"],
    ]);
    expect(emailTitles({ dmarc: found("v=DMARC1; p=quarantine; pct=50; rua=mailto:a@b.cl") })).toEqual([
      ["DMARC se aplica solo a parte del correo", "low"],
    ]);
    expect(emailTitles({ dmarc: found("v=DMARC1; p=reject") })).toEqual([["DMARC sin dirección de reportes", "low"]]);

    expect(emailTitles({ dkimSelectors: [] })).toEqual([["No se encontró DKIM en los selectores habituales", "low"]]);
  });

  test("TC-OSINT-16: una consulta caída nunca se informa como registro inexistente", () => {
    expect(emailTitles({ spf: failed, dmarc: failed })).toEqual([]);
    expect(emailTitles({ dkimSelectors: [], dkimComplete: false })).toEqual([]);
  });

  test("TC-OSINT-17: lectura de crt.sh y de direcciones", () => {
    const body = JSON.stringify([
      {
        name_value: "app.empresa.cl\n*.empresa.cl\nempresa.cl\nAPP.empresa.cl\notra.ejemplo.cl",
        not_before: "2025-03-01T00:00:00",
        entry_timestamp: "2025-03-02T10:00:00.123",
      },
      { name_value: "app.empresa.cl", not_before: "2024-01-01T00:00:00", entry_timestamp: "2026-01-01T00:00:00" },
      { name_value: "empresa.cl.evil.com", not_before: null, entry_timestamp: null },
    ]);
    expect(parseCrtShHosts(body, "empresa.cl")).toEqual([
      { hostname: "app.empresa.cl", firstSeen: "2024-01-01T00:00:00.000Z", lastSeen: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(() => parseCrtShHosts("<html>cortado</html>", "empresa.cl")).toThrow();

    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("2606:4700::1")).toBe(true);
    for (const ip of ["10.0.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "fd00::1", "::1", "no-es-ip"]) {
      expect(isPublicIp(ip)).toBe(false);
    }

    const titles = buildCtFindings("a", "b", "empresa.cl", ["app.empresa.cl", "dev-2.empresa.cl", "developer.empresa.cl"]);
    expect(titles.map(({ title, severity }) => [title, severity])).toEqual([
      ["Subdominios públicos fuera del inventario", "low"],
      ["Subdominios con nombre sensible", "medium"],
    ]);
    expect(titles[1]!.detail).toContain("dev-2.empresa.cl");
    expect(titles[1]!.detail).not.toContain("developer.empresa.cl");
    expect(buildCtFindings("a", "b", "empresa.cl", [])).toEqual([]);
  });

  test("TC-OSINT-05: con crt.sh caído termina parcial, con los hallazgos de correo y sin tocar la auditoría", async () => {
    const domain = uniqueDomain();
    const assetId = await insertDomain(domain);
    records.txt.set(`_dmarc.${domain}`, ["v=DMARC1; p=reject; rua=mailto:d@x.cl"]);
    records.mx.set(domain, [`mx.${domain}`]);

    const base = process.env.OSINT_CRTSH_BASE_URL;
    process.env.OSINT_CRTSH_BASE_URL = "http://127.0.0.1:1";
    try {
      const result = await run(assetId, domain);
      expect(result.status).toBe("partial");
      expect(result.sources.ct.status).toBe("failed");
      expect(result.sources.email_dns.status).toBe("ok");
      expect(result.findings.map((finding) => finding.title).sort()).toEqual([
        "No se encontró DKIM en los selectores habituales",
        "Sin registro SPF",
      ]);

      const { data: audit } = await supabaseAdmin.from("audits").select("status").eq("id", result.auditId).single();
      expect(audit?.status).toBe("draft");
    } finally {
      process.env.OSINT_CRTSH_BASE_URL = base;
    }
  }, 30000);

  test("TC-OSINT-08: un dominio que no existe no genera hallazgos de correo", async () => {
    const domain = uniqueDomain();
    const assetId = await insertDomain(domain);
    records.nxdomain.add(domain);

    const result = await run(assetId, domain);
    expect(result.status).toBe("completed");
    expect(result.sources.email_dns.status).toBe("no_data");
    expect(result.sources.ct.status).toBe("no_data");
    expect(result.findings).toEqual([]);
  });

  test("TC-OSINT-18: el DNS que falla deja la fuente parcial y no inventa hallazgos", async () => {
    const domain = uniqueDomain();
    const assetId = await insertDomain(domain);
    records.txt.set(domain, ["v=spf1 -all"]);
    records.servfail.add(`_dmarc.${domain}`);
    records.txt.set(`google._domainkey.${domain}`, ["v=DKIM1; p=ABC"]);

    const result = await run(assetId, domain);
    expect(result.sources.email_dns.status).toBe("partial");
    expect(result.status).toBe("partial");
    expect(result.findings.map((finding) => finding.title)).not.toContain("Sin registro DMARC");

    // Un resultado incompleto no se guarda en caché: la próxima corrida reintenta.
    records.servfail.delete(`_dmarc.${domain}`);
    const retry = await run(assetId, domain);
    expect(retry.sources.email_dns).toMatchObject({ status: "ok", cached: false });
    expect(retry.findings.map((finding) => finding.title)).toContain("Sin registro DMARC");
  }, 30000);

  test("TC-OSINT-19: subdominios guardados, caché y hallazgos sin duplicar", async () => {
    const domain = uniqueDomain();
    const assetId = await insertDomain(domain);
    configureSecureDomain(domain);
    records.a.set(`app.${domain}`, ["8.8.8.8"]);
    records.a.set(`cdn.${domain}`, ["104.16.0.1"]);
    records.a.set(`interno.${domain}`, ["10.0.0.5"]);
    crtResponses.set(
      domain,
      JSON.stringify([
        { name_value: `app.${domain}\ncdn.${domain}\n*.${domain}`, not_before: "2025-01-01T00:00:00", entry_timestamp: "2025-01-01T00:00:00" },
        { name_value: `interno.${domain}\nregistrado.${domain}\nstaging.${domain}`, not_before: "2025-02-01T00:00:00", entry_timestamp: "2025-02-01T00:00:00" },
      ])
    );
    await supabaseAdmin.from("assets").insert({
      type: "domain",
      value: `registrado.${domain}`,
      organization_id: orgId,
      created_by: ciso.userId,
    });

    const first = await run(assetId, domain);
    expect(first.status).toBe("completed");
    expect(first.sources.ct).toMatchObject({ status: "ok", cached: false });
    expect(first.sources.email_dns).toMatchObject({ status: "ok", cached: false });
    expect(first.summary.domains[domain].ct).toEqual({ subdomains: 5, unregistered: 4, behindCdn: 1 });
    expect(first.summary.domains[domain].email_dns).toMatchObject({ dmarcPolicy: "reject", dkimSelectors: ["google"] });
    expect(crtHits[domain]).toBe(1);

    const { data: rows } = await supabaseAdmin
      .from("osint_discovered_subdomains")
      .select("hostname, resolved_ips, behind_cdn, parent_asset_id")
      .eq("osint_run_id", first.runId)
      .order("hostname");
    expect(rows?.map((row) => row.hostname)).toEqual(
      ["app", "cdn", "interno", "registrado", "staging"].map((label) => `${label}.${domain}`)
    );
    const byHost = new Map(rows!.map((row) => [row.hostname, row]));
    expect(byHost.get(`app.${domain}`)).toMatchObject({ resolved_ips: ["8.8.8.8"], behind_cdn: false, parent_asset_id: assetId });
    expect(byHost.get(`cdn.${domain}`)).toMatchObject({ behind_cdn: true });
    expect(byHost.get(`interno.${domain}`)?.resolved_ips).toEqual([]);

    const titles = first.findings.map((finding) => [finding.source_engine, finding.title, finding.severity]).sort();
    expect(titles).toEqual([
      ["osint-ct", "Subdominios con nombre sensible", "medium"],
      ["osint-ct", "Subdominios públicos fuera del inventario", "low"],
    ]);

    // Un hallazgo ya revisado conserva su estado al repetir la corrida en la misma auditoría.
    const reviewed = first.findings.find((finding) => finding.severity === "medium")!;
    await supabaseAdmin.from("findings").update({ status: "false_positive" }).eq("id", reviewed.id);

    const second = await run(assetId, domain, first.auditId);
    expect(second.sources.ct.cached).toBe(true);
    expect(second.sources.email_dns.cached).toBe(true);
    expect(crtHits[domain]).toBe(1);
    expect(second.summary.findingsCount).toBe(0);
    expect(second.findings).toHaveLength(2);
    expect(second.findings.find((finding) => finding.id === reviewed.id)?.status).toBe("false_positive");
  }, 30000);

  test("TC-OSINT-20: rutas de subdominios", async () => {
    const domain = uniqueDomain();
    const assetId = await insertDomain(domain);
    configureSecureDomain(domain);
    crtResponses.set(
      domain,
      JSON.stringify([{ name_value: `uno.${domain}\ndos.${domain}`, not_before: "2025-01-01T00:00:00", entry_timestamp: "2025-01-01T00:00:00" }])
    );
    await supabaseAdmin.from("assets").insert({ type: "domain", value: `Uno.${domain}`, organization_id: orgId, created_by: ciso.userId });

    const { auditId, runId } = await run(assetId, domain);
    const list = (user: TestUser, id = auditId) =>
      api.get(`/api/v1/audits/${id}/osint/subdomains`).set("Authorization", bearer(user.accessToken));

    const viewerList = await list(viewer);
    expect(viewerList.status).toBe(200);
    expect(viewerList.body.data.map((row: { hostname: string; registered: boolean }) => [row.hostname, row.registered])).toEqual([
      [`dos.${domain}`, false],
      [`uno.${domain}`, true],
    ]);

    expect((await list(otherCiso)).status).toBe(404);

    const target = viewerList.body.data[0].id as string;
    const patch = (user: TestUser, id: string, status: string) =>
      api.patch(`/api/v1/osint/subdomains/${id}`).set("Authorization", bearer(user.accessToken)).send({ status });

    expect((await patch(viewer, target, "dismissed")).status).toBe(403);
    expect((await patch(otherCiso, target, "dismissed")).status).toBe(404);
    expect((await patch(ciso, randomUUID(), "dismissed")).status).toBe(404);
    expect((await patch(ciso, target, "otro")).status).toBe(400);

    const dismissed = await patch(ciso, target, "dismissed");
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.status).toBe("dismissed");

    // Sigue descartado y no vuelve a contar en la corrida siguiente.
    const next = await run(assetId, domain);
    expect(next.runId).not.toBe(runId);
    const { data: nextRows } = await supabaseAdmin
      .from("osint_discovered_subdomains")
      .select("hostname, status")
      .eq("osint_run_id", next.runId)
      .eq("hostname", `dos.${domain}`);
    expect(nextRows).toEqual([{ hostname: `dos.${domain}`, status: "dismissed" }]);
    expect(next.summary.domains[domain].ct.unregistered).toBe(0);
    expect(next.findings).toEqual([]);
  }, 30000);

  test("TC-OSINT-21: clasifica URLs históricas por su ruta", () => {
    const patternOf = (path: string) => classifyArchivedPath(path)?.pattern ?? null;
    expect(patternOf("/.env")).toBe(".env");
    expect(patternOf("/app/.env.production")).toBe(".env");
    expect(patternOf("/.git/config")).toBe(".git");
    expect(patternOf("/wp-config.php")).toBe("wp-config");
    expect(patternOf("/dump.SQL")).toBe(".sql");
    expect(patternOf("/db.sql.gz")).toBe(".sql");
    expect(patternOf("/site.bak")).toBe(".bak");
    expect(patternOf("/files/site.zip")).toBe(".zip");
    expect(patternOf("/backup/2024/index.html")).toBe("backup");
    expect(patternOf("/admin/")).toBe("admin");
    expect(patternOf("/wp-login.php")).toBe("login");

    // Parecidos que no son sensibles.
    for (const path of ["/", "/environment", "/github", "/administracion-publica", "/blog/login-seguro", "/sqlite-tutorial"]) {
      expect(patternOf(path)).toBeNull();
    }

    const body = JSON.stringify([
      ["original", "timestamp", "statuscode"],
      ["https://empresa.cl/.env?token=SECRETO", "20200101000000", "200"],
      ["https://empresa.cl/.env?otra=cosa", "20210101000000", "200"],
      ["http://app.empresa.cl:80/wp-login.php", "20200101000000", "-"],
      ["https://empresa.cl/dump.sql", "20200101000000", "404"],
      ["https://empresa.cl/index.html", "20200101000000", "200"],
      ["https://empresa.cl.evil.com/.env", "20200101000000", "200"],
      ["no es una url", "20200101000000", "200"],
    ]);
    const urls = parseCdxUrls(body, "empresa.cl");
    expect(urls).toEqual([
      { url: "app.empresa.cl/wp-login.php", pattern: "login", kind: "access_panel" },
      { url: "empresa.cl/.env", pattern: ".env", kind: "sensitive_file" },
    ]);
    expect(JSON.stringify(urls)).not.toContain("SECRETO");
    expect(parseCdxUrls("[]", "empresa.cl")).toEqual([]);
    expect(() => parseCdxUrls("<html>caído</html>", "empresa.cl")).toThrow();

    const { findings, summary } = buildArchiveFindings("a", "b", "empresa.cl", urls);
    expect(findings.map(({ title, severity, source_engine }) => [source_engine, title, severity])).toEqual([
      ["osint-archive", "Archivos sensibles en el archivo web", "medium"],
      ["osint-archive", "Paneles de acceso en el archivo web", "low"],
    ]);
    expect(summary).toMatchObject({ total: 2, byPattern: { ".env": 1, login: 1 } });
    expect(buildArchiveFindings("a", "b", "empresa.cl", []).findings).toEqual([]);
  });

  test("TC-OSINT-22: consulta el índice, usa caché y nunca visita las URLs del cliente", async () => {
    const domain = uniqueDomain();
    const assetId = await insertDomain(domain);
    configureSecureDomain(domain);
    cdxResponses.set(
      domain,
      JSON.stringify([
        ["original", "timestamp", "statuscode"],
        [`https://${domain}/.env?token=SECRETO`, "20200101000000", "200"],
        [`https://${domain}/admin/`, "20200101000000", "200"],
        // Apunta al propio servidor de prueba: si se visitara, quedaría registrado.
        [`${process.env.OSINT_WAYBACK_BASE_URL}/.git/config`, "20200101000000", "200"],
      ])
    );

    const first = await run(assetId, domain);
    expect(first.status).toBe("completed");
    expect(first.sources.wayback).toMatchObject({ status: "ok", cached: false });
    expect(first.findings.map((finding) => [finding.source_engine, finding.title, finding.severity]).sort()).toEqual([
      ["osint-archive", "Archivos sensibles en el archivo web", "medium"],
      ["osint-archive", "Paneles de acceso en el archivo web", "low"],
    ]);
    expect(first.summary.domains[domain].wayback).toMatchObject({ total: 2, byPattern: { ".env": 1, admin: 1 } });
    expect(cdxHits[domain]).toBe(1);
    expect(visitedPaths).toEqual([]);

    const { data: stored } = await supabaseAdmin.from("findings").select("detail").eq("audit_id", first.auditId);
    const { data: cache } = await supabaseAdmin
      .from("osint_source_cache")
      .select("payload")
      .eq("organization_id", orgId)
      .eq("source", "wayback")
      .eq("query_key", domain);
    expect(cache).toHaveLength(1);
    expect(JSON.stringify([stored, cache, first.summary])).not.toContain("SECRETO");

    const second = await run(assetId, domain, first.auditId);
    expect(second.sources.wayback.cached).toBe(true);
    expect(cdxHits[domain]).toBe(1);
    expect(second.findings).toHaveLength(2);
    expect(visitedPaths).toEqual([]);
  }, 30000);

  test("TC-OSINT-23: con el archivo web caído termina parcial, sin guardar nada en caché", async () => {
    const domain = uniqueDomain();
    const assetId = await insertDomain(domain);
    configureSecureDomain(domain);
    cdxFailures.add(domain);

    const result = await run(assetId, domain);
    expect(result.status).toBe("partial");
    expect(result.sources.wayback.status).toBe("failed");
    expect(result.sources.email_dns.status).toBe("ok");
    expect(cdxHits[domain]).toBe(2);

    const { count } = await supabaseAdmin
      .from("osint_source_cache")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("source", "wayback")
      .eq("query_key", domain);
    expect(count).toBe(0);
  }, 30000);

  test("TC-OSINT-24: las rutas no sensibles no generan hallazgos", async () => {
    const domain = uniqueDomain();
    const assetId = await insertDomain(domain);
    configureSecureDomain(domain);
    cdxResponses.set(
      domain,
      JSON.stringify([
        ["original", "timestamp", "statuscode"],
        [`https://${domain}/index.html`, "20200101000000", "200"],
      ])
    );

    const result = await run(assetId, domain);
    expect(result.sources.wayback.status).toBe("no_data");
    expect(result.findings).toEqual([]);
  }, 30000);
});
