import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportFinding } from "./pdfReport.js";

const MAX_HOSTS_IN_REPORT = 50;

const SOURCE_LABEL: Record<string, string> = {
  ct: "Certificados (Certificate Transparency)",
  email_dns: "DNS de correo",
  wayback: "Archivo web",
  breaches: "Brechas (Have I Been Pwned)",
};

const SEVERITY_LABEL: Record<ReportFinding["severity"], string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const OUTCOME_LABEL: Record<string, string> = {
  ok: "Completo",
  partial: "Parcial",
  failed: "Falló",
  not_configured: "No configurado",
  no_data: "Sin datos",
};

/**
 * Controles existentes a los que una señal OSINT aporta contexto. Solo son
 * anotaciones: no cambian el estado de ningún control ni ningún porcentaje.
 */
const INVENTORY_CONTROLS: Record<string, string> = {
  ley_21663_cl: "ANCI-TEC-01",
  iso27001: "A.8.1.1",
  nist_csf: "ID.AM-1",
};
const BREACH_CONTROLS: Record<string, string[]> = {
  iso27001: ["A.16.1.1"],
  nist_csf: ["PR.AC-1"],
};

export interface OsintSignal {
  code: string;
  text: string;
}

interface SourceOutcome {
  status: string;
  detail: string | null;
}

interface DomainSummary {
  email_dns?: { spf: string | null; dmarcPolicy: string | null; dkimSelectors: string[]; mx: string[] };
  wayback?: { total: number; byPattern: Record<string, number>; examples: string[] };
  breaches?: { accounts: number; breaches: string[]; recent: boolean };
}

export interface OsintReport {
  runId: string;
  status: string;
  finishedAt: string | null;
  domains: string[];
  sourceStatus: Record<string, Record<string, SourceOutcome>>;
  summaries: Record<string, DomainSummary>;
  subdomains: { total: number; outOfInventory: string[]; behindCdn: number };
  signals: OsintSignal[];
}

/**
 * Resumen de la última corrida terminada. Lee `osint_runs` y los subdominios,
 * nunca `osint_breach_exposures`: este resumen va al PDF, que se comparte, así
 * que no lleva ni los alias enmascarados.
 */
