import PDFDocument from "pdfkit";
import type { RiskScoreResult } from "./riskScoring.js";
import type { CoverageResult } from "./coverageEngine.js";
import type { FindingSeverity } from "./findingsNormalization.js";
import type { TechnicalControlResult } from "./anciCoverageEngine.js";
import type { OsintReportLine } from "./osintReport.js";

export interface ReportFinding {
  title: string;
  severity: FindingSeverity;
  detail: string | null;
  remediation: string | null;
}

export interface ReportIgnoredFinding {
  title: string;
  severity: FindingSeverity;
  status: "false_positive" | "accepted_risk";
  reviewedByName: string | null;
  justificationNotes: string | null;
}

export interface ReportEvidenceIssue {
  file_name: string;
  requirement_code: string | null;
  validation_errors: string[] | null;
}

export interface ReportEvidenceLedgerEntry {
  file_name: string;
  requirement_code: string | null;
  validation_status: string;
  created_at: string;
}

export interface ReportAnciSection {
  sePercentage: number;
  oivPercentage: number;
  technicalControls: TechnicalControlResult[];
  evidenceLedger: ReportEvidenceLedgerEntry[];
  integrityHash: string;
}

export interface BuildReportInput {
  auditTitle: string;
  framework: string;
  generatedAt: Date;
  riskScore: RiskScoreResult;
  coverage: CoverageResult;
  findings: ReportFinding[];
  ignoredFindings: ReportIgnoredFinding[];
  invalidEvidences: ReportEvidenceIssue[];
  /** Solo si hubo una corrida OSINT terminada. */
  osintLines?: OsintReportLine[];
  anci?: ReportAnciSection;
}

