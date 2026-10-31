import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateToken, requireMfa, requireRole } from "../middlewares/auth.js";
import { sensitiveActionRateLimiter } from "../middlewares/security.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../middlewares/errorHandler.js";
import { supabaseAdmin, supabaseForUser } from "../config/supabase.js";
import { assetInputSchema } from "../validators/assetValidators.js";
import { validateUuidParams } from "../middlewares/validateParams.js";
import { env } from "../config/env.js";
import { AUDIT_ACTIONS, logAuditEvent, requestContext } from "../services/auditLogger.js";
import { checkSubdomainScope, isSubdomainOf } from "../services/subdomainScope.js";

export const assetsRouter = Router();

/**
 * Límite de activos por organización (a.md, "MVP: REGLAS DE NEGOCIO,
 * AUTENTICACIÓN Y MEJORAS DE UX/UI" — "3 a 5 activos"). 5 en vez de 3
 * para no ser tan restrictivo que una auditoría real con un puñado de
 * dominios/IPs no entre en el límite del MVP. Configurable vía
 * `MAX_ASSETS_PER_ORG` (ver `src/config/env.ts`; valor por defecto sin
 * cambios — Fase de auditoría pre-venta, a.md sección 2.2).
 */
const MAX_ASSETS_PER_ORGANIZATION = env.MAX_ASSETS_PER_ORG;

/** El dominio verificado más específico de la organización que contiene a `value`. */
async function findVerifiedParent(
  supabase: SupabaseClient,
  value: string
): Promise<{ id: string; value: string } | null> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, value")
    .eq("type", "domain")
    .eq("verification_status", "verified");
  if (error) throw new AppError(400, "ASSETS_FETCH_FAILED", error.message);

  const parents = (data ?? []).filter((asset) => isSubdomainOf(value, asset.value));
  return parents.sort((a, b) => b.value.length - a.value.length)[0] ?? null;
}

async function assertSubdomainCapacity(supabase: SupabaseClient): Promise<void> {
  const { count, error } = await supabase
    .from("assets")
    .select("id", { count: "exact", head: true })
    .not("parent_asset_id", "is", null);
  if (error) throw new AppError(400, "ASSETS_COUNT_FAILED", error.message);
  if ((count ?? 0) >= env.MAX_SUBDOMAIN_ASSETS_PER_ORG) {
    throw new AppError(
      403,
      "SUBDOMAIN_LIMIT_REACHED",
      `Tu organización alcanzó el máximo de ${env.MAX_SUBDOMAIN_ASSETS_PER_ORG} subdominios. Eliminá alguno antes de registrar uno nuevo.`
    );
  }
}

assetsRouter.post(
  "/assets",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  asyncHandler(async (req, res) => {
    const body = assetInputSchema.parse(req.body);
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);

    // Bajo un dominio ya verificado cuenta como subdominio, con su propio límite.
    const parent = body.type === "domain" ? await findVerifiedParent(supabase, body.value) : null;

    if (parent) {
      await assertSubdomainCapacity(supabase);
    } else {
      const { count: existingCount, error: countError } = await supabase
        .from("assets")
        .select("id", { count: "exact", head: true })
        .is("parent_asset_id", null);
      if (countError) throw new AppError(400, "ASSETS_COUNT_FAILED", countError.message);
      if ((existingCount ?? 0) >= MAX_ASSETS_PER_ORGANIZATION) {
        throw new AppError(
          403,
          "ASSET_LIMIT_REACHED",
          `Tu organización alcanzó el máximo de ${MAX_ASSETS_PER_ORGANIZATION} activos del plan MVP. Eliminá alguno existente antes de registrar uno nuevo.`
        );
      }
    }

    // `parent_asset_id` solo se escribe con service_role (migración 024).
    const { data, error } = await (parent ? supabaseAdmin : supabase)
      .from("assets")
      .insert({
        parent_asset_id: parent?.id ?? null,
        type: body.type,
        value: body.value,
        criticality: body.criticality,
        tags: body.tags,
        organization_id: profile.organizationId,
        created_by: profile.id,
      })
      .select("id, type, value, criticality, tags, verification_status, parent_asset_id, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        // Dos constraints distintas devuelven el mismo código: unique(org,
        // type, value) — este activo puntual ya está en tu organización —
        // o, solo para dominios, el índice único global (ver migración
        // 015): ese dominio ya lo reclamó OTRA organización, así que nunca
        // puede pasar a ser tuyo por más que lo cargues de nuevo.
        if (body.type === "domain" && error.message.includes("idx_assets_domain_global_unique")) {
          throw new AppError(
            409,
            "DOMAIN_ALREADY_CLAIMED",
            "Este dominio ya está registrado por otra organización en la plataforma. Si es tuyo, contactá a soporte."
          );
        }
        throw new AppError(409, "ASSET_ALREADY_EXISTS", "Este activo ya está registrado en tu organización");
      }
      throw new AppError(400, "ASSET_CREATE_FAILED", error.message);
    }

    res.status(201).json({ data });
  })
);

