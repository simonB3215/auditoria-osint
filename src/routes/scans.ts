import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requireRole } from "../middlewares/auth.js";
import { sensitiveActionRateLimiter } from "../middlewares/security.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../middlewares/errorHandler.js";
import { supabaseForUser } from "../config/supabase.js";
import { scanQueue, countActiveOrgScans, type ScanTargetAsset } from "../jobs/scanQueue.js";
import { validateUuidParams } from "../middlewares/validateParams.js";
import { AUDIT_ACTIONS, logAuditEvent, requestContext } from "../services/auditLogger.js";
import { env } from "../config/env.js";

export const scansRouter = Router();

const runScanBodySchema = z.object({
  asset_ids: z.array(z.string().uuid()).optional(),
});

scansRouter.post(
  "/audits/:auditId/run-scan",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  validateUuidParams("auditId"),
  sensitiveActionRateLimiter,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const auditId = String(req.params.auditId);
    const body = runScanBodySchema.parse(req.body);

    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .select("id, status, organization_id")
      .eq("id", auditId)
      .maybeSingle();

    if (auditError) {
      throw new AppError(400, "AUDIT_FETCH_FAILED", auditError.message);
    }
    if (!audit) {
      throw new AppError(404, "AUDIT_NOT_FOUND", "Auditoría no encontrada");
    }
    if (audit.status === "queued" || audit.status === "running") {
      throw new AppError(409, "SCAN_ALREADY_IN_PROGRESS", "Ya hay un escaneo en curso para esta auditoría");
    }

    let assets: Array<{ id: string; type: string; value: string; verification_status: string }> = [];

    if (body.asset_ids && body.asset_ids.length > 0) {
      // Security gate explícito (a.md, sección "Security Gate"): si el
      // cliente pide activos puntuales por id, hay que distinguir "no
      // verificado" de "no existe / no es tuyo". El cliente scoped-a-RLS
      // ya hace que un activo de otra organización simplemente no vuelva
      // en `requested` — pero eso por sí solo NO basta como control de
      // seguridad auditable: sin este chequeo, ese id "desaparecido" se
      // descartaría en silencio (o, si eran todos los ids pedidos,
      // devolvería un 422 genérico de "no hay activos verificados", sin
      // dejar rastro de que alguien intentó apuntar a un activo ajeno).
      // Fase 2.3 (a.md, auditoría pre-venta): cualquier id pedido que no
      // vuelva de esta consulta (no existe, o pertenece a otra org — RLS
      // no distingue entre ambos casos a propósito, para no filtrar esa
      // información) se trata igual que un activo no verificado: se
      // aborta TODA la solicitud con 403 y se audita el intento.
      const { data: requested, error: requestedError } = await supabase
        .from("assets")
        .select("id, type, value, verification_status")
        .in("id", body.asset_ids);
      if (requestedError) {
        throw new AppError(400, "ASSETS_FETCH_FAILED", requestedError.message);
      }
      const returnedIds = new Set((requested ?? []).map((a) => a.id));
      const notOwnedIds = body.asset_ids.filter((id) => !returnedIds.has(id));
      const unverified = (requested ?? []).filter((a) => a.verification_status !== "verified");
      if (unverified.length > 0 || notOwnedIds.length > 0) {
        await logAuditEvent({
          organizationId: audit.organization_id,
          actorId: profile.id,
          action: AUDIT_ACTIONS.UNAUTHORIZED_SCAN_BLOCKED,
          resourceType: "scan",
          resourceId: auditId,
          payloadAfter: {
            unverifiedAssets: unverified.map((a) => ({ id: a.id, type: a.type, value: a.value })),
            notOwnedOrMissingAssetIds: notOwnedIds,
          },
          ...requestContext(req),
        });
        if (notOwnedIds.length > 0) {
          throw new AppError(
            403,
            "UNAUTHORIZED_SCAN_TARGET",
            `No se puede ejecutar el escaneo: ${notOwnedIds.length} activo(s) seleccionado(s) no existe(n) o no pertenece(n) a tu organización.`
          );
        }
        throw new AppError(
          403,
          "UNAUTHORIZED_SCAN_TARGET",
          `No se puede ejecutar el escaneo: ${unverified.length} activo(s) seleccionado(s) no tiene(n) su propiedad verificada. Verificá el dominio con POST /assets/:id/verify antes de reintentar.`
        );
      }
      assets = requested ?? [];
    } else {
      const { data, error: assetsError } = await supabase
        .from("assets")
        .select("id, type, value, verification_status")
        .eq("verification_status", "verified");
      if (assetsError) {
        throw new AppError(400, "ASSETS_FETCH_FAILED", assetsError.message);
      }
      assets = data ?? [];
    }

    if (assets.length === 0) {
      throw new AppError(
        422,
        "NO_VERIFIED_ASSETS",
        "No hay activos verificados para escanear. Verificá la propiedad del activo con POST /assets/:id/verify antes de lanzar un escaneo."
      );
    }

    // Bloqueo explícito de CIDR (a.md, seguimiento del motor de escaneo,
    // Tarea 1 — riesgo legal activo): combina tres debilidades a la vez —
    // verificación por autoatestación (no prueba propiedad), sin cobertura
    // del chequeo de CDN/proxy (ver ipScopeCheck.ts, solo aplica a
    // domain/ip), y un rango amplio expande la superficie escaneada. El
    // modal de alta ni siquiera ofrece `cidr`, así que hoy es alcanzable
    // solo por una vía que la UI no expone — se rechaza el pedido
    // COMPLETO (no se descarta en silencio el activo cidr y se sigue con
    // el resto) y se audita. Reactivarlo requiere, juntas: verificación de
    // propiedad más fuerte que la autoatestación, cobertura del chequeo de
    // CDN/proxy para rangos, y un tope de tamaño — ver el reporte de esta
    // fase para la alternativa propuesta (no implementada).
    const cidrAssets = assets.filter((a) => a.type === "cidr");
    if (cidrAssets.length > 0) {
      await logAuditEvent({
        organizationId: audit.organization_id,
        actorId: profile.id,
        action: AUDIT_ACTIONS.CIDR_SCAN_BLOCKED,
        resourceType: "scan",
        resourceId: auditId,
        payloadAfter: { blockedAssets: cidrAssets.map((a) => ({ id: a.id, value: a.value })) },
        ...requestContext(req),
      });
      throw new AppError(
        422,
        "CIDR_SCAN_DISABLED",
        "El escaneo de rangos CIDR está deshabilitado por política: la verificación de propiedad actual (autoatestación) no es suficiente para autorizar el escaneo de un rango completo. Escaneá activos individuales (IP o dominio) en su lugar."
      );
    }

    const scanTargets: ScanTargetAsset[] = assets.map((a) => ({
      assetId: a.id,
      assetType: a.type as ScanTargetAsset["assetType"],
      assetValue: a.value,
    }));

    // Rate limiting por organización (a.md, hardening del motor de
    // escaneo, sección 1.4): `sensitiveActionRateLimiter` de arriba limita
    // por IP, no por tenant — esto cierra el hueco de que una sola
    // organización monopolice los slots de `concurrency` globales del
    // worker (ver src/jobs/scanWorker.ts) a costa de las demás. Se chequea
    // acá (después de validar los activos, antes de encolar) para que un
    // intento sobre un activo no autorizado siempre se detecte primero,
    // sin importar cuánta carga tenga la organización en ese momento.
    const activeOrgScans = await countActiveOrgScans(audit.organization_id);
    if (activeOrgScans >= env.MAX_CONCURRENT_SCANS_PER_ORG) {
      throw new AppError(
        429,
        "ORG_SCAN_CONCURRENCY_LIMIT",
        `Tu organización ya tiene ${activeOrgScans} escaneo(s) en curso (máximo ${env.MAX_CONCURRENT_SCANS_PER_ORG} simultáneos). Esperá a que termine alguno antes de lanzar otro.`
      );
    }

    // Vincula los activos escaneados al alcance de esta auditoría (audit_assets).
    const links = scanTargets.map((a) => ({ audit_id: auditId, asset_id: a.assetId }));
    const { error: linkError } = await supabase.from("audit_assets").upsert(links, {
      onConflict: "audit_id,asset_id",
    });
    if (linkError) {
      throw new AppError(400, "AUDIT_ASSETS_LINK_FAILED", linkError.message);
    }

    await supabase.from("audits").update({ status: "queued" }).eq("id", auditId);

    const job = await scanQueue.add("run-scan", {
      organizationId: audit.organization_id,
      auditId,
      assets: scanTargets,
      actorId: profile.id,
    });

    res.status(202).json({
      data: {
        auditId,
        jobId: job.id,
        status: "queued",
        scannedAssets: scanTargets.map((a) => a.assetValue),
      },
    });
  })
);