const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low"];
const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export async function buildAuditReportPdf(input: BuildReportInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // --- Portada / Resumen ejecutivo ---
  doc.fontSize(20).text("Aegis CyberAudit — Reporte de Auditoría", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Auditoría: ${input.auditTitle}`);
  doc.text(`Framework: ${input.framework.toUpperCase()}`);
  doc.text(`Generado: ${input.generatedAt.toLocaleString("es-AR")}`);
  doc.moveDown();

  doc.fontSize(16).text("Resumen Ejecutivo", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Puntaje de Riesgo: ${input.riskScore.score} / 100`);
  doc.text(`Nivel de Cumplimiento: ${input.riskScore.complianceLevel.toUpperCase()}`);
  doc.text(`Cobertura documental: ${input.coverage.completion_percentage}%`);
  doc.text(
    `(Penalización por hallazgos: -${input.riskScore.findingsPenalty} | Penalización por cobertura incompleta: -${input.riskScore.coveragePenalty}${input.riskScore.osintPenalty > 0 ? ` | Penalización por reconocimiento pasivo: -${input.riskScore.osintPenalty}` : ""})`
  );
  doc.moveDown();

  // --- Evidencias faltantes / con errores ---
  doc.fontSize(16).text("Evidencias Faltantes e Incoherencias Detectadas", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12);
  if (input.coverage.missing_requirements.length === 0) {
    doc.text("No hay requisitos pendientes de evidencia.");
  } else {
    doc.text("Requisitos sin evidencia válida:");
    for (const req of input.coverage.missing_requirements) {
      doc.text(`  • [${req.code}] ${req.title}`);
    }
  }
  doc.moveDown(0.5);
  if (input.invalidEvidences.length > 0) {
    doc.text("Evidencias cargadas con incoherencias:");
    for (const ev of input.invalidEvidences) {
      doc.text(`  • ${ev.file_name}${ev.requirement_code ? ` (${ev.requirement_code})` : ""}`);
      for (const err of ev.validation_errors ?? []) {
        doc.text(`      - ${err}`);
      }
    }
  }
  doc.moveDown();

  // --- Desglose de hallazgos ---
  doc.fontSize(16).text("Desglose de Hallazgos y Sugerencias de Remediación", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12);

  if (input.findings.length === 0) {
    doc.text("No se registraron hallazgos técnicos.");
  } else {
    for (const severity of SEVERITY_ORDER) {
      const group = input.findings.filter((f) => f.severity === severity);
      if (group.length === 0) continue;

      doc.fontSize(13).text(`Severidad ${SEVERITY_LABEL[severity]} (${group.length})`, { underline: true });
      doc.fontSize(11);
      for (const finding of group) {
        doc.moveDown(0.2);
        doc.text(`• ${finding.title}`);
        if (finding.detail) doc.text(`  Detalle: ${finding.detail}`);
        if (finding.remediation) doc.text(`  Remediación sugerida: ${finding.remediation}`);
      }
      doc.moveDown(0.5);
    }
  }

  // --- Reconocimiento pasivo (Módulo C) ---
  if (input.osintLines) {
    doc.fontSize(16).text("Reconocimiento pasivo (OSINT)", { underline: true });
    doc.moveDown(0.5);
    for (const line of input.osintLines) {
      if (line.style === "heading") {
        doc.moveDown(0.4);
        doc.fontSize(13).text(line.text, { underline: true });
      } else if (line.style === "bullet") {
        doc.fontSize(11).text(`  • ${line.text}`);
      } else if (line.style === "small") {
        doc.fontSize(10).text(`    ${line.text}`);
      } else {
        doc.fontSize(11).text(line.text);
      }
    }
    doc.moveDown();
  }

  // --- Falsos Positivos y Excepciones Aplicadas (a.md, "MODULO DE
  // SIMULACIÓN (SANDBOX) Y GENERACIÓN DE INFORME TÉCNICO COMPLETO") ---
  // Bitácora de qué se descartó, quién y por qué — separado del desglose
  // de arriba (que ya solo trae hallazgos activos) para no mezclar riesgo
  // real con decisiones ya revisadas por un auditor.
  doc.fontSize(16).text("Falsos Positivos y Excepciones Aplicadas", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12);
  if (input.ignoredFindings.length === 0) {
    doc.text("No se descartó ningún hallazgo como falso positivo ni se aceptó ningún riesgo en esta auditoría.");
  } else {
    for (const finding of input.ignoredFindings) {
      const statusLabel = finding.status === "false_positive" ? "Falso positivo" : "Riesgo aceptado";
      doc.moveDown(0.3);
      doc.fontSize(11).text(`• [${statusLabel}] (${SEVERITY_LABEL[finding.severity]}) ${finding.title}`);
      doc.text(`  Descartado por: ${finding.reviewedByName ?? "Usuario eliminado / Sistema"}`);
      doc.text(`  Justificación: ${finding.justificationNotes ?? "—"}`);
    }
  }
  doc.moveDown();

  // --- Informe de Posición de Riesgo - Ley 21.663 (ANCI) ---
  if (input.anci) {
    doc.addPage();
    doc.fontSize(16).text("Informe de Posición de Riesgo — Ley 21.663 (ANCI)", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12);
    doc.text(`Cumplimiento Servicios Esenciales (SE): ${input.anci.sePercentage}%`);
    doc.text(`Cumplimiento Operadores de Importancia Vital (OIV): ${input.anci.oivPercentage}%`);
    doc.moveDown();

    doc.fontSize(14).text("Controles técnicos verificados por escaneo", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(11);
    if (input.anci.technicalControls.length === 0) {
      doc.text("No hay controles técnicos definidos para este framework.");
    } else {
      for (const control of input.anci.technicalControls) {
        const label = control.status === "ok" ? "CUMPLE" : control.status === "fail" ? "NO CUMPLE" : "SIN ESCANEAR";
        doc.text(`  [${label}] ${control.code} — ${control.title}`);
      }
    }
    doc.moveDown();

    doc.fontSize(14).text("Bitácora de evidencias", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(11);
    if (input.anci.evidenceLedger.length === 0) {
      doc.text("No se cargaron evidencias documentales para esta auditoría.");
    } else {
      for (const entry of input.anci.evidenceLedger) {
        const when = new Date(entry.created_at).toLocaleString("es-CL");
        doc.text(
          `  • ${entry.file_name}${entry.requirement_code ? ` (${entry.requirement_code})` : ""} — ${entry.validation_status} — ${when}`
        );
      }
    }
    doc.moveDown();

    doc.fontSize(14).text("Verificación de integridad del documento", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9).text(
      "Hash SHA-256 calculado sobre el contenido de este reporte al momento de su generación. Permite " +
        "comprobar que el documento no fue alterado después de emitido. No constituye una firma electrónica " +
        "avanzada ni calificada en los términos de la Ley N° 19.799.",
      { width: 480 }
    );
    doc.moveDown(0.3);
    doc.font("Courier").fontSize(9).text(input.anci.integrityHash);
    doc.font("Helvetica");
  }

  doc.end();
  return done;
}