assetsRouter.get(
  "/assets",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);

    let query = supabase
      .from("assets")
      .select("id, type, value, criticality, tags, verification_status, verified_at, parent_asset_id, created_at")
      .order("created_at", { ascending: false });

    const { type, criticality, tag } = req.query;
    if (typeof type === "string") query = query.eq("type", type);
    if (typeof criticality === "string") query = query.eq("criticality", criticality);
    if (typeof tag === "string") query = query.contains("tags", [tag]);

    const { data, error } = await query;

    if (error) {
      throw new AppError(400, "ASSET_LIST_FAILED", error.message);
    }

    res.status(200).json({ data });
  })
);

assetsRouter.get(
  "/assets/:id",
  authenticateToken,
  validateUuidParams("id"),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);

    const { data, error } = await supabase
      .from("assets")
      .select("id, type, value, criticality, tags, verification_status, verified_at, parent_asset_id, created_at")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) {
      throw new AppError(400, "ASSET_FETCH_FAILED", error.message);
    }
    // RLS hace que un activo de otra organización simplemente no aparezca
    // en el resultado: se responde 404 tanto si no existe como si es ajeno,
    // sin filtrar esa distinción entre tenants.
    if (!data) {
      throw new AppError(404, "ASSET_NOT_FOUND", "Activo no encontrado");
    }

    res.status(200).json({ data });
  })
);

assetsRouter.delete(
  "/assets/:id",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  validateUuidParams("id"),
  asyncHandler(async (req, res) => {
    const supabase = supabaseForUser(req.profile!.accessToken);

    const { error, count } = await supabase.from("assets").delete({ count: "exact" }).eq("id", req.params.id);
    if (error) {
      throw new AppError(400, "ASSET_DELETE_FAILED", error.message);
    }
    if (!count) {
      throw new AppError(404, "ASSET_NOT_FOUND", "Activo no encontrado");
    }

    res.status(204).send();
  })
);

/**
 * Verificación de propiedad de activos que no son dominios. Requisito previo
 * para poder incluirlos en un escaneo activo (ver POST /audits/:id/run-scan).
 *
 * - ip / cidr: se acepta la autoatestación de un rol `ciso` (dueño de la
 *   cuenta de la organización). Limitación conocida: no prueba
 *   criptográficamente la titularidad del rango — a mejorar en una iteración
 *   futura (ej. RDAP/WHOIS cruzado contra el dominio corporativo verificado).
 * - domain: nunca se verifica por esta ruta. Exige declaración firmada,
 *   poderes y revisión manual: ver routes/domainVerification.ts.
 */
assetsRouter.post(
  "/assets/:id/verify",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  validateUuidParams("id"),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);

    const { data: asset, error: fetchError } = await supabase
      .from("assets")
      .select("id, type, value, verification_status")
      .eq("id", req.params.id)
      .maybeSingle();

    if (fetchError) {
      throw new AppError(400, "ASSET_FETCH_FAILED", fetchError.message);
    }
    if (!asset) {
      throw new AppError(404, "ASSET_NOT_FOUND", "Activo no encontrado");
    }
    if (asset.verification_status === "verified") {
      res.status(200).json({ data: asset });
      return;
    }

    if (asset.type === "domain") {
      throw new AppError(
        422,
        "DOMAIN_REQUIRES_DECLARATION",
        "Los dominios se verifican con una declaración firmada: ver POST /domain-declarations"
      );
    }
    if (profile.role !== "ciso") {
      throw new AppError(
        403,
        "VERIFICATION_REQUIRES_CISO",
        "La verificación de activos IP/CIDR requiere el rol 'ciso'"
      );
    }

    // Con service_role porque la migración 023 impide escribir estas columnas
    // con el JWT del usuario.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("assets")
      .update({ verification_status: "verified", verified_at: new Date().toISOString() })
      .eq("id", asset.id)
      .eq("organization_id", profile.organizationId)
      .select("id, type, value, verification_status, verified_at")
      .single();

    if (updateError) {
      throw new AppError(400, "ASSET_VERIFY_FAILED", updateError.message);
    }

    res.status(200).json({ data: updated });
  })
);

