import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requireRole } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../middlewares/errorHandler.js";
import { supabaseForUser } from "../config/supabase.js";
import { validateUuidParams } from "../middlewares/validateParams.js";
import { logAuditEvent, requestContext, AUDIT_ACTIONS } from "../services/auditLogger.js";

export const findingsRouter = Router();

/**
 * Lista de hallazgos de una auditoría, filtrable por severidad.
 *
 * Se agrega por fuera de las 4 fases de a.md: el frontend necesita leer
 * los hallazgos para la tabla de "Visor de Reporte Ejecutivo" sin disparar
 * la generación (y re-subida) de un PDF nuevo, que es lo que hace
 * GET /audits/:id/report en cada llamada.
 */
findingsRouter.get(
  "/audits/:auditId/findings",
  authenticateToken,
  validateUuidParams("auditId"),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const auditId = String(req.params.auditId);
    const severity = typeof req.query.severity === "string" ? req.query.severity : undefined;

    let query = supabase
      .from("findings")
      .select(
        "id, title, severity, status, cve_id, detail, remediation, source_engine, detected_at, justification_notes, reviewed_by"
      )
      .eq("audit_id", auditId)
      .order("detected_at", { ascending: false });

    if (severity) {
      query = query.eq("severity", severity);
    }

    const { data, error } = await query;
    if (error) {
      throw new AppError(400, "FINDINGS_LIST_FAILED", error.message);
    }

    res.status(200).json({ data });
  })
);

const updateStatusSchema = z.object({
  status: z.enum(["open", "false_positive", "accepted_risk"]),
  justification_notes: z.string().trim().min(10).max(2000),
});

/**
 * Cambia el estado de un hallazgo (gestión de falsos positivos / riesgo
 * aceptado). Exige justificación técnica; `reviewed_by` se toma del
 * usuario autenticado, nunca del body, para que no se pueda atribuir la
 * decisión a otra persona. Un hallazgo en `false_positive`/`accepted_risk`
 * queda excluido del cálculo de riesgo (ver GET /audits/:id/report).
 */
findingsRouter.patch(
  "/findings/:id/status",
  authenticateToken,
  requireRole(["ciso", "auditor"]),
  validateUuidParams("id"),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const body = updateStatusSchema.parse(req.body);

    const { data: before, error: beforeError } = await supabase
      .from("findings")
      .select("id, audit_id, status")
      .eq("id", req.params.id)
      .maybeSingle();
    if (beforeError) throw new AppError(400, "FINDING_FETCH_FAILED", beforeError.message);
    if (!before) throw new AppError(404, "FINDING_NOT_FOUND", "Hallazgo no encontrado o sin acceso");

    const { data, error } = await supabase
      .from("findings")
      .update({
        status: body.status,
        justification_notes: body.justification_notes,
        reviewed_by: profile.id,
      })
      .eq("id", req.params.id)
      .select("id, audit_id, status, justification_notes, reviewed_by")
      .maybeSingle();

    if (error) throw new AppError(400, "FINDING_STATUS_UPDATE_FAILED", error.message);
    if (!data) throw new AppError(404, "FINDING_NOT_FOUND", "Hallazgo no encontrado o sin acceso");

    await logAuditEvent({
      organizationId: profile.organizationId,
      actorId: profile.id,
      action: AUDIT_ACTIONS.FINDING_STATUS_CHANGED,
      resourceType: "finding",
      resourceId: data.id,
      payloadBefore: { status: before.status },
      payloadAfter: { status: data.status, justification_notes: data.justification_notes },
      ...requestContext(req),
    });

    res.status(200).json({ data });
  })
);
