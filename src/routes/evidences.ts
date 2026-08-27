import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authenticateToken, requireRole } from "../middlewares/auth.js";
import { sensitiveActionRateLimiter } from "../middlewares/security.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../middlewares/errorHandler.js";
import { supabaseForUser } from "../config/supabase.js";
import { validateUuidParams } from "../middlewares/validateParams.js";
import { detectFileKind, validateSemanticContent } from "../services/fileValidation.js";
import { uploadEncryptedEvidence } from "../services/evidenceStorage.js";
import { evaluateCoverage } from "../services/coverageEngine.js";
import { findRequirement } from "../data/complianceRequirements.js";
import { logAuditEvent, requestContext, AUDIT_ACTIONS } from "../services/auditLogger.js";

export const evidencesRouter = Router();

/**
 * El embed de una relación many-to-one de Supabase (`uploader:profiles(...)`)
 * a veces llega como objeto y a veces como array de un elemento según cómo
 * se infiera la relación — se normaliza acá una sola vez en vez de repetir
 * el chequeo `Array.isArray` en cada lugar que consume evidencias.
 */
function resolveUploaderName(uploader: { full_name: string | null } | { full_name: string | null }[] | null): string | null {
  if (!uploader) return null;
  const row = Array.isArray(uploader) ? uploader[0] : uploader;
  return row?.full_name ?? null;
}

/**
 * Lista de evidencias cargadas + cobertura actual de la auditoría, sin
 * necesidad de subir un archivo. El frontend la usa para pintar la matriz
 * de cobertura al entrar a /audits/:id (POST de arriba solo devuelve esto
 * como efecto secundario de un upload).
 */
evidencesRouter.get(
  "/audits/:auditId/evidences",
  authenticateToken,
  validateUuidParams("auditId"),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const auditId = String(req.params.auditId);

    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .select("id, framework")
      .eq("id", auditId)
      .maybeSingle();
    if (auditError) throw new AppError(400, "AUDIT_FETCH_FAILED", auditError.message);
    if (!audit) throw new AppError(404, "AUDIT_NOT_FOUND", "Auditoría no encontrada o sin acceso");

    // `uploader` viaja embebido vía el FK uploaded_by -> profiles(id). Ese
    // FK admite NULL desde la migración 018 (perfiles borrados ya no
    // bloquean el borrado de su organización) — cuando el que subió el
    // archivo ya no existe, tanto `uploaded_by` como `uploader` llegan en
    // null, y el frontend lo muestra como "Usuario eliminado / Sistema" en
    // vez de romper el render.
    const { data: evidences, error: evidencesError } = await supabase
      .from("audit_evidences")
      .select(
        "id, file_name, requirement_code, validation_status, validation_errors, created_at, uploaded_by, uploader:profiles(full_name)"
      )
      .eq("audit_id", auditId)
      .order("created_at", { ascending: false });
    if (evidencesError) throw new AppError(400, "EVIDENCES_LIST_FAILED", evidencesError.message);

    const coverage = await evaluateCoverage(supabase, auditId, audit.framework);

    const evidencesWithUploader = (evidences ?? []).map(({ uploader, ...rest }) => ({
      ...rest,
      uploader_name: resolveUploaderName(uploader),
    }));

    res.status(200).json({ data: { evidences: evidencesWithUploader, ...coverage } });
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

const uploadBodySchema = z.object({
  requirement_code: z.string().trim().min(1).max(50).optional(),
});

evidencesRouter.post(
  "/audits/:auditId/evidences",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  validateUuidParams("auditId"),
  sensitiveActionRateLimiter,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const { auditId } = req.params;
    const body = uploadBodySchema.parse(req.body);

    if (!req.file) {
      throw new AppError(400, "FILE_REQUIRED", "Debés adjuntar un archivo en el campo 'file'");
    }

    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .select("id, framework, organization_id")
      .eq("id", auditId)
      .maybeSingle();

    if (auditError) {
      throw new AppError(400, "AUDIT_FETCH_FAILED", auditError.message);
    }
    if (!audit) {
      throw new AppError(404, "AUDIT_NOT_FOUND", "Auditoría no encontrada o sin acceso");
    }

    // Capa 1: validación estructural (magic bytes)
    const structural = await detectFileKind(req.file.buffer, req.file.originalname);
    if (!structural.kind) {
      throw new AppError(422, "INVALID_FILE_STRUCTURE", structural.error ?? "Archivo no permitido");
    }

    // Capa 2: validación semántica (campos obligatorios del requisito, si aplica)
    const requirement = body.requirement_code
      ? findRequirement(audit.framework, body.requirement_code)
      : undefined;
    const semanticErrors = await validateSemanticContent(
      structural.kind,
      req.file.buffer,
      requirement?.requiredFields
    );

    const validationStatus = semanticErrors.length === 0 ? "valid" : "invalid";
    const evidenceId = randomUUID();

    const storagePath = await uploadEncryptedEvidence({
      organizationId: audit.organization_id,
      auditId: audit.id,
      evidenceId,
      fileName: req.file.originalname,
      buffer: req.file.buffer,
    });

    const { data: evidence, error: insertError } = await supabase
      .from("audit_evidences")
      .insert({
        id: evidenceId,
        audit_id: audit.id,
        uploaded_by: profile.id,
        file_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        storage_path: storagePath,
        requirement_code: body.requirement_code ?? null,
        validation_status: validationStatus,
        validation_errors: semanticErrors.length > 0 ? semanticErrors : null,
      })
      .select("*, uploader:profiles(full_name)")
      .single();

    if (insertError) {
      throw new AppError(400, "EVIDENCE_INSERT_FAILED", insertError.message);
    }

    await logAuditEvent({
      organizationId: audit.organization_id,
      actorId: profile.id,
      action: AUDIT_ACTIONS.EVIDENCE_UPLOADED,
      resourceType: "evidence",
      resourceId: evidence.id,
      payloadAfter: {
        file_name: evidence.file_name,
        requirement_code: evidence.requirement_code,
        validation_status: evidence.validation_status,
      },
      ...requestContext(req),
    });

    const coverage = await evaluateCoverage(supabase, audit.id, audit.framework);

    const { uploader, ...evidenceRest } = evidence as typeof evidence & {
      uploader: { full_name: string | null } | { full_name: string | null }[] | null;
    };

    res.status(201).json({
      data: {
        evidence: { ...evidenceRest, uploader_name: resolveUploaderName(uploader) },
        validation_errors: semanticErrors,
        ...coverage,
      },
    });
  })
);