export async function loadOsintReport(
  supabase: SupabaseClient,
  auditId: string,
  framework: string
): Promise<OsintReport | null> {
  const { data: run, error: runError } = await supabase
    .from("osint_runs")
    .select("id, status, finished_at, domains, source_status, summary")
    .eq("audit_id", auditId)
    .in("status", ["completed", "partial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!run) return null;

  const [{ data: subdomains, error: subdomainsError }, { data: assets, error: assetsError }] = await Promise.all([
    supabase.from("osint_discovered_subdomains").select("hostname, behind_cdn, status").eq("osint_run_id", run.id).order("hostname"),
    supabase.from("assets").select("value"),
  ]);
  if (subdomainsError) throw new Error(subdomainsError.message);
  if (assetsError) throw new Error(assetsError.message);

  const registered = new Set((assets ?? []).map((asset) => asset.value.toLowerCase()));
  const outOfInventory = (subdomains ?? [])
    .filter((row) => row.status !== "dismissed" && !registered.has(row.hostname.toLowerCase()))
    .map((row) => row.hostname);

  const summaries = ((run.summary as { domains?: Record<string, DomainSummary> }).domains ?? {}) as Record<string, DomainSummary>;
  const accounts = Object.values(summaries).reduce((total, summary) => total + (summary.breaches?.accounts ?? 0), 0);

  const signals: OsintSignal[] = [];
  const inventoryControl = INVENTORY_CONTROLS[framework];
  if (inventoryControl && outOfInventory.length > 0) {
    signals.push({ code: inventoryControl, text: `${outOfInventory.length} subdominio(s) fuera del inventario de activos.` });
  }
  if (accounts > 0) {
    for (const code of BREACH_CONTROLS[framework] ?? []) {
      signals.push({ code, text: `${accounts} cuenta(s) del dominio en brechas públicas.` });
    }
  }

  return {
    runId: run.id,
    status: run.status,
    finishedAt: run.finished_at,
    domains: run.domains,
    sourceStatus: run.source_status as OsintReport["sourceStatus"],
    summaries,
    subdomains: {
      total: subdomains?.length ?? 0,
      outOfInventory,
      behindCdn: (subdomains ?? []).filter((row) => row.behind_cdn).length,
    },
    signals,
  };
}

export interface OsintReportLine {
  style: "heading" | "text" | "bullet" | "small";
  text: string;
}

/** Va separado del PDF para poder comprobar qué dice sin leer el binario. */
export function buildOsintReportLines(
  report: OsintReport,
  findings: ReportFinding[],
  osintPenalty: number
): OsintReportLine[] {
  const lines: OsintReportLine[] = [];
  const heading = (text: string) => lines.push({ style: "heading", text });
  const text = (value: string) => lines.push({ style: "text", text: value });
  const bullet = (value: string) => lines.push({ style: "bullet", text: value });

  if (report.finishedAt) text(`Corrida: ${new Date(report.finishedAt).toLocaleString("es-CL")}`);
  text(`Dominios: ${report.domains.join(", ")}`);
  text(`Penalización por reconocimiento pasivo: -${osintPenalty}`);

  heading("Estado por fuente");
  for (const [domain, sources] of Object.entries(report.sourceStatus)) {
    for (const [source, outcome] of Object.entries(sources)) {
      bullet(`${domain} — ${SOURCE_LABEL[source] ?? source}: ${OUTCOME_LABEL[outcome.status] ?? outcome.status}`);
    }
  }

  heading("Postura de correo");
  const postures = Object.entries(report.summaries).filter(([, summary]) => summary.email_dns);
  if (postures.length === 0) text("Sin datos.");
  for (const [domain, summary] of postures) {
    const posture = summary.email_dns!;
    bullet(
      `${domain} — SPF: ${posture.spf ?? "no encontrado"} | DMARC: ${posture.dmarcPolicy ?? "no encontrado"} | ` +
        `DKIM: ${posture.dkimSelectors.join(", ") || "no encontrado en selectores habituales"} | MX: ${posture.mx.join(", ") || "sin MX"}`
    );
  }

  heading("Subdominios");
  text(`Total: ${report.subdomains.total} | Fuera del inventario: ${report.subdomains.outOfInventory.length} | Detrás de CDN: ${report.subdomains.behindCdn}`);
  for (const host of report.subdomains.outOfInventory.slice(0, MAX_HOSTS_IN_REPORT)) bullet(host);
  if (report.subdomains.outOfInventory.length > MAX_HOSTS_IN_REPORT) {
    text(`Y ${report.subdomains.outOfInventory.length - MAX_HOSTS_IN_REPORT} más.`);
  }
  if (report.subdomains.outOfInventory.length > 0) {
    text("Recomendación: registra y verifica los subdominios fuera del inventario para que el Módulo A mida su exposición real.");
  }

  const archives = Object.values(report.summaries).filter((summary) => summary.wayback);
  if (archives.length > 0) {
    heading("URLs históricas sensibles");
    for (const { wayback } of archives) {
      text(Object.entries(wayback!.byPattern).map(([pattern, count]) => `${pattern}: ${count}`).join(" | "));
      for (const example of wayback!.examples) bullet(example);
    }
  }

  const breachSummaries = Object.entries(report.summaries).filter(([, summary]) => summary.breaches);
  const hibpUsed = Object.values(report.sourceStatus).some(
    (sources) => sources.breaches && sources.breaches.status !== "not_configured"
  );
  if (breachSummaries.length > 0) {
    heading("Brechas públicas");
    for (const [domain, { breaches }] of breachSummaries) {
      bullet(`${domain} — ${breaches!.accounts} cuenta(s) en: ${breaches!.breaches.join(", ")}`);
    }
  }

  if (report.signals.length > 0) {
    heading("Anotaciones sobre controles");
    for (const signal of report.signals) bullet(`${signal.code}: ${signal.text}`);
    text("Son informativas: no cambian el estado de ningún control ni los porcentajes de cumplimiento.");
  }

  if (findings.length > 0) {
    heading("Hallazgos");
    for (const finding of findings) {
      bullet(`[${SEVERITY_LABEL[finding.severity]}] ${finding.title}`);
      if (finding.detail) lines.push({ style: "small", text: `Detalle: ${finding.detail}` });
      if (finding.remediation) lines.push({ style: "small", text: `Remediación sugerida: ${finding.remediation}` });
    }
  }

  heading("Alcance");
  lines.push({
    style: "small",
    text:
      "Consulta fuentes públicas sobre dominios verificados. No envía tráfico de escaneo a los servidores del cliente, " +
      "no visita sus URLs, no prueba contraseñas, no escanea subdominios y no investiga personas. Son señales indirectas " +
      "de terceros, por lo que pueden estar desactualizadas.",
  });
  if (hibpUsed) {
    lines.push({ style: "small", text: "Datos de brechas: Have I Been Pwned (https://haveibeenpwned.com), licencia CC BY 4.0." });
  }
  return lines;
}
