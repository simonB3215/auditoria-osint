import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticateToken, requirePlatformAdmin, requireRole } from "../middlewares/auth.js";
import { sensitiveActionRateLimiter } from "../middlewares/security.js";
import { validateUuidParams } from "../middlewares/validateParams.js";
import { AppError } from "../middlewares/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { supabaseAdmin, supabaseForUser } from "../config/supabase.js";
import { env } from "../config/env.js";
import { AUDIT_ACTIONS, logAuditEvent, requestContext } from "../services/auditLogger.js";
import { detectFileKind } from "../services/fileValidation.js";
import { sendDomainVerificationLinkEmail } from "../services/emailTemplates.js";
import { validateSignedDocument } from "../services/signatureValidator.js";
import {
  declarationDocumentPath,
  downloadDeclarationDocument,
  removeDeclarationDocuments,
  uploadDeclarationDocument,
} from "../services/domainDeclarationDocuments.js";
import {
  checkDeclarantEmail,
  emailMatchesDomain,
  isValidRut,
  normalizeRut,
  routeDeclaredDomain,
} from "../services/domainVerificationRules.js";

export const domainVerificationRouter = Router();

const DECLARATION_VERSION = "borrador-pendiente-revision-legal-1";
const EMAIL_LINK_TTL_HOURS = 24;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 2 },
});

const rutSchema = z
  .string()
  .transform(normalizeRut)
  .refine(isValidRut, { message: "RUT inválido" });

const declarationBodySchema = z.object({
  organization_rut: rutSchema,
  signer_rut: rutSchema,
  // Multipart solo transporta texto: la lista llega como JSON.
  asset_ids: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Debe ser un arreglo JSON" });
        return z.NEVER;
      }
    })
    .pipe(z.array(z.string().uuid()).min(1).max(20)),
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function getAccountEmail(userId: string): Promise<{ email: string | null; confirmedAt: string | null }> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new AppError(400, "ACCOUNT_FETCH_FAILED", "No se pudo leer el correo de la cuenta");
  }
  return { email: data.user.email ?? null, confirmedAt: data.user.email_confirmed_at ?? null };
}

/**
 * Emite un link nuevo y deja sin efecto los anteriores de ese dominio. Si el
 * correo no sale, no queda ningún link nuevo vivo: nadie podría abrirlo.
 */
