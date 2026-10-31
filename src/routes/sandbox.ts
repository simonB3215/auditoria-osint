import { Router } from "express";
import { authenticateToken, requireRole } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../middlewares/errorHandler.js";
import { supabaseAdmin, supabaseForUser } from "../config/supabase.js";
import { scanQueue, countActiveOrgScans, type ScanTargetAsset } from "../jobs/scanQueue.js";
import { AUDIT_ACTIONS, logAuditEvent, requestContext } from "../services/auditLogger.js";
import { env } from "../config/env.js";

export const sandboxRouter = Router();

/**
 * Módulo de simulación (a.md, "MODULO DE SIMULACIÓN (SANDBOX) Y
 * GENERACIÓN DE INFORME TÉCNICO COMPLETO"): deja probar el flujo completo
 * — escaneo, hallazgos, descarte de falsos positivos, reporte PDF — sin
 * necesidad de tener un dominio propio ya verificado. Dispara un escaneo
 * Nmap REAL (mismo `scanQueue`/`scanWorker` que un audit normal, no hay
 * ningún hallazgo inventado) contra `scanme.nmap.org` — el host que el
 * propio proyecto Nmap mantiene y publica explícitamente como target
 * autorizado para pruebas (https://nmap.org/book/testing.html) — así que
 * es un escaneo real y legal sin pedirle a nadie que "sea dueño" de algo.
 * Se usa la IP fija en vez del dominio para no chocar con el índice único
 * GLOBAL de dominios entre organizaciones (migración 015): un `ip` solo
 * es único DENTRO de la organización, así que cada organización puede
 * correr su propia simulación sin pisarse con las demás.
 *
 * Se identifica el audit de sandbox por un título fijo (`SANDBOX_TITLE`)
 * en vez de agregar una columna `is_demo` — no hace falta una migración
 * para un flag que solo le importa a este endpoint.
 */
const SANDBOX_TITLE = "Auditoría de Simulación (Sandbox)";
const SANDBOX_TARGET_IP = "45.33.32.156"; // scanme.nmap.org — target público oficial del proyecto Nmap

async function findSandboxAudit(supabase: ReturnType<typeof supabaseForUser>, organizationId: string) {
  const { data, error } = await supabase
    .from("audits")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("title", SANDBOX_TITLE)
    .maybeSingle();
  if (error) throw new AppError(400, "SANDBOX_LOOKUP_FAILED", error.message);
  return data;
}

sandboxRouter.get(
  "/audits/sandbox",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const existing = await findSandboxAudit(supabase, profile.organizationId);
    res.status(200).json({ data: { auditId: existing?.id ?? null } });
  })
);

