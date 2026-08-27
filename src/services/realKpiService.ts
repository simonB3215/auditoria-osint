import { supabaseAdmin } from "../config/supabase.js";
import { getCostBreakdown } from "./costEngine.js";
import { SII_LEY_21663_ADDRESSABLE_COMPANIES } from "./finopsProjection.js";

/**
 * KPIs reales de negocio, calculados a partir de las tablas que ya existen
 * (no simulados) — contraparte de `/admin/internal-finops`, que sí simula
 * escenarios hipotéticos. Ver DASHBOARD_FINOPS_INTERNO.md para la
 * diferencia entre ambos paneles.
 *
 * Desviación importante respecto al prompt de diseño original: a.md asume
 * tablas de `suscripciones`, `facturación` y `organization_domains` que no
 * existen en este proyecto — no hay pasarela de pagos conectada (ver
 * README, "Limitaciones conocidas") ni tabla de suscripciones, y
 * `organization_domains` ya se había adaptado a la tabla `assets` en el
 * módulo de verificación de dominio (ver DASHBOARD_FINOPS_INTERNO.md y
 * `src/routes/assets.ts`). En vez de fabricar datos de facturación que no
 * existen, los indicadores financieros que dependen de suscripciones
 * pagas se calculan honestamente en 0 / null con `billingConnected: false`
 * explícito, listos para poblarse el día que exista una pasarela de pagos
 * real — mismo patrón "preparado pero no conectado" que ya se usa para el
 * envío de emails.
 */

export type KpiPeriod = "current_month" | "last_quarter" | "year_to_date";

export function resolvePeriodRange(period: KpiPeriod, now: Date = new Date()): { from: Date; to: Date } {
  const to = now;
  let from: Date;
  switch (period) {
    case "current_month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "last_quarter":
      // Interpretado como "últimos 3 meses corridos" (rolling), no el
      // trimestre calendario anterior — evita ambigüedad de límites de
      // trimestre y es más intuitivo para un dashboard en vivo.
      from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      break;
    case "year_to_date":
      from = new Date(now.getFullYear(), 0, 1);
      break;
  }
  return { from, to };
}