async function issueEmailLink(params: {
  organizationId: string;
  itemId: string;
  issuedTo: string;
  email: string;
  domain: string;
}): Promise<boolean> {
  const token = randomBytes(32).toString("hex");
  const { data: challenge, error } = await supabaseAdmin
    .from("domain_email_challenges")
    .insert({
      organization_id: params.organizationId,
      declaration_item_id: params.itemId,
      issued_to: params.issuedTo,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + EMAIL_LINK_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !challenge) {
    throw new AppError(400, "EMAIL_LINK_CREATE_FAILED", "No se pudo generar el link de confirmación");
  }

  // En el fragmento (#) y no en la query: el navegador no lo envía al
  // servidor, así que no queda en logs de acceso ni en cabeceras Referer.
  const frontendOrigin = env.CORS_ORIGIN.split(",")[0]!.trim();
  const sent = await sendDomainVerificationLinkEmail(params.email, {
    domain: params.domain,
    confirmUrl: `${frontendOrigin}/verify-domain#token=${token}`,
    expiresInHours: EMAIL_LINK_TTL_HOURS,
  });

  if (!sent) {
    await supabaseAdmin.from("domain_email_challenges").delete().eq("id", challenge.id);
    return false;
  }

  await supabaseAdmin
    .from("domain_email_challenges")
    .delete()
    .eq("declaration_item_id", params.itemId)
    .neq("id", challenge.id);
  return true;
}

function logBlockedDeclaration(req: Request, code: string, detail: Record<string, unknown> = {}): Promise<void> {
  const profile = req.profile!;
  return logAuditEvent({
    organizationId: profile.organizationId,
    actorId: profile.id,
    action: AUDIT_ACTIONS.DOMAIN_DECLARATION_BLOCKED,
    resourceType: "organization",
    resourceId: profile.organizationId,
    payloadAfter: { code, ...detail },
    ...requestContext(req),
  });
}

/**
 * Declara dominios con un documento firmado y el certificado de poderes.
 * Nada de esto verifica un dominio: lo deja en camino a la revisión manual,
 * que es lo único que escribe `verification_status`. Una firma que no se pudo
 * validar nunca se guarda: no hay documentos sin firma válida en el bucket.
 */
domainVerificationRouter.post(
  "/domain-declarations",
  authenticateToken,
  requireRole(["ciso"]),
  sensitiveActionRateLimiter,
  upload.fields([
    { name: "signed_document", maxCount: 1 },
    { name: "powers_document", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const body = declarationBodySchema.parse(req.body);
    const assetIds = [...new Set(body.asset_ids)];

    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const signedDocument = files.signed_document?.[0];
    const powersDocument = files.powers_document?.[0];
    if (!signedDocument || !powersDocument) {
      throw new AppError(400, "DOCUMENTS_REQUIRED", "Debés adjuntar la declaración firmada y el certificado de poderes");
    }

    // Mismo trato que scans.ts: ajeno e inexistente no se distinguen.
    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("id, type, value, verification_status")
      .in("id", assetIds);
    if (assetsError) throw new AppError(400, "ASSETS_FETCH_FAILED", assetsError.message);

    const foundIds = new Set((assets ?? []).map((asset) => asset.id));
    const missing = assetIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      await logBlockedDeclaration(req, "UNAUTHORIZED_DECLARATION_TARGET", { assetIds: missing });
      throw new AppError(403, "UNAUTHORIZED_DECLARATION_TARGET", "Algún activo no existe o no pertenece a tu organización");
    }
    const declaredAssets = assets!;
    if (declaredAssets.some((asset) => asset.type !== "domain")) {
      throw new AppError(422, "DECLARATION_REQUIRES_DOMAIN", "Solo se pueden declarar activos de tipo dominio");
    }
    if (declaredAssets.some((asset) => asset.verification_status === "verified")) {
      throw new AppError(409, "ASSET_ALREADY_VERIFIED", "Algún dominio ya está verificado");
    }

    const { email, confirmedAt } = await getAccountEmail(profile.id);
    const emailProblem = checkDeclarantEmail(email, confirmedAt);
    if (emailProblem) {
      await logBlockedDeclaration(req, emailProblem);
      throw new AppError(
        emailProblem === "EMAIL_NOT_CONFIRMED" ? 403 : 422,
        emailProblem,
        emailProblem === "EMAIL_NOT_CONFIRMED"
          ? "Confirmá el correo de tu cuenta antes de declarar un dominio"
          : "No se pueden declarar dominios desde un correo gratuito. Usá el correo de tu organización."
      );
    }
    const accountEmail = email!;

    const { data: organization, error: organizationError } = await supabaseAdmin
      .from("organizations")
      .select("rut")
      .eq("id", profile.organizationId)
      .single();
    if (organizationError) throw new AppError(400, "ORGANIZATION_FETCH_FAILED", organizationError.message);
    if (organization.rut && organization.rut !== body.organization_rut) {
      await logBlockedDeclaration(req, "ORGANIZATION_RUT_MISMATCH");
      throw new AppError(409, "ORGANIZATION_RUT_MISMATCH", "El RUT no coincide con el ya aprobado para tu organización");
    }

    const { data: openItems, error: openItemsError } = await supabaseAdmin
      .from("domain_declaration_items")
      .select("id")
      .in("asset_id", assetIds)
      .in("status", ["pending_email", "pending_review"]);
    if (openItemsError) throw new AppError(400, "DECLARATION_FETCH_FAILED", openItemsError.message);
    if ((openItems ?? []).length > 0) {
      throw new AppError(409, "DOMAIN_DECLARATION_ALREADY_OPEN", "Algún dominio ya tiene un trámite abierto");
    }

    for (const file of [signedDocument, powersDocument]) {
      const { kind } = await detectFileKind(file.buffer, file.originalname);
      if (kind !== "pdf") {
        throw new AppError(422, "DOCUMENT_MUST_BE_PDF", "La declaración y el certificado deben ser archivos PDF");
      }
    }

    const signature = await validateSignedDocument(signedDocument.buffer, body.signer_rut);
    if (signature.status === "not_configured") {
      await logBlockedDeclaration(req, "SIGNATURE_PROVIDER_NOT_CONFIGURED");
      throw new AppError(503, "SIGNATURE_PROVIDER_NOT_CONFIGURED", "La validación de firma electrónica todavía no está disponible");
    }
    if (signature.status === "unavailable") {
      await logBlockedDeclaration(req, "SIGNATURE_PROVIDER_UNAVAILABLE");
      throw new AppError(503, "SIGNATURE_PROVIDER_UNAVAILABLE", "No se pudo validar la firma. Intentá de nuevo más tarde.");
    }
    if (signature.status === "invalid") {
      await logBlockedDeclaration(req, "INVALID_SIGNATURE", { reason: signature.reason });
      throw new AppError(422, "INVALID_SIGNATURE", "La firma no es una firma electrónica avanzada válida del RUT indicado");
    }

    const declarationId = randomUUID();
    const signedPath = declarationDocumentPath(profile.organizationId, declarationId, "signed");
    const powersPath = declarationDocumentPath(profile.organizationId, declarationId, "powers");
    await uploadDeclarationDocument(signedPath, signedDocument.buffer);
    await uploadDeclarationDocument(powersPath, powersDocument.buffer);

    const routes = declaredAssets.map((asset) => ({ asset, route: routeDeclaredDomain(accountEmail, asset.value) }));

    const { error: declarationError } = await supabaseAdmin.from("domain_ownership_declarations").insert({
      id: declarationId,
      organization_id: profile.organizationId,
      submitted_by: profile.id,
      organization_rut: body.organization_rut,
      signer_rut: body.signer_rut,
      declaration_version: DECLARATION_VERSION,
      signed_document_path: signedPath,
      signed_document_sha256: sha256(signedDocument.buffer),
      powers_document_path: powersPath,
      powers_document_sha256: sha256(powersDocument.buffer),
      signature_status: "valid",
      signature_checked_at: new Date().toISOString(),
    });
    if (declarationError) {
      await removeDeclarationDocuments([signedPath, powersPath]);
      throw new AppError(400, "DECLARATION_CREATE_FAILED", declarationError.message);
    }

    const { data: items, error: itemsError } = await supabaseAdmin
      .from("domain_declaration_items")
      .insert(
        routes.map(({ asset, route }) => ({
          organization_id: profile.organizationId,
          declaration_id: declarationId,
          asset_id: asset.id,
          status: route.status,
          review_reason: route.reviewReason,
        }))
      )
      .select("id, asset_id, status, review_reason");
    if (itemsError || !items) {
      await supabaseAdmin.from("domain_ownership_declarations").delete().eq("id", declarationId);
      await removeDeclarationDocuments([signedPath, powersPath]);
      // Otra declaración simultánea ganó la carrera por el mismo dominio.
      if (itemsError?.code === "23505") {
        throw new AppError(409, "DOMAIN_DECLARATION_ALREADY_OPEN", "Algún dominio ya tiene un trámite abierto");
      }
      throw new AppError(400, "DECLARATION_CREATE_FAILED", itemsError?.message ?? "No se pudo crear la declaración");
    }

    const responseItems = [];
    for (const item of items) {
      const domain = declaredAssets.find((asset) => asset.id === item.asset_id)!.value;
      const emailSent =
        item.status === "pending_email"
          ? await issueEmailLink({
              organizationId: profile.organizationId,
              itemId: item.id,
              issuedTo: profile.id,
              email: accountEmail,
              domain,
            })
          : false;
      responseItems.push({ ...item, domain, email_sent: emailSent });
    }

    await logAuditEvent({
      organizationId: profile.organizationId,
      actorId: profile.id,
      action: AUDIT_ACTIONS.DOMAIN_DECLARATION_SUBMITTED,
      resourceType: "organization",
      resourceId: profile.organizationId,
      payloadAfter: {
        declarationId,
        items: responseItems.map(({ domain, status, review_reason, email_sent }) => ({
          domain,
          status,
          reviewReason: review_reason,
          emailSent: email_sent,
        })),
      },
      ...requestContext(req),
    });

    res.status(201).json({ data: { id: declarationId, items: responseItems } });
  })
);

domainVerificationRouter.get(
  "/domain-declarations",
  authenticateToken,
  requireRole(["ciso"]),
  asyncHandler(async (req, res) => {
    const supabase = supabaseForUser(req.profile!.accessToken);
    const { data, error } = await supabase
      .from("domain_ownership_declarations")
      .select(
        "id, organization_rut, signer_rut, declaration_version, signature_status, powers_status, created_at, " +
          "domain_declaration_items(id, status, review_reason, email_confirmed_at, reviewed_at, assets(id, value))"
      )
      .order("created_at", { ascending: false });
    if (error) throw new AppError(400, "DECLARATION_LIST_FAILED", error.message);
    res.status(200).json({ data });
  })
);

domainVerificationRouter.post(
  "/domain-declarations/items/:itemId/resend-link",
  authenticateToken,
  requireRole(["ciso"]),
  validateUuidParams("itemId"),
  sensitiveActionRateLimiter,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const { data: item, error } = await supabaseForUser(profile.accessToken)
      .from("domain_declaration_items")
      .select("id, status, assets(value)")
      .eq("id", req.params.itemId)
      .maybeSingle();
    if (error) throw new AppError(400, "DECLARATION_FETCH_FAILED", error.message);
    if (!item) throw new AppError(404, "DECLARATION_ITEM_NOT_FOUND", "Trámite no encontrado");
    if (item.status !== "pending_email") {
      throw new AppError(409, "DECLARATION_ITEM_NOT_PENDING_EMAIL", "Este dominio no está esperando la confirmación por correo");
    }

    const domain = (item.assets as unknown as { value: string }).value;
    const { email, confirmedAt } = await getAccountEmail(profile.id);
    if (checkDeclarantEmail(email, confirmedAt) || !emailMatchesDomain(email!, domain)) {
      throw new AppError(403, "EMAIL_DOMAIN_MISMATCH", "El correo de tu cuenta no corresponde a este dominio");
    }

    const sent = await issueEmailLink({
      organizationId: profile.organizationId,
      itemId: item.id,
      issuedTo: profile.id,
      email: email!,
      domain,
    });
    if (!sent) {
      throw new AppError(503, "EMAIL_NOT_AVAILABLE", "No se pudo enviar el correo. Intentá de nuevo más tarde.");
    }

    await logAuditEvent({
      organizationId: profile.organizationId,
      actorId: profile.id,
      action: AUDIT_ACTIONS.DOMAIN_EMAIL_LINK_SENT,
      resourceType: "organization",
      resourceId: profile.organizationId,
      payloadAfter: { itemId: item.id, domain },
      ...requestContext(req),
    });

    res.status(200).json({ data: { email_sent: true } });
  })
);

