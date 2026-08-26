import { Queue } from "bullmq";
import { redisConnectionForQueue } from "../config/redis.js";
import { supabaseAdmin } from "../config/supabase.js";

export const SCAN_QUEUE_NAME = "scan-jobs";

export interface ScanTargetAsset {
  assetId: string;
  assetType: "ip" | "cidr" | "domain" | "repository" | "cloud_server";
  assetValue: string;
}

export interface ScanJobData {
  organizationId: string;
  auditId: string;
  assets: ScanTargetAsset[];
  /** Quién disparó el escaneo — se usa para atribuir el evento SCAN_EXECUTED en audit_logs. */
  actorId: string;
}

export const scanQueue = new Queue<ScanJobData>(SCAN_QUEUE_NAME, {
  connection: redisConnectionForQueue,
  defaultJobOptions: {
    attempts: 1, // un escaneo fallido no se reintenta automáticamente: requiere revisión (ver audits.status = 'failed')
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/**
 * Cuenta cuántas auditorías de una organización tienen un escaneo
 * actualmente encolado o corriendo. Se consulta `audits.status` (no la
 * cola de BullMQ directamente) porque es la misma fuente de verdad que ya
 * usa el guard `SCAN_ALREADY_IN_PROGRESS` por auditoría individual — acá
 * se generaliza a nivel organización (a.md, hardening del motor de
 * escaneo, sección 1.4: `sensitiveActionRateLimiter` limita por IP, no
 * por tenant, así que no cerraba este caso).
 */
export async function countActiveOrgScans(organizationId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("audits")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["queued", "running"]);
  if (error) throw error;
  return count ?? 0;
}