function inRange(iso: string | null, from: Date, to: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

export interface RealKpiFinancial {
  mrrRealClp: number;
  arrRealClp: number;
  arpuClp: number | null;
  cogsRealClp: number;
  grossMarginPct: number | null;
  payingOrganizations: number;
  /** false hoy siempre: no hay pasarela de pagos ni tabla de suscripciones conectada — ver comentario de archivo. */
  billingConnected: boolean;
}

export interface RealKpiFunnel {
  totalOrganizations: number;
  /** Organizaciones con al menos un perfil que alguna vez pasó por un trial (rol auditor_guest, removido) — señal histórica real vía `profiles.expires_at`. */
  trialOrganizations: number;
  payingOrganizations: number;
  trialToPaidConversionPct: number | null;
  churnRatePct: number | null;
  addressableMarket: { totalCompanies: number; penetrationPct: number };
}

export interface RealKpiOperational {
  totalDomainAssets: number;
  verifiedDomainAssets: number;
  domainVerificationRatePct: number | null;
  auditsCompleted: number;
  scanRunsCompleted: number;
  criticalFindingsDetected: number;
  itDelegationEmailsSent: number;
}

export interface DailyActivityPoint {
  date: string;
  scansCompleted: number;
  criticalFindings: number;
}

/**
 * "trial_active" existía mientras el rol auditor_guest (Piloto Invitado)
 * estaba vivo — se quitó tras su eliminación (migración
 * 022_remove_guest_role.sql), ninguna organización puede volver a tener
 * un trial activo. "trial_expired" se conserva: sigue siendo una señal
 * histórica real vía `profiles.expires_at`, no depende del rol.
 */
export type OrganizationSegment = "trial_expired" | "standard";

export interface SubscriptionSummaryRow {
  organizationId: string;
  organizationName: string;
  segment: OrganizationSegment;
  createdAt: string;
  trialExpiresAt: string | null;
}

export interface RealKpiReport {
  period: { key: KpiPeriod; from: string; to: string };
  financial: RealKpiFinancial;
  funnel: RealKpiFunnel;
  operational: RealKpiOperational;
  dailyActivity: DailyActivityPoint[];
  subscriptions: SubscriptionSummaryRow[];
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDailyActivity(
  from: Date,
  to: Date,
  scanRuns: { created_at: string; status: string }[],
  findings: { detected_at: string; severity: string }[]
): DailyActivityPoint[] {
  const byDate = new Map<string, { scansCompleted: number; criticalFindings: number }>();

  for (const run of scanRuns) {
    if (run.status !== "completed" || !inRange(run.created_at, from, to)) continue;
    const date = run.created_at.slice(0, 10);
    const entry = byDate.get(date) ?? { scansCompleted: 0, criticalFindings: 0 };
    entry.scansCompleted += 1;
    byDate.set(date, entry);
  }
  for (const finding of findings) {
    if (finding.severity !== "critical" || !inRange(finding.detected_at, from, to)) continue;
    const date = finding.detected_at.slice(0, 10);
    const entry = byDate.get(date) ?? { scansCompleted: 0, criticalFindings: 0 };
    entry.criticalFindings += 1;
    byDate.set(date, entry);
  }

  // Se generan todos los días del rango (incluso en 0) para que el gráfico
  // de línea no tenga huecos — a diferencia de costEngine.ts, acá el rango
  // siempre es acotado (máximo ~1 año en "year_to_date"), así que no hay
  // riesgo de generar una serie desproporcionadamente larga.
  const points: DailyActivityPoint[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= end) {
    const date = toDateOnly(cursor);
    const entry = byDate.get(date) ?? { scansCompleted: 0, criticalFindings: 0 };
    points.push({ date, ...entry });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

export async function getRealKpiReport(period: KpiPeriod): Promise<RealKpiReport> {
  const { from, to } = resolvePeriodRange(period);

  const [
    { data: organizations },
    { data: profiles },
    { data: assets },
    { data: audits },
    { data: scanRuns },
    { data: findings },
    { count: delegationEmailsCount },
    costBreakdown,
  ] = await Promise.all([
    supabaseAdmin.from("organizations").select("id, name, created_at"),
    supabaseAdmin.from("profiles").select("id, organization_id, role, expires_at"),
    supabaseAdmin.from("assets").select("id, type, verification_status"),
    supabaseAdmin.from("audits").select("id, status, updated_at"),
    supabaseAdmin.from("scan_runs").select("id, status, created_at"),
    supabaseAdmin.from("findings").select("id, severity, detected_at"),
    supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "DOMAIN_VERIFICATION_EMAIL_SENT")
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString()),
    getCostBreakdown(from, to),
  ]);

  const orgs = organizations ?? [];
  const allProfiles = profiles ?? [];
  const allAssets = assets ?? [];
  const allAudits = audits ?? [];
  const allScanRuns = scanRuns ?? [];
  const allFindings = findings ?? [];

  // --- Financiero ---
  const cogsRealClp = costBreakdown.series.reduce((sum, day) => sum + day.total, 0);
  const mrrRealClp = 0; // ver comentario de archivo: no hay pasarela de pagos conectada
  const arrRealClp = mrrRealClp * 12;
  const payingOrganizations = 0;
  const financial: RealKpiFinancial = {
    mrrRealClp,
    arrRealClp,
    arpuClp: payingOrganizations > 0 ? mrrRealClp / payingOrganizations : null,
    cogsRealClp,
    grossMarginPct: mrrRealClp > 0 ? ((mrrRealClp - cogsRealClp) / mrrRealClp) * 100 : null,
    payingOrganizations,
    billingConnected: false,
  };

  // --- Embudo comercial ---
  const orgIdsWithTrialSignal = new Set(allProfiles.filter((p) => p.expires_at !== null).map((p) => p.organization_id));
  const totalOrganizations = orgs.length;
  const trialOrganizations = orgIdsWithTrialSignal.size;
  const funnel: RealKpiFunnel = {
    totalOrganizations,
    trialOrganizations,
    payingOrganizations,
    trialToPaidConversionPct: null,
    churnRatePct: null,
    addressableMarket: {
      totalCompanies: SII_LEY_21663_ADDRESSABLE_COMPANIES,
      penetrationPct: totalOrganizations > 0 ? (totalOrganizations / SII_LEY_21663_ADDRESSABLE_COMPANIES) * 100 : 0,
    },
  };

  // --- Operativo ---
  const domainAssets = allAssets.filter((a) => a.type === "domain");
  const verifiedDomainAssets = domainAssets.filter((a) => a.verification_status === "verified");
  const auditsCompleted = allAudits.filter((a) => a.status === "completed" && inRange(a.updated_at, from, to)).length;
  const scanRunsCompleted = allScanRuns.filter((r) => r.status === "completed" && inRange(r.created_at, from, to)).length;
  const criticalFindingsDetected = allFindings.filter(
    (f) => f.severity === "critical" && inRange(f.detected_at, from, to)
  ).length;
  const operational: RealKpiOperational = {
    totalDomainAssets: domainAssets.length,
    verifiedDomainAssets: verifiedDomainAssets.length,
    domainVerificationRatePct: domainAssets.length > 0 ? (verifiedDomainAssets.length / domainAssets.length) * 100 : null,
    auditsCompleted,
    scanRunsCompleted,
    criticalFindingsDetected,
    itDelegationEmailsSent: delegationEmailsCount ?? 0,
  };

  // --- Actividad diaria ---
  const dailyActivity = buildDailyActivity(from, to, allScanRuns, allFindings);

  // --- Resumen de organizaciones (reemplaza la tabla de suscripciones por
  // plan que pedía a.md, ya que no existe ningún concepto de plan/pago
  // real — se segmenta por la señal real de ciclo de vida que sí existe:
  // si alguna vez tuvieron un usuario en trial, vía profiles.expires_at.
  // El rol auditor_guest que originaba esa señal ya no existe (migración
  // 022_remove_guest_role.sql) — expires_at queda como dato histórico. ---
  const profilesByOrg = new Map<string, { expires_at: string | null }[]>();
  for (const p of allProfiles) {
    const list = profilesByOrg.get(p.organization_id) ?? [];
    list.push({ expires_at: p.expires_at });
    profilesByOrg.set(p.organization_id, list);
  }
  const subscriptions: SubscriptionSummaryRow[] = orgs
    .map((org) => {
      const orgProfiles = profilesByOrg.get(org.id) ?? [];
      const hasTrialSignal = orgProfiles.some((p) => p.expires_at !== null);
      const segment: OrganizationSegment = hasTrialSignal ? "trial_expired" : "standard";
      const trialExpiresAt = orgProfiles
        .map((p) => p.expires_at)
        .filter((v): v is string => v !== null)
        .sort()
        .at(-1) ?? null;
      return { organizationId: org.id, organizationName: org.name, segment, createdAt: org.created_at, trialExpiresAt };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    period: { key: period, from: from.toISOString(), to: to.toISOString() },
    financial,
    funnel,
    operational,
    dailyActivity,
    subscriptions,
  };
}
