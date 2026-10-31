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
import { buildOsintReportLines, loadOsintReport } from "../src/services/osintReport.js";
import { calculateRiskScore, OSINT_PENALTY_CAP } from "../src/services/riskScoring.js";

const NO_FINDINGS = { critical: 0, high: 0, medium: 0, low: 0 };

describe("Módulo C (C4): puntaje, reporte y controles", () => {
  let orgId: string;
  let ciso: TestUser;
  let domain: string;
  let assetId: string;

  async function createAudit(framework = "iso27001"): Promise<string> {
    const res = await api
      .post("/api/v1/audits")
      .set("Authorization", bearer(ciso.accessToken))
      .send({ title: "Reporte OSINT - QA", framework });
    return res.body.data.id;
  }

  async function seedRun(auditId: string): Promise<string> {
    const { data: run, error } = await supabaseAdmin
      .from("osint_runs")
      .insert({
        organization_id: orgId,
        audit_id: auditId,
        status: "partial",
        domains: [domain],
        finished_at: new Date().toISOString(),
        source_status: {
          [domain]: {
            ct: { status: "ok" },
            email_dns: { status: "ok" },
            wayback: { status: "failed", detail: "caído" },
            breaches: { status: "ok" },
          },
        },
        summary: {
          findingsCount: 2,
          domains: {
            [domain]: {
              email_dns: { spf: "v=spf1 -all", dmarcPolicy: "none", dkimSelectors: ["google"], mx: [`mx.${domain}`] },
              breaches: { accounts: 2, breaches: ["Adobe"], recent: false },
            },
          },
        },
      })
      .select("id")
      .single();
    if (error || !run) throw new Error(`Corrida de test: ${error?.message}`);

    await supabaseAdmin.from("osint_discovered_subdomains").insert(
      [
        { hostname: `fuera.${domain}`, behind_cdn: true, status: "new" },
        { hostname: `registrado.${domain}`, behind_cdn: false, status: "new" },
        { hostname: `descartado.${domain}`, behind_cdn: false, status: "dismissed" },
      ].map((row) => ({ organization_id: orgId, audit_id: auditId, osint_run_id: run.id, parent_asset_id: assetId, ...row }))
    );
    await supabaseAdmin.from("osint_breach_exposures").insert({
      organization_id: orgId,
      audit_id: auditId,
      osint_run_id: run.id,
      alias_masked: `j***@${domain}`,
      breaches: ["Adobe"],
    });
    return run.id;
  }

  async function insertFinding(auditId: string, row: object) {
    const { error } = await supabaseAdmin.from("findings").insert({ audit_id: auditId, asset_id: assetId, detail: "d", remediation: "r", ...row });
    if (error) throw new Error(`Hallazgo de test: ${error.message}`);
  }

  beforeAll(async () => {
    domain = uniqueDomain();
    orgId = await createOrganization("QA Org - Reporte OSINT");
    ciso = await createTestUser(orgId, "ciso-reporte", "ciso");
    const { data, error } = await supabaseAdmin
      .from("assets")
      .insert([
        { type: "domain", value: domain, organization_id: orgId, created_by: ciso.userId, verification_status: "verified" },
        { type: "domain", value: `registrado.${domain}`, organization_id: orgId, created_by: ciso.userId, verification_status: "pending" },
      ])
      .select("id, value");
    if (error || !data) throw new Error(`Activos de test: ${error?.message}`);
    assetId = data.find((row) => row.value === domain)!.id;
  }, 60000);

  afterAll(async () => {
    await destroyTestUser(ciso);
    await destroyOrganization(orgId);
  }, 60000);

  test("TC-OSINT-09: el puntaje no cambia sin OSINT, y OSINT pesa menos y tiene tope", () => {
    const base = { findingsBySeverity: { ...NO_FINDINGS, high: 1 }, completionPercentage: 80 };
    const withoutOsint = calculateRiskScore(base);
    expect(withoutOsint).toEqual({
      score: 84,
      findingsPenalty: 10,
      coveragePenalty: 6,
      osintPenalty: 0,
      complianceLevel: "medio",
    });
    expect(calculateRiskScore({ ...base, osintFindingsBySeverity: NO_FINDINGS })).toEqual(withoutOsint);

    const someOsint = calculateRiskScore({ ...base, osintFindingsBySeverity: { ...NO_FINDINGS, high: 1, medium: 1, low: 1 } });
    expect(someOsint.osintPenalty).toBe(7);
    expect(someOsint.findingsPenalty).toBe(10);
    expect(someOsint.score).toBe(77);

    const lotsOfOsint = calculateRiskScore({ ...base, osintFindingsBySeverity: { ...NO_FINDINGS, high: 100 } });
    expect(lotsOfOsint.osintPenalty).toBe(OSINT_PENALTY_CAP);
    expect(lotsOfOsint.score).toBe(84 - OSINT_PENALTY_CAP);
  });

  test("TC-OSINT-29: el reporte separa OSINT del puntaje técnico y excluye lo descartado", async () => {
    const auditId = await createAudit();
    await seedRun(auditId);
    await insertFinding(auditId, { source_engine: "nmap", title: "Puerto abierto", severity: "high" });
    await insertFinding(auditId, { source_engine: "osint-email-dns", title: "Sin registro DMARC", severity: "high" });
    await insertFinding(auditId, { source_engine: "osint-ct", title: "Subdominios", severity: "low" });
    await insertFinding(auditId, {
      source_engine: "osint-archive",
      title: "Archivos",
      severity: "medium",
      status: "false_positive",
      justification_notes: "Revisado por el equipo",
    });

    const res = await api.get(`/api/v1/audits/${auditId}/report`).set("Authorization", bearer(ciso.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.riskScore).toMatchObject({ findingsPenalty: 10, osintPenalty: 5 });

    const pdf = await fetch(res.body.data.signedUrl);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString("ascii")).toBe("%PDF-");
  }, 20000);

  test("TC-OSINT-30: la sección del PDF trae conteos y nunca cuentas, y las anotaciones no tocan porcentajes", async () => {
    const auditId = await createAudit();
    await seedRun(auditId);


    const report = await loadOsintReport(supabaseForUser(ciso.accessToken), auditId, "iso27001");
    expect(report).toMatchObject({
      status: "partial",
      subdomains: { total: 3, outOfInventory: [`fuera.${domain}`], behindCdn: 1 },
    });
    expect(report!.signals).toEqual([
      { code: "A.8.1.1", text: "1 subdominio(s) fuera del inventario de activos." },
      { code: "A.16.1.1", text: "2 cuenta(s) del dominio en brechas públicas." },
    ]);

    const text = buildOsintReportLines(report!, [{ title: "Sin DMARC", severity: "high", detail: "d", remediation: "r" }], 4)
      .map((line) => line.text)
      .join("\n");
    expect(text).toContain("Penalización por reconocimiento pasivo: -4");
    expect(text).toContain("Archivo web: Falló");
    expect(text).toContain("2 cuenta(s) en: Adobe");
    expect(text).toContain("Have I Been Pwned");
    expect(text).toContain(`fuera.${domain}`);
    expect(text).not.toContain(`descartado.${domain}`);
    expect(text).not.toContain("j***");
    expect(JSON.stringify(report)).not.toContain("j***");

    const status = await api.get(`/api/v1/audits/${auditId}/osint`).set("Authorization", bearer(ciso.accessToken));
    expect(status.body.data.report.signals).toHaveLength(2);

    // Con Ley 21.663 anota el control de inventario, sin mover los porcentajes.
    const anciAudit = await createAudit("ley_21663_cl");
    const before = await api.get(`/api/v1/audits/${anciAudit}/anci-status`).set("Authorization", bearer(ciso.accessToken));
    await seedRun(anciAudit);
    const after = await api.get(`/api/v1/audits/${anciAudit}/anci-status`).set("Authorization", bearer(ciso.accessToken));
    expect(after.body.data).toEqual(before.body.data);
    const anciReport = await loadOsintReport(supabaseForUser(ciso.accessToken), anciAudit, "ley_21663_cl");
    expect(anciReport!.signals.map((signal) => signal.code)).toEqual(["ANCI-TEC-01"]);
  }, 30000);

  test("TC-OSINT-31: sin corrida no hay sección, y sin HIBP no se le atribuye nada", async () => {

    const auditId = await createAudit();
    await expect(loadOsintReport(supabaseForUser(ciso.accessToken), auditId, "iso27001")).resolves.toBeNull();

    const res = await api.get(`/api/v1/audits/${auditId}/report`).set("Authorization", bearer(ciso.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.riskScore.osintPenalty).toBe(0);

    const lines = buildOsintReportLines(
      {
        runId: "x",
        status: "completed",
        finishedAt: null,
        domains: ["a.cl"],
        sourceStatus: { "a.cl": { breaches: { status: "not_configured", detail: null } } },
        summaries: {},
        subdomains: { total: 0, outOfInventory: [], behindCdn: 0 },
        signals: [],
      },
      [],
      0
    );
    const text = lines.map((line) => line.text).join("\n");
    expect(text).toContain("No configurado");
    expect(text).not.toContain("CC BY");
  }, 20000);

  test("TC-OSINT-32: el dashboard no mezcla OSINT con los agregados técnicos", async () => {
    const orgDashId = await createOrganization("QA Org - Dashboard OSINT");
    const owner = await createTestUser(orgDashId, "ciso-dashboard", "ciso");
    try {
      const auditRes = await api
        .post("/api/v1/audits")
        .set("Authorization", bearer(owner.accessToken))
        .send({ title: "Dashboard", framework: "iso27001" });
      const audit = auditRes.body.data.id;
      await supabaseAdmin.from("findings").insert([
        { audit_id: audit, source_engine: "nmap", title: "T", severity: "high", status: "open" },
        { audit_id: audit, source_engine: "osint-email-dns", title: "O", severity: "high", status: "open" },
        { audit_id: audit, source_engine: "osint-ct", title: "O2", severity: "low", status: "open" },
        { audit_id: audit, source_engine: "osint-archive", title: "O3", severity: "medium", status: "false_positive" },
      ]);

      const res = await api.get("/api/v1/dashboard/summary").set("Authorization", bearer(owner.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.findingsBySeverity).toEqual({ critical: 0, high: 1, medium: 0, low: 0 });
      expect(res.body.data.ignoredFindingsCount).toBe(0);
      expect(res.body.data.osintFindingsCount).toBe(2);
    } finally {
      await destroyTestUser(owner);
      await destroyOrganization(orgDashId);
    }
  }, 30000);
});
