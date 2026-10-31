import { Worker } from "bullmq";
import { redisConnectionForWorker } from "../config/redis.js";
import { RETENTION_QUEUE_NAME, scheduleRetentionJob } from "./retentionQueue.js";
import { runRetentionPurge } from "../services/dataRetentionEngine.js";

const worker = new Worker(
  RETENTION_QUEUE_NAME,
  async () => {
    const result = await runRetentionPurge();
    console.log(
      `[retention-worker] ${result.organizationsScanned} organización(es) escaneada(s), ${result.evidencesPurged} evidencia(s) purgada(s), ${result.osintBreachRowsPurged} fila(s) de brechas y ${result.osintCacheRowsPurged} de caché OSINT borrada(s)${result.failures.length > 0 ? `, ${result.failures.length} error(es)` : ""}`
    );
    if (result.failures.length > 0) {
      console.error(`[retention-worker] errores:\n${result.failures.join("\n")}`);
    }
  },
  { connection: redisConnectionForWorker }
);

worker.on("failed", (job, err) => {
  console.error(`[retention-worker] job ${job?.id} falló: ${err.message}`);
});

await scheduleRetentionJob();
console.log("Retention worker escuchando la cola", RETENTION_QUEUE_NAME, "— purga programada cada 24h");
