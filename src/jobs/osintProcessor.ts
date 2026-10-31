import { createHash } from "node:crypto";
import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { AUDIT_ACTIONS, logAuditEvent } from "../services/auditLogger.js";
import type { NormalizedFinding } from "../services/findingsNormalization.js";
import { OSINT_SOURCES } from "../services/osint/index.js";
import type {
  OsintSource,
  OsintSourceContext,
  OsintSourceId,
  OsintSourceOutcome,
  OsintSourceResult,
} from "../services/osint/types.js";
import type { OsintJobData } from "./osintQueue.js";

/** Tope por fuente y dominio: alcanza para los reintentos de crt.sh y resolver sus subdominios. */
const SOURCE_TIMEOUT_FACTOR = 8;

export const OSINT_SOURCE_TIMEOUT_MS = env.OSINT_HTTP_TIMEOUT_MS * SOURCE_TIMEOUT_FACTOR;

export type OsintRunStatus = "completed" | "partial" | "failed";

/** Sin nada que falló, la corrida está completa: `no_data` y `not_configured` no son errores. */
export function finalOsintStatus(outcomes: OsintSourceOutcome[]): OsintRunStatus {
  const failed = outcomes.filter((outcome) => outcome === "failed").length;
  if (failed === 0) return outcomes.includes("partial") ? "partial" : "completed";
  return failed === outcomes.length ? "failed" : "partial";
}

/** Aísla a la fuente: su excepción o su demora se vuelven `failed`, y las demás siguen. */
async function runSource(source: OsintSource, context: OsintSourceContext): Promise<OsintSourceResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      source.run(context),
      new Promise<OsintSourceResult>((resolve) => {
        timer = setTimeout(
          () => resolve({ status: "failed", detail: `Sin respuesta en ${OSINT_SOURCE_TIMEOUT_MS} ms` }),
          OSINT_SOURCE_TIMEOUT_MS
        );
      }),
    ]);
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Procesa una corrida OSINT. Va separado del worker para que los tests lo
 * ejecuten sin levantar uno, y porque un `Worker` arranca al importarse. Nunca
 * escribe en `scan_runs` ni en `audits.status`: eso le corresponde al Módulo A.
 */
export async function processOsintJob(data: OsintJobData, sources: OsintSource[] = OSINT_SOURCES): Promise<OsintRunStatus> {
  const { organizationId, auditId, osintRunId, actorId, domains } = data;

  const { data: run, error: startError } = await supabaseAdmin
    .from("osint_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", osintRunId)
    .select("id")
    .maybeSingle();
  if (startError) throw new Error(`No se pudo iniciar la corrida OSINT: ${startError.message}`);
  // La auditoría se borró mientras el job esperaba en la cola.
  if (!run) return "failed";

  const sourceStatus: Record<string, Partial<Record<OsintSourceId, unknown>>> = {};
  const outcomes: OsintSourceOutcome[] = [];
  const domainSummaries: Record<string, Partial<Record<OsintSourceId, unknown>>> = {};
  let findingsCount = 0;

  /**
   * Repetir una corrida en la misma auditoría no duplica hallazgos, y el que ya
   * se revisó conserva su estado (falso positivo, riesgo aceptado).
   */
  async function insertNewFindings(findings: NormalizedFinding[]): Promise<number> {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("findings")
      .select("asset_id, source_engine, title")
      .eq("audit_id", auditId)
      .in("source_engine", [...new Set(findings.map((finding) => finding.source_engine))]);
    if (existingError) throw new Error(existingError.message);

    const key = (finding: { asset_id: string | null; source_engine: string; title: string }) =>
      `${finding.asset_id}|${finding.source_engine}|${finding.title}`;
    const known = new Set((existing ?? []).map(key));
    const fresh = findings.filter((finding) => !known.has(key(finding)));
    if (fresh.length === 0) return 0;

    const { error } = await supabaseAdmin.from("findings").insert(fresh);
    if (error) throw new Error(error.message);
    return fresh.length;
  }

  await Promise.all(
    domains.map(async ({ assetId, value: domain }) => {
      const context: OsintSourceContext = { organizationId, auditId, osintRunId, assetId, domain };
      sourceStatus[domain] = {};
      domainSummaries[domain] = {};

      await Promise.all(
        sources.map(async (source) => {
          const startedAt = Date.now();
          const result = await runSource(source, context);
          const findings = result.findings ?? [];

          outcomes.push(result.status);
          sourceStatus[domain]![source.id] = {
            status: result.status,
            detail: result.detail ?? null,
            durationMs: Date.now() - startedAt,
            cached: result.cached ?? false,
          };
          if (result.summary) domainSummaries[domain]![source.id] = result.summary;

          if (findings.length > 0) {
            try {
              findingsCount += await insertNewFindings(findings);
            } catch (err) {
              outcomes.push("failed");
              console.error(`[osint] run=${osintRunId} no se pudieron guardar hallazgos de ${source.id}:`, err);
            }
          }

          await logAuditEvent({
            organizationId,
            actorId,
            action:
              result.status === "not_configured"
                ? AUDIT_ACTIONS.OSINT_SOURCE_NOT_CONFIGURED
                : AUDIT_ACTIONS.OSINT_SOURCE_EXECUTED,
            resourceType: "osint",
            resourceId: osintRunId,
            payloadAfter: {
              domain,
              source: source.id,
              status: result.status,
              findingsCount: findings.length,
              // Mismo patrón que SCAN_EXECUTED: permite comprobar que el resultado no se alteró.
              findingsHash: createHash("sha256").update(JSON.stringify(findings)).digest("hex"),
            },
          });
        })
      );
    })
  );

  const finalStatus = finalOsintStatus(outcomes);
  const { error: finishError } = await supabaseAdmin
    .from("osint_runs")
    .update({
      status: finalStatus,
      source_status: sourceStatus,
      summary: {
        findingsCount,
        ...(Object.values(domainSummaries).some((summary) => Object.keys(summary).length > 0)
          ? { domains: domainSummaries }
          : {}),
      },
      finished_at: new Date().toISOString(),
    })
    .eq("id", osintRunId);
  if (finishError) throw new Error(`No se pudo cerrar la corrida OSINT: ${finishError.message}`);

  return finalStatus;
}
