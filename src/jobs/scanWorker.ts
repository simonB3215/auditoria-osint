import { createHash } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { redisConnectionForWorker } from "../config/redis.js";
import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { SCAN_QUEUE_NAME, type ScanJobData } from "./scanQueue.js";
import {
  runNmapScan,
  checkTlsCertificate,
  checkSecurityHeaders,
  isHttpsPort,
  isHttpLikePort,
  NMAP_TIMEOUT_MS,
} from "./scanEngine.js";
import { resolveAndCheckScope, matchCdnRange } from "./ipScopeCheck.js";
import {
  normalizeOpenPorts,
  normalizeTlsFindings,
  normalizeHeaderFindings,
  type NormalizedFinding,
} from "../services/findingsNormalization.js";
import { logAuditEvent, AUDIT_ACTIONS } from "../services/auditLogger.js";
import { sendScanCompletedEmail } from "../services/emailTemplates.js";

const NETWORK_SCANNABLE_TYPES = new Set(["ip", "domain", "cidr"]);

/**
 * Margen de chequeos TLS/cabeceras por activo (a.md, seguimiento del
 * motor de escaneo, Tarea 2). No escala con `SCAN_TOP_PORTS`: los
 * chequeos de TLS/cabeceras solo se disparan sobre puertos HTTP(S) bien
 * conocidos y fijos (`HTTPS_PORTS`/`HTTP_LIKE_PORTS` en scanEngine.ts —
 * 443/8443 y 80/443/8080/8443), sin importar cuántos puertos totales
 * escaneó nmap. Peor caso real: 2 chequeos TLS (443, 8443) + 4 chequeos
 * de cabeceras (80, 443, 8080, 8443) × `CHECK_TIMEOUT_MS` (8s) = 48s;
 * redondeado a 60s de margen.
 */
const PER_ASSET_CHECKS_MARGIN_MS = 60 * 1000;

/**
 * Presupuesto de tiempo total por job (a.md, hardening del motor de
 * escaneo sección 1.2; recalculado en el seguimiento, Tarea 2).
 * `processScanJob` recorre los activos en SECUENCIA, así que el peor caso
 * real es la suma de todos: `MAX_ASSETS_PER_ORG` activos, cada uno hasta
 * `NMAP_TIMEOUT_MS` (el timeout duro de una sola invocación de nmap,
 * importado de scanEngine.ts — no un valor separado que pueda
 * desincronizarse) más el margen de chequeos de arriba. Derivado de
 * `env.MAX_ASSETS_PER_ORG`, no hardcodeado, para que si ese límite
 * cambia, el presupuesto se recalcula solo.
 *
 * Nota sobre el acoplamiento con Tarea 3 (`SCAN_TOP_PORTS`): ampliar el
 * rango de puertos alarga cuánto tarda nmap en la práctica, pero el PISO
 * de este cálculo ya usa el TOPE del timeout de nmap (`NMAP_TIMEOUT_MS`),
 * que es el mismo sin importar `--top-ports` — nmap corta a los 5 min
 * igual con 100 o con 5000 puertos. Por eso el número no cambia numéricamente
 * al tocar Tarea 3, pero si en el futuro se saca ese timeout duro o se
 * hace variable, este presupuesto tiene que recalcularse — de ahí que
 * quede expresado en términos de la constante, no de un número suelto.
 */
const JOB_TIME_BUDGET_MS = env.MAX_ASSETS_PER_ORG * (NMAP_TIMEOUT_MS + PER_ASSET_CHECKS_MARGIN_MS);

/**
 * `lockDuration` del Worker (ver más abajo): tiene que ser mayor al peor
 * caso de duración de un job para que BullMQ no lo marque "stalled" y lo
 * reasigne mientras todavía está corriendo de verdad — con `attempts: 1`
 * en la cola (scanQueue.ts), un job reasignado por error no se reintenta
 * limpio. Se fija en el presupuesto de tiempo total del job más un margen
 * de seguridad de 5 minutos (para el trabajo posterior al último activo:
 * inserts en `findings`/`scan_runs`, envío de email).
 */
