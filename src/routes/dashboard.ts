import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../middlewares/errorHandler.js";
import { supabaseForUser } from "../config/supabase.js";
import { evaluateCoverage } from "../services/coverageEngine.js";
import { evaluateAnciCoverage } from "../services/anciCoverageEngine.js";
import type { FindingSeverity } from "../services/findingsNormalization.js";

export const dashboardRouter = Router();

const AUDIT_STATUSES = ["draft", "queued", "running", "completed", "failed"] as const;
const SEVERITIES: FindingSeverity[] = ["critical", "high", "medium", "low"];
const NETWORK_ASSET_TYPES = ["ip", "cidr", "domain"];
const IGNORED_FINDING_STATUSES = ["false_positive", "accepted_risk"];

/**
 * Resumen agregado para /dashboard. No está en ninguna de las 4 fases de
 * a.md (esas se enfocaron en CRUD por-recurso); se agrega ahora porque el
 * frontend necesita un solo request barato para pintar el dashboard, en
 * vez de N llamadas (o de llamar GET /audits/:id/report, que genera y
 * sube un PDF nuevo cada vez como efecto secundario).
 */
dashboardRouter.get(
  "/dashboard/summary",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);

    const [assetsCountRes, networkAssetsCountRes, auditsRes, findingsRes] = await Promise.all([
      supabase.from("assets").select("id", { count: "exact", head: true }),
      supabase.from("assets").select("id", { count: "exact", head: true }).in("type", NETWORK_ASSET_TYPES),
      supabase
        .from("audits")
        .select("id, title, framework, status, risk_score, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("findings").select("severity, status, source_engine"),
    ]);

    if (assetsCountRes.error) throw new AppError(400, "ASSETS_COUNT_FAILED", assetsCountRes.error.message);
    if (networkAssetsCountRes.error) throw new AppError(400, "ASSETS_COUNT_FAILED", networkAssetsCountRes.error.message);
    if (auditsRes.error) throw new AppError(400, "AUDITS_FETCH_FAILED", auditsRes.error.message);
    if (findingsRes.error) throw new AppError(400, "FINDINGS_FETCH_FAILED", findingsRes.error.message);

    const audits = auditsRes.data ?? [];
    // OSINT va aparte: son señales indirectas y no deben mover el banner de
    // críticos ni la distribución técnica del Módulo A.
    const findings = (findingsRes.data ?? []).filter((f) => !f.source_engine.startsWith("osint-"));
    const osintFindingsCount = (findingsRes.data ?? []).filter(
      (f) => f.source_engine.startsWith("osint-") && !IGNORED_FINDING_STATUSES.includes(f.status)
    ).length;

    const auditsByStatus = Object.fromEntries(AUDIT_STATUSES.map((s) => [s, 0])) as Record<
      (typeof AUDIT_STATUSES)[number],
      number
    >;
    for (const audit of audits) {
      auditsByStatus[audit.status as (typeof AUDIT_STATUSES)[number]] += 1;
    }

    const findingsBySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<
      FindingSeverity,
      number
    >;
    for (const finding of findings) {
      findingsBySeverity[finding.severity as FindingSeverity] += 1;
    }
    const ignoredFindingsCount = findings.filter((f) => IGNORED_FINDING_STATUSES.includes(f.status)).length;

    // Cobertura promedio: se recalcula por auditoría (barato: son counts por
    // audit_id, no requiere leer archivos ni Storage) y se promedia acá en
    // vez de persistirla, para no desincronizarse de las evidencias reales.
    // null (no "100%") cuando todavía no hay ninguna auditoría — antes
    // mostraba un cumplimiento perfecto engañoso en cuentas nuevas sin
    // datos (a.md, "REDISEÑO COMPLETO DEL DASHBOARD Y FIRST-TIME UX").
    const coverages = await Promise.all(
      audits.map((audit) => evaluateCoverage(supabase, audit.id, audit.framework))
    );
    const averageCoveragePercentage =
      coverages.length === 0
        ? null
        : Math.round(coverages.reduce((sum, c) => sum + c.completion_percentage, 0) / coverages.length);

    // Cumplimiento ANCI (Ley 21.663): se muestra el de la auditoría
    // ley_21663_cl más reciente, no un promedio entre todas — a diferencia
    // de la cobertura documental genérica de arriba, acá cada auditoría
    // representa una foto de cumplimiento normativo puntual, y promediar
    // auditorías viejas con la actual diluiría la señal que el usuario
    // necesita accionar ahora. null si la organización no tiene ninguna
    // auditoría de ese framework todavía.
    const latestAnciAudit = audits.find((a) => a.framework === "ley_21663_cl");
    const anciCompliance = latestAnciAudit
      ? await evaluateAnciCoverage(supabase, latestAnciAudit.id, latestAnciAudit.framework).then((r) => ({
          sePercentage: r.sePercentage,
          oivPercentage: r.oivPercentage,
        }))
      : null;

    // Puntaje de Salud de Seguridad (a.md, "REDISEÑO COMPLETO DE UI/UX"):
    // promedio de `risk_score` (ver riskScoring.ts — pese al nombre de la
    // columna, 100 = perfecto) entre las auditorías que ya generaron un
    // reporte al menos una vez. null si ninguna auditoría tiene puntaje
    // todavía, para que el frontend muestre un estado vacío en vez de un
    // 0 engañoso.
    const scoredAudits = audits.filter((a) => a.risk_score !== null);
    const securityHealthScore =
      scoredAudits.length === 0
        ? null
        : Math.round(scoredAudits.reduce((sum, a) => sum + (a.risk_score ?? 0), 0) / scoredAudits.length);

    res.status(200).json({
      data: {
        totalAssets: assetsCountRes.count ?? 0,
        networkAssetsCount: networkAssetsCountRes.count ?? 0,
        totalAudits: audits.length,
        auditsByStatus,
        findingsBySeverity,
        ignoredFindingsCount,
        osintFindingsCount,
        averageCoveragePercentage,
        securityHealthScore,
        anciCompliance,
        recentAudits: audits.slice(0, 5),
      },
    });
  })
);