/**
 * Habilita un subdominio desde su dominio padre verificado, sin repetir la
 * declaración. No aplica si apunta con CNAME a un tercero: eso no es
 * infraestructura del cliente, aunque el dominio padre lo sea.
 */
assetsRouter.post(
  "/assets/:id/enable-from-parent",
  authenticateToken,
  requireRole(["ciso"]),
  requireMfa,
  validateUuidParams("id"),
  sensitiveActionRateLimiter,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);

    const { data: asset, error: fetchError } = await supabase
      .from("assets")
      .select("id, type, value, verification_status, parent_asset_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (fetchError) throw new AppError(400, "ASSET_FETCH_FAILED", fetchError.message);
    if (!asset) throw new AppError(404, "ASSET_NOT_FOUND", "Activo no encontrado");
    if (asset.type !== "domain") {
      throw new AppError(422, "SUBDOMAIN_REQUIRES_DOMAIN", "Solo un dominio se puede habilitar desde su dominio padre");
    }
    if (asset.verification_status === "verified") {
      throw new AppError(409, "ASSET_ALREADY_VERIFIED", "Este subdominio ya está verificado");
    }

    const parent = await findVerifiedParent(supabase, asset.value);
    if (!parent) {
      throw new AppError(422, "NO_VERIFIED_PARENT", "Este dominio no está bajo un dominio verificado de tu organización");
    }
    // Registrado antes de verificar el padre: todavía cuenta como activo normal.
    if (!asset.parent_asset_id) await assertSubdomainCapacity(supabase);

    const scope = await checkSubdomainScope(asset.value, parent.value);
    if (!scope.ok) {
      await logAuditEvent({
        organizationId: profile.organizationId,
        actorId: profile.id,
        action: AUDIT_ACTIONS.SUBDOMAIN_ENABLE_BLOCKED,
        resourceType: "asset",
        resourceId: asset.id,
        payloadAfter: { domain: asset.value, parentDomain: parent.value, ...scope },
        ...requestContext(req),
      });
      if (scope.reason === "third_party_cname") {
        throw new AppError(
          422,
          "SUBDOMAIN_THIRD_PARTY_CNAME",
          `${asset.value} apunta a ${scope.target}, que no es de ${parent.value}. Si esa infraestructura es tuya, verificalo con una declaración propia.`
        );
      }
      if (scope.reason === "not_found") {
        throw new AppError(422, "SUBDOMAIN_NOT_FOUND", `${asset.value} no existe en DNS`);
      }
      throw new AppError(503, "DNS_UNAVAILABLE", "No se pudo comprobar el DNS del subdominio. Intentá de nuevo más tarde.");
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("assets")
      .update({
        verification_status: "verified",
        verified_at: new Date().toISOString(),
        parent_asset_id: parent.id,
      })
      .eq("id", asset.id)
      .eq("organization_id", profile.organizationId)
      .select("id, type, value, verification_status, verified_at, parent_asset_id")
      .single();
    if (updateError) throw new AppError(400, "ASSET_VERIFY_FAILED", updateError.message);

    await logAuditEvent({
      organizationId: profile.organizationId,
      actorId: profile.id,
      action: AUDIT_ACTIONS.SUBDOMAIN_ENABLED,
      resourceType: "asset",
      resourceId: asset.id,
      payloadAfter: { domain: asset.value, parentDomain: parent.value },
      ...requestContext(req),
    });

    res.status(200).json({ data: updated });
  })
);
