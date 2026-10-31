import type { FindingSeverity } from "./findingsNormalization.js";

/**
 * Puntaje = 100 - (Σ Hallazgos por Severidad + Penalización por Cobertura Incompleta)
 * (fórmula tal como está especificada en a.md, Fase 4).
 *
 * Pesos de severidad y peso de la penalización por cobertura son parámetros
 * de negocio razonables para un MVP; se documentan explícitamente para que
 * sean fáciles de ajustar sin tocar la lógica de cálculo.
 */
const SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
};

/**
 * Hallazgos OSINT: señales indirectas de fuentes públicas, así que pesan menos
 * que un hallazgo técnico y tienen un tope. El peso de `critical` existe solo por
 * el tipo: ninguna fuente OSINT lo genera.
 */
const OSINT_SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  critical: 4,
  high: 4,
  medium: 2,
  low: 1,
};
export const OSINT_PENALTY_CAP = 15;

/** Cuánto pesa cada punto porcentual de cobertura documental faltante. */
const COVERAGE_PENALTY_FACTOR = 0.3;

export interface RiskScoreInput {
  findingsBySeverity: Record<FindingSeverity, number>;
  completionPercentage: number; // 0-100
  /** Opcional: sin esto, el resultado es idéntico al de antes del Módulo C. */
  osintFindingsBySeverity?: Record<FindingSeverity, number>;
}

export interface RiskScoreResult {
  score: number; // 0-100
  findingsPenalty: number;
  coveragePenalty: number;
  osintPenalty: number;
  complianceLevel: "alto" | "medio" | "bajo" | "crítico";
}

export function calculateRiskScore(input: RiskScoreInput): RiskScoreResult {
  const findingsPenalty = (Object.entries(input.findingsBySeverity) as [FindingSeverity, number][]).reduce(
    (total, [severity, count]) => total + SEVERITY_WEIGHT[severity] * count,
    0
  );

  const coveragePenalty = Math.round((100 - input.completionPercentage) * COVERAGE_PENALTY_FACTOR);

  const osintPenalty = Math.min(
    (Object.entries(input.osintFindingsBySeverity ?? {}) as [FindingSeverity, number][]).reduce(
      (total, [severity, count]) => total + OSINT_SEVERITY_WEIGHT[severity] * count,
      0
    ),
    OSINT_PENALTY_CAP
  );

  const score = clamp(100 - findingsPenalty - coveragePenalty - osintPenalty, 0, 100);

  return {
    score,
    findingsPenalty,
    coveragePenalty,
    osintPenalty,
    complianceLevel: levelForScore(score),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function levelForScore(score: number): RiskScoreResult["complianceLevel"] {
  if (score >= 85) return "alto";
  if (score >= 60) return "medio";
  if (score >= 40) return "bajo";
  return "crítico";
}