const WORKER_LOCK_DURATION_MS = JOB_TIME_BUDGET_MS + 5 * 60 * 1000;

/** Hash de integridad de los hallazgos de un activo — permite comprobar después que un resultado no fue alterado. */
function hashFindings(findings: NormalizedFinding[]): string {
  const canonical = findings
    .map((f) => `${f.source_engine}|${f.title}|${f.severity}|${f.detail}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

async function processScanJob(job: Job<ScanJobData>): Promise<void> {
  const { organizationId, auditId, assets, actorId } = job.data;
  const startedAt = new Date();
  const deadline = startedAt.getTime() + JOB_TIME_BUDGET_MS;

  await supabaseAdmin.from("audits").update({ status: "running" }).eq("id", auditId);

  const allFindings: NormalizedFinding[] = [];
  const failures: string[] = [];
  const skipped: string[] = [];
  let budgetExceeded = false;

  for (let i = 0; i < assets.length; i++) {
    // Presupuesto de tiempo total del job (a.md, sección 1.2): si ya no
    // queda margen, no se arrancan más activos — los que faltan quedan
    // marcados como no procesados, en vez de seguir corriendo sin techo.
    if (Date.now() >= deadline) {
      budgetExceeded = true;
      for (const remaining of assets.slice(i)) {
        skipped.push(`${remaining.assetValue}: no procesado, se agotó el presupuesto de tiempo total del job`);
      }
      break;
    }

    const asset = assets[i];

    // Bloqueo explícito de CIDR (a.md, seguimiento del motor de escaneo,
    // Tarea 1) — salvaguarda de defensa en profundidad: `scans.ts` ya
    // rechaza esto en el punto de entrada, esto cubre el caso de que un
    // job con un activo `cidr` llegue igual al worker por otra vía.
    // Deliberadamente ANTES del chequeo de `NETWORK_SCANNABLE_TYPES` de
    // abajo y con su propio evento — "bloqueado por política" es
    // semánticamente distinto de "tipo no soportado" (repository/cloud_server).
    if (asset.assetType === "cidr") {
      const detail = `${asset.assetValue}: escaneo de CIDR deshabilitado por política (verificación de propiedad insuficiente para un rango completo)`;
      failures.push(detail);
      await logAuditEvent({
        organizationId,
        actorId,
        action: AUDIT_ACTIONS.CIDR_SCAN_BLOCKED,
        resourceType: "scan",
        resourceId: asset.assetId,
        payloadAfter: { target: asset.assetValue, assetType: asset.assetType, detail },
      });
      continue;
    }

    // repository/cloud_server no son targets de un scan de red (nmap no
    // aplica a una URL de git ni a un identificador de recurso cloud) — un
    // motor de análisis distinto (secret scanning, cloud config audit)
    // queda fuera del alcance de este MVP.
    if (!NETWORK_SCANNABLE_TYPES.has(asset.assetType)) {
      skipped.push(`${asset.assetValue} (tipo ${asset.assetType} no soportado por el motor de red actual)`);
      continue;
    }

    // Resolución de CDN/proxy (a.md, sección 1.1): un dominio detrás de un
    // proxy (ej. Cloudflare) escanearía la infraestructura de un tercero,
    // no la del cliente — eso viola la Regla de alcance 1. Para `ip` el
    // valor del activo YA es la IP a escanear, se chequea directo. `cidr`
    // nunca llega hasta acá (bloqueado arriba).
    let scanTarget = asset.assetValue;
    if (asset.assetType === "domain") {
      const scopeCheck = await resolveAndCheckScope(asset.assetValue);
      if (!scopeCheck.ok) {
        failures.push(`${asset.assetValue}: ${scopeCheck.detail}`);
        if (scopeCheck.reason === "cdn_or_proxy") {
          await logAuditEvent({
            organizationId,
            actorId,
            action: AUDIT_ACTIONS.SCAN_TARGET_OUT_OF_SCOPE,
            resourceType: "scan",
            resourceId: asset.assetId,
            payloadAfter: { target: asset.assetValue, assetType: asset.assetType, detail: scopeCheck.detail },
          });
        }
        continue;
      }
      // Se escanea la IP ya verificada, nunca el dominio original — evita
      // que una segunda resolución (dentro de nmap) devuelva algo distinto
      // a lo que este chequeo ya validó.
      scanTarget = scopeCheck.targetIp;
    } else if (asset.assetType === "ip") {
      const directMatch = matchCdnRange(asset.assetValue);
      if (directMatch) {
        const detail = `${asset.assetValue} está dentro del rango publicado de ${directMatch.provider} (${directMatch.cidr}) — infraestructura de terceros, fuera de alcance.`;
        failures.push(detail);
        await logAuditEvent({
          organizationId,
          actorId,
          action: AUDIT_ACTIONS.SCAN_TARGET_OUT_OF_SCOPE,
          resourceType: "scan",
          resourceId: asset.assetId,
          payloadAfter: { target: asset.assetValue, assetType: asset.assetType, detail },
        });
        continue;
      }
    }

    const result = await runNmapScan(scanTarget, env.SCAN_TOP_PORTS);
    if (!result.ok) {
      failures.push(`${asset.assetValue}: ${result.detail}`);
      continue;
    }

    const assetFindings: NormalizedFinding[] = [...normalizeOpenPorts(auditId, asset.assetId, asset.assetValue, result.openPorts)];

    // Chequeos de TLS/cabeceras: tienen sentido contra un host puntual
    // (ip/domain) — `cidr` (un rango, sin un único host contra el cual
    // conectar) ya no llega hasta acá, se bloquea antes (ver arriba), así
    // que ya no hace falta excluirlo acá aparte.
    for (const p of result.openPorts) {
      if (isHttpsPort(p.port)) {
        const tlsFindings = await checkTlsCertificate(asset.assetValue, p.port);
        assetFindings.push(...normalizeTlsFindings(auditId, asset.assetId, asset.assetValue, p.port, tlsFindings));
      }
      if (isHttpLikePort(p.port)) {
        const useHttps = isHttpsPort(p.port);
        const headerFindings = await checkSecurityHeaders(asset.assetValue, p.port, useHttps);
        assetFindings.push(
          ...normalizeHeaderFindings(auditId, asset.assetId, asset.assetValue, p.port, useHttps, headerFindings)
        );
      }
    }

    allFindings.push(...assetFindings);

    // Trazabilidad ANCI/ISO 27001 (a.md): un registro inmutable por cada
    // activo efectivamente escaneado, con un hash de integridad del
    // resultado — permite comprobar después que ese resultado no fue
    // alterado, sin necesitar guardar los hallazgos crudos otra vez acá.
    await logAuditEvent({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.SCAN_EXECUTED,
      resourceType: "scan",
      resourceId: asset.assetId,
      payloadAfter: {
        target: asset.assetValue,
        assetType: asset.assetType,
        scanResultsHash: hashFindings(assetFindings),
        findingsCount: assetFindings.length,
      },
    });
  }

  if (allFindings.length > 0) {
    const { error } = await supabaseAdmin.from("findings").insert(allFindings);
    if (error) {
      await supabaseAdmin.from("audits").update({ status: "failed" }).eq("id", auditId);
      throw new Error(`No se pudieron insertar los hallazgos: ${error.message}`);
    }
  }

  // Si TODOS los activos escaneables fallaron (ej. nmap no disponible), la
  // auditoría se marca como failed en lugar de completed con cero
  // hallazgos, para no dar una falsa sensación de "todo limpio". Un corte
  // por presupuesto de tiempo (sección 1.2) también se trata como failed:
  // no existe un estado "parcial" en el enum `audit_status` sin una
  // migración (draft/queued/running/completed/failed — ver db/schema.sql),
  // y agregar uno excede lo que corresponde a un "arreglo seguro" de esta
  // fase. Los hallazgos que sí llegaron a insertarse antes del corte no se
  // descartan — quedan en `findings` igual.
  const scannable = assets.filter((a) => NETWORK_SCANNABLE_TYPES.has(a.assetType));
  const allFailed = scannable.length > 0 && failures.length === scannable.length;
  const finalStatus = budgetExceeded || allFailed ? "failed" : "completed";
  await supabaseAdmin.from("audits").update({ status: finalStatus }).eq("id", auditId);

  if (budgetExceeded) {
    await logAuditEvent({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.SCAN_TIME_BUDGET_EXCEEDED,
      resourceType: "scan",
      resourceId: auditId,
      payloadAfter: { budgetMs: JOB_TIME_BUDGET_MS, skippedAssets: skipped },
    });
  }

  // Registro de la ejecución para el motor de costos FinOps (src/services/costEngine.ts):
  // sin esto no hay forma de saber cuántas veces se re-escaneó una auditoría
  // ni cuánto "tiempo de worker" consumió.
  const finishedAt = new Date();
  await supabaseAdmin.from("scan_runs").insert({
    audit_id: auditId,
    assets_scanned: scannable.length,
    findings_count: allFindings.length,
    status: finalStatus,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  });

  if (failures.length > 0) {
    console.error(`[scan-worker] audit=${auditId} fallos parciales:\n${failures.join("\n")}`);
  }
  if (skipped.length > 0) {
    console.log(`[scan-worker] audit=${auditId} activos omitidos:\n${skipped.join("\n")}`);
  }
  console.log(
    `[scan-worker] audit=${auditId} finalizado: ${allFindings.length} hallazgo(s), ${failures.length} activo(s) con error, ${skipped.length} omitido(s)`
  );

  // Notificación por email (a.md, "MVP: REGLAS DE NEGOCIO..."): un solo
  // correo cuando el audit termina `completed` — nunca en `failed`, ahí no
  // hay nada que reportar todavía. Mismo patrón "preparado pero no
  // conectado" que el resto de los emails (ver emailTemplates.ts): sin
  // RESEND_API_KEY, se registra en consola en vez de fallar el job entero
  // por un error de notificación best-effort.
  if (finalStatus !== "failed") {
    try {
      const [{ data: audit }, { data: actorProfile }, { data: actorUser }] = await Promise.all([
        supabaseAdmin.from("audits").select("title").eq("id", auditId).maybeSingle(),
        supabaseAdmin.from("profiles").select("full_name").eq("id", actorId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(actorId),
      ]);
      const recipientEmail = actorUser?.user?.email;
      if (audit && recipientEmail) {
        const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
        await sendScanCompletedEmail(recipientEmail, {
          recipientName: actorProfile?.full_name ?? recipientEmail,
          auditTitle: audit.title,
          findingsCount: allFindings.length,
          criticalCount,
          auditUrl: `${env.CORS_ORIGIN}/audits/${auditId}`,
        });
      }
    } catch (err) {
      console.error(`[scan-worker] audit=${auditId} no se pudo enviar el email de notificación:`, err);
    }
  }
}

export const scanWorker = new Worker<ScanJobData>(SCAN_QUEUE_NAME, processScanJob, {
  connection: redisConnectionForWorker,
  concurrency: 4,
  // Default de BullMQ (30s) es muy corto frente a un job que puede tardar
  // hasta JOB_TIME_BUDGET_MS — ver el comentario de esa constante más
  // arriba (a.md, hardening del motor de escaneo, sección 1.2).
  lockDuration: WORKER_LOCK_DURATION_MS,
});

scanWorker.on("failed", (job, err) => {
  console.error(`[scan-worker] job ${job?.id} (audit=${job?.data.auditId}) falló: ${err.message}`);
});

console.log("Scan worker escuchando la cola", SCAN_QUEUE_NAME);
