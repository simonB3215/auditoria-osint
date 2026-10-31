import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { logAuditEvent, AUDIT_ACTIONS } from "./auditLogger.js";

/** Tope para datos de brechas: aplica aunque la organización no tenga política de retención. */
const OSINT_BREACH_MAX_RETENTION_DAYS = 365;

export interface OsintPurgeResult {
  breachRowsPurged: number;
  cacheRowsPurged: number;
  failures: string[];
}

export interface RetentionPurgeResult {
  organizationsScanned: number;
  evidencesPurged: number;
  osintBreachRowsPurged: number;
  osintCacheRowsPurged: number;
  failures: string[];
}

/**
 * A diferencia de las evidencias, acá se borra la fila: es información de
 * personas y no hay un metadato que deba quedar por razones legales. Recorre
 * todas las organizaciones, no solo las que tienen política, por el tope.
 */
export async function purgeOsintData(): Promise<OsintPurgeResult> {
  const { data: organizations, error } = await supabaseAdmin.from("organizations").select("id, retention_period_days");
  if (error) throw new Error(`No se pudieron leer las organizaciones: ${error.message}`);

  const result: OsintPurgeResult = { breachRowsPurged: 0, cacheRowsPurged: 0, failures: [] };

  for (const org of organizations ?? []) {
    const policyDays = org.retention_period_days && org.retention_period_days > 0 ? org.retention_period_days : null;
    const retentionDays = Math.min(policyDays ?? OSINT_BREACH_MAX_RETENTION_DAYS, OSINT_BREACH_MAX_RETENTION_DAYS);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const { count: breachRows, error: breachError } = await supabaseAdmin
      .from("osint_breach_exposures")
      .delete({ count: "exact" })
      .eq("organization_id", org.id)
      .lt("created_at", cutoff);
    if (breachError) result.failures.push(`osint org ${org.id}: ${breachError.message}`);

    const { count: cacheRows, error: cacheError } = await supabaseAdmin
      .from("osint_source_cache")
      .delete({ count: "exact" })
      .eq("organization_id", org.id)
      .lt("expires_at", new Date().toISOString());
    if (cacheError) result.failures.push(`osint org ${org.id}: ${cacheError.message}`);

    result.breachRowsPurged += breachRows ?? 0;
    result.cacheRowsPurged += cacheRows ?? 0;

    if ((breachRows ?? 0) > 0 || (cacheRows ?? 0) > 0) {
      await logAuditEvent({
        organizationId: org.id,
        actorId: null,
        action: AUDIT_ACTIONS.OSINT_DATA_PURGED,
        resourceType: "osint",
        resourceId: null,
        payloadAfter: { breachRows: breachRows ?? 0, cacheRows: cacheRows ?? 0, retentionDays },
      });
    }
  }

  return result;
}

/**
 * Borra el binario en Storage de las evidencias más viejas que la política
 * de retención de su organización, y marca la fila como purgada — nunca
 * borra la fila (queda el metadato para fines legales, ver a.md). Se
 * ejecuta desde un Worker de BullMQ con repeat schedule (ver
 * src/jobs/retentionWorker.ts) y también puede dispararse manualmente vía
 * POST /admin/retention/run-now.
 */
export async function runRetentionPurge(): Promise<RetentionPurgeResult> {
  const { data: organizations, error: orgsError } = await supabaseAdmin
    .from("organizations")
    .select("id, retention_period_days")
    .not("retention_period_days", "is", null);

  if (orgsError) throw new Error(`No se pudieron leer las organizaciones: ${orgsError.message}`);

  const result: RetentionPurgeResult = {
    organizationsScanned: organizations?.length ?? 0,
    evidencesPurged: 0,
    osintBreachRowsPurged: 0,
    osintCacheRowsPurged: 0,
    failures: [],
  };

  for (const org of organizations ?? []) {
    const retentionDays = org.retention_period_days;
    if (!retentionDays || retentionDays <= 0) continue;

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: audits } = await supabaseAdmin.from("audits").select("id").eq("organization_id", org.id);
    const auditIds = (audits ?? []).map((a) => a.id);
    if (auditIds.length === 0) continue;

    const { data: evidences, error: evidencesError } = await supabaseAdmin
      .from("audit_evidences")
      .select("id, audit_id, storage_path, file_name, created_at")
      .in("audit_id", auditIds)
      .eq("is_purged", false)
      .lt("created_at", cutoff);

    if (evidencesError) {
      result.failures.push(`org ${org.id}: ${evidencesError.message}`);
      continue;
    }

    for (const evidence of evidences ?? []) {
      const { error: removeError } = await supabaseAdmin.storage.from(env.EVIDENCE_BUCKET).remove([evidence.storage_path]);
      if (removeError) {
        result.failures.push(`evidence ${evidence.id}: ${removeError.message}`);
        continue;
      }

      const purgedAt = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from("audit_evidences")
        .update({ is_purged: true, purged_at: purgedAt })
        .eq("id", evidence.id);

      if (updateError) {
        result.failures.push(`evidence ${evidence.id}: ${updateError.message}`);
        continue;
      }

      result.evidencesPurged += 1;

      await logAuditEvent({
        organizationId: org.id,
        actorId: null,
        action: AUDIT_ACTIONS.EVIDENCE_PURGED,
        resourceType: "evidence",
        resourceId: evidence.id,
        payloadBefore: { file_name: evidence.file_name, storage_path: evidence.storage_path },
        payloadAfter: { is_purged: true, purged_at: purgedAt, retention_period_days: retentionDays },
      });
    }
  }

  // Aislada de las evidencias: un fallo acá no debe frenar esa purga, ni al revés.
  try {
    const osint = await purgeOsintData();
    result.osintBreachRowsPurged = osint.breachRowsPurged;
    result.osintCacheRowsPurged = osint.cacheRowsPurged;
    result.failures.push(...osint.failures);
  } catch (err) {
    result.failures.push(`osint: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}
