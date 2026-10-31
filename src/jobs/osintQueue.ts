import { Queue } from "bullmq";
import { redisConnectionForQueue } from "../config/redis.js";
import { supabaseAdmin } from "../config/supabase.js";

export const OSINT_QUEUE_NAME = "osint-jobs";

export interface OsintJobData {
  organizationId: string;
  auditId: string;
  osintRunId: string;
  actorId: string;
  domains: Array<{ assetId: string; value: string }>;
}

export const osintQueue = new Queue<OsintJobData>(OSINT_QUEUE_NAME, {
  connection: redisConnectionForQueue,
  defaultJobOptions: {
    attempts: 1, // los reintentos son por fuente (ver services/osint/httpClient.ts), no por job
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export async function countActiveOrgOsintRuns(organizationId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("osint_runs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["queued", "running"]);
  if (error) throw error;
  return count ?? 0;
}