sandboxRouter.post(
  "/audits/sandbox",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);

    const existing = await findSandboxAudit(supabase, profile.organizationId);
    if (existing) {
      res.status(200).json({ data: { auditId: existing.id } });
      return;
    }

    // Con service_role porque la migración 023 impide crear un activo ya
    // verificado con el JWT del usuario. El valor es fijo, no viene del request.
    const { data: asset, error: assetError } = await supabaseAdmin
      .from("assets")
      .insert({
        type: "ip",
        value: SANDBOX_TARGET_IP,
        criticality: "baja",
        tags: ["demo"],
        organization_id: profile.organizationId,
        created_by: profile.id,
        verification_status: "verified",
        verified_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (assetError) throw new AppError(400, "SANDBOX_ASSET_CREATE_FAILED", assetError.message);

    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .insert({
        title: SANDBOX_TITLE,
        framework: "ley_21663_cl",
        status: "draft",
        organization_id: profile.organizationId,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (auditError) throw new AppError(400, "SANDBOX_AUDIT_CREATE_FAILED", auditError.message);

    const { error: linkError } = await supabase
      .from("audit_assets")
      .insert({ audit_id: audit.id, asset_id: asset.id });
    if (linkError) throw new AppError(400, "SANDBOX_LINK_FAILED", linkError.message);

    // Mismo límite de concurrencia por organización que scans.ts (a.md,
    // hardening del motor de escaneo, sección 1.4) — el sandbox encola por
    // el mismo scanQueue/scanWorker compartido, así que también cuenta
    // contra el techo de la organización.
    const activeOrgScans = await countActiveOrgScans(profile.organizationId);
    if (activeOrgScans >= env.MAX_CONCURRENT_SCANS_PER_ORG) {
      throw new AppError(
        429,
        "ORG_SCAN_CONCURRENCY_LIMIT",
        `Tu organización ya tiene ${activeOrgScans} escaneo(s) en curso (máximo ${env.MAX_CONCURRENT_SCANS_PER_ORG} simultáneos). Esperá a que termine alguno antes de lanzar otro.`
      );
    }

    // Mismo camino que POST /audits/:id/run-scan (scans.ts): encola el job
    // real en BullMQ y marca el audit "queued". El worker (scanWorker.ts)
    // corre nmap de verdad contra SANDBOX_TARGET_IP y llena `findings` +
    // `scan_runs` — nada de esto se simula acá. Si el worker no está
    // corriendo, o la máquina que lo corre no tiene `nmap` instalado, el
    // audit va a terminar en status "failed", igual que le pasaría a un
    // escaneo real en las mismas condiciones (ver README, "Limitaciones").
    const scanTargets: ScanTargetAsset[] = [{ assetId: asset.id, assetType: "ip", assetValue: SANDBOX_TARGET_IP }];
    await supabase.from("audits").update({ status: "queued" }).eq("id", audit.id);
    await scanQueue.add("run-scan", {
      organizationId: profile.organizationId,
      auditId: audit.id,
      assets: scanTargets,
      actorId: profile.id,
    });

    await logAuditEvent({
      organizationId: profile.organizationId,
      actorId: profile.id,
      action: AUDIT_ACTIONS.SANDBOX_CREATED,
      resourceType: "audit",
      resourceId: audit.id,
      payloadAfter: { auditId: audit.id, assetId: asset.id, target: SANDBOX_TARGET_IP },
      ...requestContext(req),
    });

    res.status(201).json({ data: { auditId: audit.id } });
  })
);

sandboxRouter.delete(
  "/audits/sandbox",
  authenticateToken,
  // Solo 'ciso', igual que borrar cualquier auditoría real (`audits_delete`
  // en db/schema.sql exige current_user_role() = 'ciso') — un 'auditor'
  // podría crear la simulación pero no borrarla, ni siquiera la de él
  // mismo, porque el DELETE de `audits` pasa por el cliente scoped-a-RLS
  // del usuario, no por service_role.
  requireRole(["ciso"]),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);

    const existing = await findSandboxAudit(supabase, profile.organizationId);
    if (!existing) {
      throw new AppError(404, "SANDBOX_NOT_FOUND", "No hay ninguna simulación activa para limpiar");
    }

    const { data: links } = await supabase.from("audit_assets").select("asset_id").eq("audit_id", existing.id);
    const assetIds = (links ?? []).map((l) => l.asset_id);

    // Borrar el audit alcanza para limpiar findings/scan_runs/audit_assets
    // (todas con `on delete cascade` hacia audits) — el asset de
    // SANDBOX_TARGET_IP no cuelga de audits, así que se borra aparte.
    const { error: deleteAuditError } = await supabase.from("audits").delete().eq("id", existing.id);
    if (deleteAuditError) throw new AppError(400, "SANDBOX_DELETE_FAILED", deleteAuditError.message);

    if (assetIds.length > 0) {
      await supabase.from("assets").delete().in("id", assetIds);
    }

    await logAuditEvent({
      organizationId: profile.organizationId,
      actorId: profile.id,
      action: AUDIT_ACTIONS.SANDBOX_DELETED,
      resourceType: "audit",
      resourceId: existing.id,
      payloadBefore: { auditId: existing.id },
      ...requestContext(req),
    });

    res.status(204).send();
  })
);