const confirmSchema = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });

/**
 * Exige sesión de quien recibió el link: reenviado a otra cuenta no sirve.
 * Todos los rechazos responden igual, para no revelar si un token existe.
 */
domainVerificationRouter.post(
  "/domain-verification/confirm",
  authenticateToken,
  requireRole(["ciso"]),
  sensitiveActionRateLimiter,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const { token } = confirmSchema.parse(req.body);

    const reject = async (reason: string): Promise<never> => {
      await logAuditEvent({
        organizationId: profile.organizationId,
        actorId: profile.id,
        action: AUDIT_ACTIONS.DOMAIN_EMAIL_CONFIRM_BLOCKED,
        resourceType: "organization",
        resourceId: profile.organizationId,
        payloadAfter: { reason },
        ...requestContext(req),
      });
      throw new AppError(410, "INVALID_OR_EXPIRED_LINK", "El link no es válido o venció. Pedí uno nuevo.");
    };

    // Un solo UPDATE condicionado: dos clics simultáneos no pueden consumirlo dos veces.
    const now = new Date().toISOString();
    const { data: challenge, error } = await supabaseAdmin
      .from("domain_email_challenges")
      .update({ consumed_at: now })
      .eq("token_hash", hashToken(token))
      .eq("issued_to", profile.id)
      .is("consumed_at", null)
      .gt("expires_at", now)
      .select("declaration_item_id")
      .maybeSingle();
    if (error) throw new AppError(400, "EMAIL_LINK_FETCH_FAILED", error.message);
    if (!challenge) return reject("invalid_expired_or_used");

    const { data: pendingItem, error: pendingItemError } = await supabaseAdmin
      .from("domain_declaration_items")
      .select("id, assets(value)")
      .eq("id", challenge.declaration_item_id)
      .eq("status", "pending_email")
      .maybeSingle();
    if (pendingItemError) throw new AppError(400, "DECLARATION_FETCH_FAILED", pendingItemError.message);
    if (!pendingItem) return reject("item_not_pending_email");

    // El correo pudo cambiar desde que se envió el link.
    const domain = (pendingItem.assets as unknown as { value: string }).value;
    const { email, confirmedAt } = await getAccountEmail(profile.id);
    if (checkDeclarantEmail(email, confirmedAt) || !emailMatchesDomain(email!, domain)) {
      return reject("account_email_changed");
    }

    const { error: updateError } = await supabaseAdmin
      .from("domain_declaration_items")
      .update({ status: "pending_review", email_confirmed_at: now })
      .eq("id", pendingItem.id)
      .eq("status", "pending_email");
    if (updateError) throw new AppError(400, "DECLARATION_UPDATE_FAILED", updateError.message);

    await logAuditEvent({
      organizationId: profile.organizationId,
      actorId: profile.id,
      action: AUDIT_ACTIONS.DOMAIN_EMAIL_CONFIRMED,
      resourceType: "organization",
      resourceId: profile.organizationId,
      payloadAfter: { itemId: pendingItem.id, domain },
      ...requestContext(req),
    });

    res.status(200).json({ data: { status: "pending_review", domain } });
  })
);

