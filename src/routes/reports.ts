import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { authenticateToken, requireRole } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../middlewares/errorHandler.js";
import { supabaseForUser, supabaseAdmin } from "../config/supabase.js";
import { validateUuidParams } from "../middlewares/validateParams.js";
import { env } from "../config/env.js";
import { evaluateCoverage } from "../services/coverageEngine.js";
import { evaluateAnciCoverage } from "../services/anciCoverageEngine.js";
import { calculateRiskScore } from "../services/riskScoring.js";
import {
  buildAuditReportPdf,
  type ReportFinding,
  type ReportIgnoredFinding,
  type ReportEvidenceIssue,
  type ReportEvidenceLedgerEntry,
} from "../services/pdfReport.js";
import type { FindingSeverity } from "../services/findingsNormalization.js";
import { buildOsintReportLines, loadOsintReport } from "../services/osintReport.js";
import { logAuditEvent, requestContext, AUDIT_ACTIONS } from "../services/auditLogger.js";

// a.md, "MVP: REGLAS DE NEGOCIO...": las URLs firmadas de descarga
// expiran a la hora — antes eran 5 minutos, muy corto para que alguien
// reciba el link por otro canal (ej. reenviado por email/chat) y lo abra.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export const reportsRouter = Router();

reportsRouter.get(
  "/audits/:auditId/report",
  authenticateToken,
  requireRole(["ciso", "auditor", "viewer"]),
  validateUuidParams("auditId"),
  asyncHandler(async (req, res) => {
    const profile = req.profile!;
    const supabase = supabaseForUser(profile.accessToken);
    const auditId = String(req.params.auditId);

    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .select("id, title, framework, organization_id")
      .eq("id", auditId)
      .maybeSingle();

    if (auditError) {
      throw new AppError(400, "AUDIT_FETCH_FAILED", auditError.message);
    }
    if (!audit) {
      throw new AppError(404, "AUDIT_NOT_FOUND", "Auditoría no encontrada");
    }

    const [
      { data: findings, error: findingsError },
      { data: evidences, error: evidencesError },
      { data: evidenceLedger, error: ledgerError },
    ] = await Promise.all([
      supabase
        .from("findings")
        .select("source_engine, title, severity, status, detail, remediation, justification_notes, reviewed_by")
        .eq("audit_id", auditId),
      supabase
        .from("audit_evidences")
        .select("file_name, requirement_code, validation_errors")
        .eq("audit_id", auditId)
        .eq("validation_status", "invalid"),
      supabase
        .from("audit_evidences")
        .select("file_name, requirement_code, validation_status, created_at")
        .eq("audit_id", auditId)
        .order("created_at", { ascending: true }),
    ]);

    if (findingsError) throw new AppError(400, "FINDINGS_FETCH_FAILED", findingsError.message);
    if (evidencesError) throw new AppError(400, "EVIDENCES_FETCH_FAILED", evidencesError.message);
    if (ledgerError) throw new AppError(400, "EVIDENCE_LEDGER_FETCH_FAILED", ledgerError.message);

    const coverage = await evaluateCoverage(supabase, auditId, audit.framework);
    const anci = await evaluateAnciCoverage(supabase, auditId, audit.framework);
    const isAnciFramework = audit.framework === "ley_21663_cl";

    // Un hallazgo marcado como falso positivo o riesgo aceptado (con
    // justificación de un auditor, ver PATCH /findings/:id/status) ya no
    // representa un riesgo real: no debe penalizar el puntaje, aunque sigue
    // apareciendo en el reporte para dejar constancia de la decisión.
    const severityCounts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const osintSeverityCounts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of findings ?? []) {
      if (finding.status === "false_positive" || finding.status === "accepted_risk") continue;
      const counts = finding.source_engine.startsWith("osint-") ? osintSeverityCounts : severityCounts;
      counts[finding.severity as FindingSeverity] += 1;
    }

    const riskScore = calculateRiskScore({
      findingsBySeverity: severityCounts,
      completionPercentage: coverage.completion_percentage,
      osintFindingsBySeverity: osintSeverityCounts,
    });

    // Falsos positivos / riesgos aceptados van a su propia sección del PDF
    // (a.md, "Sección de Falsos Positivos y Excepciones") en vez de
    // mezclarse con el desglose de hallazgos activos de arriba.
    const allActiveFindings = (findings ?? []).filter(
      (f) => f.status !== "false_positive" && f.status !== "accepted_risk"
    );
    // OSINT tiene su propia sección: en el desglose general se duplicaría.
    const activeFindings = allActiveFindings.filter((f) => !f.source_engine.startsWith("osint-"));
    const osintFindings = allActiveFindings.filter((f) => f.source_engine.startsWith("osint-"));
    const osintReport = await loadOsintReport(supabase, auditId, audit.framework).catch((err: Error) => {
      throw new AppError(400, "OSINT_REPORT_FETCH_FAILED", err.message);
    });
    const ignoredFindingsRaw = (findings ?? []).filter(
      (f) => f.status === "false_positive" || f.status === "accepted_risk"
    );
    const reviewerIds = [...new Set(ignoredFindingsRaw.map((f) => f.reviewed_by).filter((id): id is string => !!id))];
    const reviewerNames = new Map<string, string | null>();
    if (reviewerIds.length > 0) {
      const { data: reviewers } = await supabase.from("profiles").select("id, full_name").in("id", reviewerIds);
      for (const r of reviewers ?? []) reviewerNames.set(r.id, r.full_name);
    }
    const ignoredFindings: ReportIgnoredFinding[] = ignoredFindingsRaw.map((f) => ({
      title: f.title,
      severity: f.severity as FindingSeverity,
      status: f.status as "false_positive" | "accepted_risk",
      reviewedByName: f.reviewed_by ? (reviewerNames.get(f.reviewed_by) ?? null) : null,
      justificationNotes: f.justification_notes,
    }));

    const generatedAt = new Date();

    // Hash de integridad del documento: no es una firma digital legalmente
    // vinculante (eso requeriría PKI/certificado calificado, fuera de
    // alcance) — es una huella SHA-256 sobre el contenido del reporte que
    // permite comprobar después que no fue alterado. Se etiqueta como tal
    // en el PDF, nunca como "firma electrónica avanzada".
    const integrityHash = isAnciFramework
      ? createHash("sha256")
          .update(
            JSON.stringify({
              auditId,
              framework: audit.framework,
              riskScore: riskScore.score,
              coveragePercentage: coverage.completion_percentage,
              sePercentage: anci.sePercentage,
              oivPercentage: anci.oivPercentage,
              findings: (findings ?? []).map((f) => ({ title: f.title, severity: f.severity, status: f.status })),
              osint: osintReport,
              generatedAt: generatedAt.toISOString(),
            })
          )
          .digest("hex")
      : null;

    const pdfBuffer = await buildAuditReportPdf({
      auditTitle: audit.title,
      framework: audit.framework,
      generatedAt,
      riskScore,
      coverage,
      findings: activeFindings as ReportFinding[],
      ignoredFindings,
      invalidEvidences: (evidences ?? []) as ReportEvidenceIssue[],
      osintLines: osintReport
        ? buildOsintReportLines(osintReport, osintFindings as ReportFinding[], riskScore.osintPenalty)
        : undefined,
      anci: isAnciFramework
        ? {
            sePercentage: anci.sePercentage,
            oivPercentage: anci.oivPercentage,
            technicalControls: anci.technicalControls,
            evidenceLedger: (evidenceLedger ?? []) as ReportEvidenceLedgerEntry[],
            integrityHash: integrityHash!,
          }
        : undefined,
    });

    const reportId = randomUUID();
    // El bucket de reportes es privado y solo se accede vía signed URL de
    // corta duración (ver abajo); a diferencia de las evidencias (documentos
    // fuente sensibles y de vida larga), el reporte no se cifra a nivel de
    // aplicación para poder servirlo directo desde Supabase Storage.
    const storagePath = `${audit.organization_id}/${auditId}/${reportId}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(env.REPORTS_BUCKET)
      .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      throw new AppError(500, "REPORT_UPLOAD_FAILED", uploadError.message);
    }

    const { error: reportInsertError } = await supabase.from("reports").insert({
      id: reportId,
      audit_id: auditId,
      generated_by: profile.id,
      storage_path: storagePath,
      risk_score: riskScore.score,
    });
    if (reportInsertError) {
      throw new AppError(400, "REPORT_INSERT_FAILED", reportInsertError.message);
    }

    // risk_score es un campo derivado por el sistema: se actualiza con
    // service_role para no depender de que quien genera el reporte sea
    // el creador de la auditoría o tenga rol 'ciso' (ver RLS de `audits`).
    await supabaseAdmin.from("audits").update({ risk_score: riskScore.score }).eq("id", auditId);

    const { data: signed, error: signedUrlError } = await supabaseAdmin.storage
      .from(env.REPORTS_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signedUrlError || !signed) {
      throw new AppError(500, "SIGNED_URL_FAILED", signedUrlError?.message ?? "No se pudo firmar el link de descarga");
    }

    // Un solo endpoint genera Y entrega el reporte (el signedUrl que se
    // descarga es esta misma respuesta), así que un evento cubre ambas
    // acciones que pide a.md ("generación y descarga").
    await logAuditEvent({
      organizationId: audit.organization_id,
      actorId: profile.id,
      action: AUDIT_ACTIONS.REPORT_GENERATED,
      resourceType: "report",
      resourceId: reportId,
      payloadAfter: { auditId, riskScore: riskScore.score, complianceLevel: riskScore.complianceLevel },
      ...requestContext(req),
    });

    res.status(200).json({
      data: {
        reportId,
        auditId,
        signedUrl: signed.signedUrl,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
        riskScore: {
          score: riskScore.score,
          complianceLevel: riskScore.complianceLevel,
          findingsPenalty: riskScore.findingsPenalty,
          coveragePenalty: riskScore.coveragePenalty,
          osintPenalty: riskScore.osintPenalty,
        },
        coverage,
      },
    });
  })
);
