import type { NormalizedFinding } from "../findingsNormalization.js";

export type OsintSourceId = "ct" | "email_dns" | "wayback" | "breaches";

export type OsintSourceOutcome = "ok" | "partial" | "failed" | "not_configured" | "no_data";

export interface OsintSourceContext {
  organizationId: string;
  auditId: string;
  osintRunId: string;
  assetId: string;
  domain: string;
}

export interface OsintSourceResult {
  status: OsintSourceOutcome;
  detail?: string;
  /** Se respondió desde `osint_source_cache`, sin consultar la fuente. */
  cached?: boolean;
  findings?: NormalizedFinding[];
  /** Resumen acotado y sin datos personales: va a `osint_runs.summary`. */
  summary?: Record<string, unknown>;
}

/**
 * Una fuente pasiva: consulta a terceros sobre el dominio y nunca envía tráfico
 * a la infraestructura del cliente. Una fuente que falla debe poder lanzar o
 * devolver `failed`: el procesador la aísla de las demás.
 */
export interface OsintSource {
  id: OsintSourceId;
  run(context: OsintSourceContext): Promise<OsintSourceResult>;
}