const REVIEW_ITEM_SELECT =
  "id, organization_id, status, asset_id, review_reason, email_confirmed_at, created_at, " +
  "assets(value), organizations(name), " +
  "domain_ownership_declarations(id, organization_rut, signer_rut, declaration_version, signature_status, " +
  "powers_status, signed_document_path, signed_document_sha256, powers_document_path, powers_document_sha256)";

interface ReviewItem {
  id: string;
  organization_id: string;
  status: string;
  asset_id: string;
  review_reason: string | null;
  email_confirmed_at: string | null;
  created_at: string;
  assets: { value: string };
  organizations: { name: string };
  domain_ownership_declarations: {
    id: string;
    organization_rut: string;
    signer_rut: string;
    declaration_version: string;
    signature_status: string;
    powers_status: string;
    signed_document_path: string;
    signed_document_sha256: string;
    powers_document_path: string;
    powers_document_sha256: string;
  };
}

async function getReviewItem(itemId: string): Promise<ReviewItem> {
  const { data, error } = await supabaseAdmin
    .from("domain_declaration_items")
    .select(REVIEW_ITEM_SELECT)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new AppError(400, "DECLARATION_FETCH_FAILED", error.message);
  if (!data) throw new AppError(404, "DECLARATION_ITEM_NOT_FOUND", "Trámite no encontrado");
  return data as unknown as ReviewItem;
}

