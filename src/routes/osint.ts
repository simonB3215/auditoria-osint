import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requireRole } from "../middlewares/auth.js";
import { sensitiveActionRateLimiter } from "../middlewares/security.js";
import { validateUuidParams } from "../middlewares/validateParams.js";
import { AppError } from "../middlewares/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { supabaseAdmin, supabaseForUser } from "../config/supabase.js";
import { env } from "../config/env.js";
import { countActiveOrgOsintRuns, osintQueue } from "../jobs/osintQueue.js";
import { AUDIT_ACTIONS, logAuditEvent, requestContext } from "../services/auditLogger.js";
import { attachParents, TARGET_ASSET_SELECT, type TargetAssetRow } from "../services/assetParents.js";

export const osintRouter = Router();

const runOsintSchema = z.object({
  asset_ids: z.array(z.string().uuid()).min(1).max(200).optional(),
});

const OSINT_RUN_SELECT = "id, status, domains, source_status, summary, started_at, finished_at, created_at";

/**
 * Lanza el reconocimiento pasivo de una auditoría. Aunque no envía tráfico al
 * cliente, aplica la misma barrera que `scans.ts`: solo dominios verificados. Un
 * activo ajeno, inexistente o sin verificar reciben la misma respuesta.
 */
osintRouter.post(
  "/audits/:auditId/osint/run",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  validateUuidParams("auditId"),
  sensitiveActionRateLimiter,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const auditId = req.params.auditId as string;
    const body = runOsintSchema.parse(req.body ?? {});

    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .select("id, organization_id")
      .eq("id", auditId)
      .maybeSingle();
    if (auditError) throw new AppError(400, "AUDIT_FETCH_FAILED", auditError.message);
    if (!audit) throw new AppError(404, "AUDIT_NOT_FOUND", "Auditoría no encontrada");

    let targets: TargetAssetRow[];
    if (body.asset_ids) {
      const { data, error } = await supabase.from("assets").select(TARGET_ASSET_SELECT).in("id", body.asset_ids);
      if (error) throw new AppError(400, "ASSETS_FETCH_FAILED", error.message);
      targets = await attachParents(supabase, (data ?? []) as TargetAssetRow[]);
    } else {
      const { data, error } = await supabase
        .from("assets")
        .select(TARGET_ASSET_SELECT)
        .eq("type", "domain")
        .eq("verification_status", "verified");
      if (error) throw new AppError(400, "ASSETS_FETCH_FAILED", error.message);
      targets = await attachParents(supabase, (data ?? []) as TargetAssetRow[]);
    }

    // Igual que en el escaneo: un subdominio se autorizó por su padre.
    const returnedIds = new Set(targets.map((asset) => asset.id));
    const notOwnedIds = (body.asset_ids ?? []).filter((id) => !returnedIds.has(id));
    const unauthorized = targets.filter(
      (asset) =>
        asset.verification_status !== "verified" || (asset.parent && asset.parent.verification_status !== "verified")
    );
    if (notOwnedIds.length > 0 || unauthorized.length > 0) {
      await logAuditEvent({
        organizationId: audit.organization_id,
        actorId: profile.id,
        action: AUDIT_ACTIONS.UNAUTHORIZED_OSINT_BLOCKED,
        resourceType: "osint",
        resourceId: auditId,
        payloadAfter: {
          unverifiedAssets: unauthorized.map((asset) => ({ id: asset.id, type: asset.type, value: asset.value })),
          notOwnedOrMissingAssetIds: notOwnedIds,
        },
        ...requestContext(req),
      });
      throw new AppError(
        403,
        "UNAUTHORIZED_SCAN_TARGET",
        "No se puede ejecutar el reconocimiento: algún activo no existe, no es de tu organización o no tiene su propiedad verificada."
      );
    }

    if (targets.some((asset) => asset.type !== "domain")) {
      throw new AppError(422, "OSINT_REQUIRES_DOMAIN", "El reconocimiento pasivo solo aplica a activos de tipo dominio");
    }
    if (targets.length === 0) {
      throw new AppError(422, "NO_VERIFIED_DOMAINS", "No hay dominios verificados para el reconocimiento");
    }
    if (targets.length > env.MAX_ASSETS_PER_SCAN) {
      throw new AppError(
        422,
        "TOO_MANY_DOMAINS_PER_OSINT_RUN",
        `Una corrida admite hasta ${env.MAX_ASSETS_PER_SCAN} dominios y esta tiene ${targets.length}. Elegí menos dominios.`
      );
    }

    const activeRuns = await countActiveOrgOsintRuns(audit.organization_id);
    if (activeRuns >= env.MAX_CONCURRENT_OSINT_RUNS_PER_ORG) {
      const { count } = await supabaseAdmin
        .from("osint_runs")
        .select("id", { count: "exact", head: true })
        .eq("audit_id", auditId)
        .in("status", ["queued", "running"]);
      if ((count ?? 0) > 0) {
        throw new AppError(409, "OSINT_ALREADY_IN_PROGRESS", "Ya hay un reconocimiento en curso para esta auditoría");
      }
      throw new AppError(
        429,
        "ORG_OSINT_CONCURRENCY_LIMIT",
        `Tu organización ya tiene ${activeRuns} reconocimiento(s) en curso. Esperá a que termine antes de lanzar otro.`
      );
    }

    const domains = targets.map((asset) => ({ assetId: asset.id, value: asset.value }));
    const osintRunId = randomUUID();
    const { error: insertError } = await supabaseAdmin.from("osint_runs").insert({
      id: osintRunId,
      organization_id: audit.organization_id,
      audit_id: auditId,
      requested_by: profile.id,
      domains: domains.map((domain) => domain.value),
    });
    if (insertError) {
      // Otra petición simultánea ganó: ver idx_osint_runs_one_active.
      if (insertError.code === "23505") {
        throw new AppError(409, "OSINT_ALREADY_IN_PROGRESS", "Ya hay un reconocimiento en curso para esta auditoría");
      }
      throw new AppError(400, "OSINT_RUN_CREATE_FAILED", insertError.message);
    }

    let jobId: string | undefined;
    try {
      const job = await osintQueue.add("osint-run", {
        organizationId: audit.organization_id,
        auditId,
        osintRunId,
        actorId: profile.id,
        domains,
      });
      jobId = job.id;
    } catch (err) {
      // Sin esto, la corrida quedaría activa para siempre y bloquearía la auditoría.
      await supabaseAdmin
        .from("osint_runs")
        .update({ status: "failed", finished_at: new Date().toISOString() })
        .eq("id", osintRunId);
      console.error(`[osint] no se pudo encolar la corrida ${osintRunId}:`, err);
      throw new AppError(503, "OSINT_QUEUE_UNAVAILABLE", "No se pudo iniciar el reconocimiento. Intentá de nuevo más tarde.");
    }

    await logAuditEvent({
      organizationId: audit.organization_id,
      actorId: profile.id,
      action: AUDIT_ACTIONS.OSINT_RUN_REQUESTED,
      resourceType: "osint",
      resourceId: osintRunId,
      payloadAfter: { auditId, domains: domains.map((domain) => domain.value) },
      ...requestContext(req),
    });

    res.status(202).json({
      data: { osintRunId, jobId, status: "queued", domains: domains.map((domain) => domain.value) },
    });
  })
);

