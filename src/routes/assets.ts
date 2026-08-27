import { Router } from "express";
import { resolveTxt } from "node:dns/promises";
import { z } from "zod";
import { authenticateToken, requireRole } from "../middlewares/auth.js";
import { sensitiveActionRateLimiter } from "../middlewares/security.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../middlewares/errorHandler.js";
import { supabaseForUser } from "../config/supabase.js";
import { assetInputSchema } from "../validators/assetValidators.js";
import { validateUuidParams } from "../middlewares/validateParams.js";
import { env } from "../config/env.js";
import { AUDIT_ACTIONS, logAuditEvent, requestContext } from "../services/auditLogger.js";
import { sendDomainDelegationEmail } from "../services/emailTemplates.js";
import { domainVerifyQueue, DOMAIN_VERIFY_RETRY_DELAYS_MS } from "../jobs/domainVerifyQueue.js";

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

assetsRouter.post(
  "/assets",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  asyncHandler(async (req, res) => {
    const body = assetInputSchema.parse(req.body);
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);

    const { count: existingCount, error: countError } = await supabase
      .from("assets")
      .select("id", { count: "exact", head: true });
    if (countError) throw new AppError(400, "ASSETS_COUNT_FAILED", countError.message);
    if ((existingCount ?? 0) >= MAX_ASSETS_PER_ORGANIZATION) {
      throw new AppError(
        403,
        "ASSET_LIMIT_REACHED",
        `Tu organización alcanzó el máximo de ${MAX_ASSETS_PER_ORGANIZATION} activos del plan MVP. Eliminá alguno existente antes de registrar uno nuevo.`
      );
    }

    const { data, error } = await supabase
      .from("assets")
      .insert({
        type: body.type,
        value: body.value,
        criticality: body.criticality,
        tags: body.tags,
        organization_id: profile.organizationId,
        created_by: profile.id,
      })
      .select("id, type, value, criticality, tags, verification_status, verification_token, created_at")
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

    // Reintentos automáticos de verificación DNS (a.md, "MVP: REGLAS DE
    // NEGOCIO..."): arrancan solos al crear el dominio, sin que el usuario
    // tenga que volver a tocar nada — el botón "Verificar ahora" sigue
    // sirviendo para no esperar. Best-effort: si Redis no responde, no
    // aborta la creación del activo por eso.
    if (data.type === "domain") {
      await domainVerifyQueue
        .add(
          "retry-verify",
          { assetId: data.id, organizationId: profile.organizationId, attempt: 1 },
          { delay: DOMAIN_VERIFY_RETRY_DELAYS_MS[0] }
        )
        .catch((err) => console.error(`[assets] no se pudo agendar la verificación automática de ${data.id}:`, err));
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
      .select("id, type, value, criticality, tags, verification_status, verification_token, verified_at, created_at")
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
      .select("id, type, value, criticality, tags, verification_status, verification_token, verified_at, created_at")
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
 * Verificación de propiedad. Requisito previo para poder incluir el activo
 * en un escaneo activo (ver POST /audits/:id/run-scan y su security gate
 * explícito para dominios no verificados).
 *
 * - domain: se exige un registro DNS TXT en la RAÍZ del propio dominio
 *   (Nombre: `@`) con el valor `aegis-site-verification=<verification_token>`
 *   — formato de un solo registro, sin subdominio dedicado, para que
 *   cualquier persona no técnica pueda seguir los pasos desde el panel de
 *   su proveedor DNS (Cloudflare, NIC Chile, GoDaddy, etc.).
 * - ip / cidr: no existe un mecanismo DNS equivalente sencillo para el MVP;
 *   se acepta la autoatestación de un rol `ciso` (dueño de la cuenta de la
 *   organización). Limitación conocida: no prueba criptográficamente la
 *   titularidad del rango — a mejorar en una iteración futura (ej. RDAP/WHOIS
 *   cruzado contra el dominio corporativo verificado).
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
      .select("id, type, value, verification_token, verification_status")
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
      const expected = `aegis-site-verification=${asset.verification_token}`;
      let records: string[][] = [];
      try {
        records = await resolveTxt(asset.value);
      } catch {
        throw new AppError(
          422,
          "DNS_RECORD_NOT_FOUND",
          `No se encontró ningún registro TXT en ${asset.value}. Esperado: "${expected}"`
        );
      }
      const found = records.some((chunks) => chunks.join("").trim() === expected);
      if (!found) {
        throw new AppError(
          422,
          "DNS_RECORD_MISMATCH",
          `El registro TXT encontrado no coincide con el código esperado ("${expected}")`
        );
      }
    } else if (profile.role !== "ciso") {
      throw new AppError(
        403,
        "VERIFICATION_REQUIRES_CISO",
        "La verificación de activos IP/CIDR requiere el rol 'ciso'"
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("assets")
      .update({ verification_status: "verified", verified_at: new Date().toISOString() })
      .eq("id", asset.id)
      .select("id, type, value, verification_status, verified_at")
      .single();

    if (updateError) {
      throw new AppError(400, "ASSET_VERIFY_FAILED", updateError.message);
    }

    res.status(200).json({ data: updated });
  })
);

const delegateVerificationSchema = z.object({
  email: z.string().trim().email(),
});

/**
 * Flujo "Enviar a mi equipo de TI" (a.md, sección 3.C): quien pide la
 * auditoría a menudo no es quien tiene acceso al panel DNS. En vez de
 * obligarlo a copiar/pegar el código a mano por fuera de la plataforma, se
 * le arma y envía el correo con el registro TXT exacto. Reusa el patrón
 * "preparado pero no conectado" de emailTemplates.ts — sin RESEND_API_KEY
 * el correo se registra en consola en vez de entregarse de verdad.
 */
assetsRouter.post(
  "/assets/:id/delegate-verification",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  validateUuidParams("id"),
  sensitiveActionRateLimiter,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const body = delegateVerificationSchema.parse(req.body);

    const { data: asset, error: fetchError } = await supabase
      .from("assets")
      .select("id, type, value, verification_token, verification_status")
      .eq("id", req.params.id)
      .maybeSingle();

    if (fetchError) {
      throw new AppError(400, "ASSET_FETCH_FAILED", fetchError.message);
    }
    if (!asset) {
      throw new AppError(404, "ASSET_NOT_FOUND", "Activo no encontrado");
    }
    if (asset.type !== "domain") {
      throw new AppError(
        422,
        "DELEGATION_REQUIRES_DOMAIN",
        "La delegación a TI por correo solo aplica a activos de tipo dominio"
      );
    }
    if (asset.verification_status === "verified") {
      throw new AppError(409, "ASSET_ALREADY_VERIFIED", "Este dominio ya está verificado");
    }

    const [{ data: requesterProfile }, { data: organization }] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", profile.id).maybeSingle(),
      supabase.from("organizations").select("name").eq("id", profile.organizationId).maybeSingle(),
    ]);

    const template = await sendDomainDelegationEmail(body.email, {
      requesterName: requesterProfile?.full_name ?? "Un miembro de tu organización",
      organizationName: organization?.name ?? "su organización",
      domain: asset.value,
      verificationToken: asset.verification_token,
      verifyUrl: `${env.CORS_ORIGIN}/assets`,
    });

    await logAuditEvent({
      organizationId: profile.organizationId,
      actorId: profile.id,
      action: AUDIT_ACTIONS.DOMAIN_VERIFICATION_EMAIL_SENT,
      resourceType: "asset",
      resourceId: asset.id,
      payloadAfter: { domain: asset.value, sentTo: body.email, subject: template.subject },
      ...requestContext(req),
    });

    res.status(202).json({ data: { sentTo: body.email, subject: template.subject } });
  })
);