/** Nadie revisa el trámite de su propia organización, aunque sea platform admin. */
function assertReviewerIndependent(req: Request, item: ReviewItem): void {
  if (req.profile!.organizationId === item.organization_id) {
    throw new AppError(403, "REVIEWER_CONFLICT", "No podés revisar un trámite de tu propia organización");
  }
}

domainVerificationRouter.get(
  "/admin/domain-reviews",
  authenticateToken,
  requirePlatformAdmin,
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("domain_declaration_items")
      .select(REVIEW_ITEM_SELECT)
      .eq("status", "pending_review")
      .order("created_at", { ascending: true });
    if (error) throw new AppError(400, "DOMAIN_REVIEW_LIST_FAILED", error.message);

    const reviews = (data as unknown as ReviewItem[]).map((item) => {
      const declaration = item.domain_ownership_declarations;
      return {
        id: item.id,
        organization_id: item.organization_id,
        organization_name: item.organizations.name,
        domain: item.assets.value,
        review_reason: item.review_reason,
        email_confirmed_at: item.email_confirmed_at,
        created_at: item.created_at,
        declaration_id: declaration.id,
        organization_rut: declaration.organization_rut,
        signer_rut: declaration.signer_rut,
        declaration_version: declaration.declaration_version,
        signature_status: declaration.signature_status,
        powers_status: declaration.powers_status,
      };
    });
    res.status(200).json({ data: reviews });
  })
);