osintRouter.get(
  "/audits/:auditId/osint",
  authenticateToken,
  validateUuidParams("auditId"),
  asyncHandler(async (req, res) => {
    const supabase = supabaseForUser(req.profile!.accessToken);
    const auditId = req.params.auditId as string;

    const { data: audit, error: auditError } = await supabase.from("audits").select("id").eq("id", auditId).maybeSingle();
    if (auditError) throw new AppError(400, "AUDIT_FETCH_FAILED", auditError.message);
    if (!audit) throw new AppError(404, "AUDIT_NOT_FOUND", "Auditoría no encontrada");

    const { data: runs, error } = await supabase
      .from("osint_runs")
      .select(OSINT_RUN_SELECT)
      .eq("audit_id", auditId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new AppError(400, "OSINT_RUNS_FETCH_FAILED", error.message);

    res.status(200).json({ data: { latest: runs?.[0] ?? null, history: runs ?? [] } });
  })
);

/**
 * Subdominios de la última corrida terminada. `registered` se calcula al leer,
 * porque el usuario puede registrar el activo después de la corrida.
 */
osintRouter.get(
  "/audits/:auditId/osint/subdomains",
  authenticateToken,
  validateUuidParams("auditId"),
  asyncHandler(async (req, res) => {
    const supabase = supabaseForUser(req.profile!.accessToken);
    const auditId = req.params.auditId as string;

    const { data: audit, error: auditError } = await supabase.from("audits").select("id").eq("id", auditId).maybeSingle();
    if (auditError) throw new AppError(400, "AUDIT_FETCH_FAILED", auditError.message);
    if (!audit) throw new AppError(404, "AUDIT_NOT_FOUND", "Auditoría no encontrada");

    const { data: run, error: runError } = await supabase
      .from("osint_runs")
      .select("id")
      .eq("audit_id", auditId)
      .in("status", ["completed", "partial"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError) throw new AppError(400, "OSINT_RUNS_FETCH_FAILED", runError.message);
    if (!run) {
      res.status(200).json({ data: [] });
      return;
    }

    const [{ data: subdomains, error: subdomainsError }, { data: assets, error: assetsError }] = await Promise.all([
      supabase
        .from("osint_discovered_subdomains")
        .select("id, hostname, first_seen, last_seen, resolved_ips, behind_cdn, status, parent_asset_id")
        .eq("osint_run_id", run.id)
        .order("hostname"),
      supabase.from("assets").select("value"),
    ]);
    if (subdomainsError) throw new AppError(400, "OSINT_SUBDOMAINS_FETCH_FAILED", subdomainsError.message);
    if (assetsError) throw new AppError(400, "ASSETS_FETCH_FAILED", assetsError.message);

    const registered = new Set((assets ?? []).map((asset) => asset.value.toLowerCase()));
    res.status(200).json({
      data: (subdomains ?? []).map((row) => ({ ...row, registered: registered.has(row.hostname.toLowerCase()) })),
    });
  })
);

const updateSubdomainSchema = z.object({ status: z.enum(["new", "dismissed"]) });

osintRouter.patch(
  "/osint/subdomains/:id",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  validateUuidParams("id"),
  asyncHandler(async (req, res) => {
    const body = updateSubdomainSchema.parse(req.body);
    const { data, error } = await supabaseForUser(req.profile!.accessToken)
      .from("osint_discovered_subdomains")
      .update({ status: body.status })
      .eq("id", req.params.id)
      .select("id, hostname, status")
      .maybeSingle();
    if (error) throw new AppError(400, "OSINT_SUBDOMAIN_UPDATE_FAILED", error.message);
    if (!data) throw new AppError(404, "OSINT_SUBDOMAIN_NOT_FOUND", "Subdominio no encontrado");

    res.status(200).json({ data });
  })
);
