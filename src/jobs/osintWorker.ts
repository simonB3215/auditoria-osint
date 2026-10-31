import { Worker, type Job } from "bullmq";
import { redisConnectionForWorker } from "../config/redis.js";
import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { OSINT_QUEUE_NAME, type OsintJobData } from "./osintQueue.js";
import { OSINT_SOURCE_TIMEOUT_MS, processOsintJob } from "./osintProcessor.js";

/**
 * Proceso aparte del escaneo: es HTTP y DNS, no nmap, así que se despliega sin
 * nmap y un cuelgue de una fuente no ocupa los slots del Módulo A.
 *
 * `lockDuration` cubre el peor caso, con las fuentes y los dominios en paralelo:
 * la demora máxima de una fuente, más un margen para guardar resultados. Va
 * expresado en la constante para no desincronizarse de ese tope.
 */
const WORKER_LOCK_DURATION_MS = OSINT_SOURCE_TIMEOUT_MS * env.MAX_ASSETS_PER_SCAN + 5 * 60 * 1000;

export const osintWorker = new Worker<OsintJobData>(
  OSINT_QUEUE_NAME,
  async (job: Job<OsintJobData>) => {
    const status = await processOsintJob(job.data);
    console.log(`[osint-worker] run=${job.data.osintRunId} finalizada: ${status}`);
  },
  {
    connection: redisConnectionForWorker,
    concurrency: 4,
    lockDuration: WORKER_LOCK_DURATION_MS,
  }
);

// Con `attempts: 1`, un job caído no vuelve: la corrida no puede quedar activa
// para siempre, porque eso bloquearía nuevas corridas en la auditoría.
osintWorker.on("failed", (job, err) => {
  console.error(`[osint-worker] job ${job?.id} (run=${job?.data.osintRunId}) falló:`, err.message);
  if (!job) return;
  void supabaseAdmin
    .from("osint_runs")
    .update({ status: "failed", finished_at: new Date().toISOString() })
    .eq("id", job.data.osintRunId)
    .in("status", ["queued", "running"])
    .then(({ error }) => {
      if (error) console.error(`[osint-worker] no se pudo cerrar la corrida ${job.data.osintRunId}: ${error.message}`);
    });
});

console.log("OSINT worker escuchando la cola", OSINT_QUEUE_NAME);