domainVerificationRouter.get(
  "/admin/domain-reviews/:itemId/documents/:kind",
  authenticateToken,
  requirePlatformAdmin,
  validateUuidParams("itemId"),
  asyncHandler(async (req, res) => {
    const kind = z.enum(["signed", "powers"]).parse(req.params.kind);
    const item = await getReviewItem(req.params.itemId as string);
    const declaration = item.domain_ownership_declarations;
    const path = kind === "signed" ? declaration.signed_document_path : declaration.powers_document_path;
    const expectedHash = kind === "signed" ? declaration.signed_document_sha256 : declaration.powers_document_sha256;

    const document = await downloadDeclarationDocument(path);
    if (sha256(document) !== expectedHash) {
      throw new AppError(409, "DOCUMENT_INTEGRITY_FAILED", "El documento no coincide con el hash registrado");
    }

    await logAuditEvent({
      organizationId: item.organization_id,
      actorId: req.profile!.id,
      action: AUDIT_ACTIONS.DOMAIN_DOCUMENT_ACCESSED,
      resourceType: "organization",
      resourceId: item.organization_id,
      payloadAfter: { itemId: item.id, kind },
      ...requestContext(req),
    });

    res
      .status(200)
      .set("Content-Type", "application/pdf")
      .set("Content-Disposition", `attachment; filename="${kind}.pdf"`)
      .send(document);
  })
);

const approveSchema = z.object({ notes: z.string().trim().max(1000).optional() });

/**
 * Único punto del flujo que escribe `verified`. La barrera de escaneo sigue
 * leyendo `assets.verification_status`, sin cambios.
 */
