import { createHash } from "node:crypto";
import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { AUDIT_ACTIONS, logAuditEvent } from "../services/auditLogger.js";
import { OSINT_SOURCES } from "../services/osint/index.js";
import type {
  OsintSource,
  OsintSourceContext,
  OsintSourceId,
  OsintSourceOutcome,
  OsintSourceResult,
} from "../services/osint/types.js";
import type { OsintJobData } from "./osintQueue.js";

/** Tope por fuente y dominio: alcanza para los reintentos de varias consultas. */
const SOURCE_TIMEOUT_FACTOR = 4;

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
  let findingsCount = 0;

  await Promise.all(
    domains.map(async ({ assetId, value: domain }) => {
      const context: OsintSourceContext = { organizationId, auditId, osintRunId, assetId, domain };
      sourceStatus[domain] = {};

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

          if (findings.length > 0) {
            const { error } = await supabaseAdmin.from("findings").insert(findings);
            if (error) {
              outcomes.push("failed");
              console.error(`[osint] run=${osintRunId} no se pudieron guardar hallazgos de ${source.id}: ${error.message}`);
            } else {
              findingsCount += findings.length;
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
      summary: { findingsCount },
      finished_at: new Date().toISOString(),
    })
    .eq("id", osintRunId);
  if (finishError) throw new Error(`No se pudo cerrar la corrida OSINT: ${finishError.message}`);

  return finalStatus;
}