domainVerificationRouter.post(
  "/admin/domain-reviews/:itemId/approve",
  authenticateToken,
  requirePlatformAdmin,
  validateUuidParams("itemId"),
  sensitiveActionRateLimiter,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const body = approveSchema.parse(req.body ?? {});
    const item = await getReviewItem(req.params.itemId as string);
    assertReviewerIndependent(req, item);
    const declaration = item.domain_ownership_declarations;

    if (item.status !== "pending_review") {
      throw new AppError(409, "DECLARATION_ITEM_NOT_IN_REVIEW", "Este trámite no está esperando revisión");
    }
    if (declaration.signature_status !== "valid") {
      throw new AppError(409, "SIGNATURE_NOT_VALID", "La declaración no tiene una firma válida");
    }
    if (declaration.powers_status === "rejected") {
      throw new AppError(409, "POWERS_REJECTED", "El certificado de poderes de esta declaración fue rechazado");
    }

    const { data: organization, error: organizationError } = await supabaseAdmin
      .from("organizations")
      .select("rut")
      .eq("id", item.organization_id)
      .single();
    if (organizationError) throw new AppError(400, "ORGANIZATION_FETCH_FAILED", organizationError.message);
    if (organization.rut && organization.rut !== declaration.organization_rut) {
      throw new AppError(409, "ORGANIZATION_RUT_MISMATCH", "El RUT no coincide con el ya aprobado para la organización");
    }

    const reviewedAt = new Date().toISOString();
    const { data: approved, error: approveError } = await supabaseAdmin
      .from("domain_declaration_items")
      .update({ status: "approved", reviewed_by: profile.id, reviewed_at: reviewedAt, review_notes: body.notes ?? null })
      .eq("id", item.id)
      .eq("status", "pending_review")
      .select("id")
      .maybeSingle();
    if (approveError) throw new AppError(400, "DECLARATION_UPDATE_FAILED", approveError.message);
    if (!approved) {
      throw new AppError(409, "DECLARATION_ITEM_NOT_IN_REVIEW", "Este trámite no está esperando revisión");
    }

    const { error: assetError } = await supabaseAdmin
      .from("assets")
      .update({ verification_status: "verified", verified_at: reviewedAt })
      .eq("id", item.asset_id)
      .eq("organization_id", item.organization_id);
    if (assetError) {
      // Sin esto quedaría aprobado un dominio que no está verificado, y sin forma de reintentar.
      await supabaseAdmin
        .from("domain_declaration_items")
        .update({ status: "pending_review", reviewed_by: null, reviewed_at: null, review_notes: null })
        .eq("id", item.id);
      throw new AppError(400, "ASSET_VERIFY_FAILED", assetError.message);
    }

    await supabaseAdmin
      .from("domain_ownership_declarations")
      .update({ powers_status: "approved", powers_reviewed_by: profile.id, powers_reviewed_at: reviewedAt })
      .eq("id", declaration.id);
    if (!organization.rut) {
      await supabaseAdmin
        .from("organizations")
        .update({ rut: declaration.organization_rut })
        .eq("id", item.organization_id);
    }

    await logAuditEvent({
      organizationId: item.organization_id,
      actorId: profile.id,
      action: AUDIT_ACTIONS.DOMAIN_VERIFICATION_APPROVED,
      resourceType: "asset",
      resourceId: item.asset_id,
      payloadAfter: { itemId: item.id, domain: item.assets.value, reviewReason: item.review_reason },
      ...requestContext(req),
    });

    res.status(200).json({ data: { status: "approved", asset_id: item.asset_id } });
  })
);

const rejectSchema = z.object({
  notes: z.string().trim().min(10).max(1000),
  powers_invalid: z.boolean().default(false),
});

domainVerificationRouter.post(
  "/admin/domain-reviews/:itemId/reject",
  authenticateToken,
  requirePlatformAdmin,
  validateUuidParams("itemId"),
  sensitiveActionRateLimiter,
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const body = rejectSchema.parse(req.body ?? {});
    const item = await getReviewItem(req.params.itemId as string);
    assertReviewerIndependent(req, item);

    const reviewedAt = new Date().toISOString();
    const { data: rejected, error } = await supabaseAdmin
      .from("domain_declaration_items")
      .update({ status: "rejected", reviewed_by: profile.id, reviewed_at: reviewedAt, review_notes: body.notes })
      .eq("id", item.id)
      .eq("status", "pending_review")
      .select("id")
      .maybeSingle();
    if (error) throw new AppError(400, "DECLARATION_UPDATE_FAILED", error.message);
    if (!rejected) {
      throw new AppError(409, "DECLARATION_ITEM_NOT_IN_REVIEW", "Este trámite no está esperando revisión");
    }

    // Unos poderes inválidos afectan a todos los dominios de la declaración.
    if (body.powers_invalid) {
      await supabaseAdmin
        .from("domain_ownership_declarations")
        .update({ powers_status: "rejected", powers_reviewed_by: profile.id, powers_reviewed_at: reviewedAt })
        .eq("id", item.domain_ownership_declarations.id);
    }

    await logAuditEvent({
      organizationId: item.organization_id,
      actorId: profile.id,
      action: AUDIT_ACTIONS.DOMAIN_VERIFICATION_REJECTED,
      resourceType: "asset",
      resourceId: item.asset_id,
      payloadAfter: { itemId: item.id, domain: item.assets.value, powersInvalid: body.powers_invalid },
      ...requestContext(req),
    });

    res.status(200).json({ data: { status: "rejected" } });
  })
);
