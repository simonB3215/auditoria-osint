import type { Request } from "express";
import { supabaseAdmin } from "../config/supabase.js";

/**
 * Acciones instrumentadas. No es un enum de BD (audit_logs.action es
 * `text` libre) para no requerir una migración cada vez que se agrega un
 * evento nuevo — esta lista es la referencia de qué valores existen hoy.
 * (El sistema de invitación por link se eliminó — filas históricas de
 * `audit_logs` pueden seguir teniendo `USER_INVITED`/`INVITATION_ACCEPTED`,
 * pero ya no se generan nuevas.)
 */
export const AUDIT_ACTIONS = {
  EVIDENCE_UPLOADED: "EVIDENCE_UPLOADED",
  FINDING_STATUS_CHANGED: "FINDING_STATUS_CHANGED",
  REPORT_GENERATED: "REPORT_GENERATED",
  USER_ROLE_CHANGED: "USER_ROLE_CHANGED",
  ORGANIZATION_SUSPENDED: "ORGANIZATION_SUSPENDED",
  ORGANIZATION_REACTIVATED: "ORGANIZATION_REACTIVATED",
  ORGANIZATION_DELETED: "ORGANIZATION_DELETED",
  RETENTION_POLICY_UPDATED: "RETENTION_POLICY_UPDATED",
  EVIDENCE_PURGED: "EVIDENCE_PURGED",
  GUEST_ROLE_EXPIRED: "GUEST_ROLE_EXPIRED",
  SCAN_EXECUTED: "SCAN_EXECUTED",
  UNAUTHORIZED_SCAN_BLOCKED: "UNAUTHORIZED_SCAN_BLOCKED",
  DOMAIN_VERIFICATION_EMAIL_SENT: "DOMAIN_VERIFICATION_EMAIL_SENT",
  USER_ORGANIZATION_CHANGED: "USER_ORGANIZATION_CHANGED",
  ORGANIZATION_UPDATED: "ORGANIZATION_UPDATED",
  USER_ACCOUNT_DEACTIVATED: "USER_ACCOUNT_DEACTIVATED",
  USER_ACCOUNT_REACTIVATED: "USER_ACCOUNT_REACTIVATED",
  AUTH_LOGIN_FAILED: "AUTH_LOGIN_FAILED",
  AUTH_TOKEN_REJECTED: "AUTH_TOKEN_REJECTED",
  AUTH_PASSWORD_RESET_BY_ADMIN: "AUTH_PASSWORD_RESET_BY_ADMIN",
  SANDBOX_CREATED: "SANDBOX_CREATED",
  SANDBOX_DELETED: "SANDBOX_DELETED",
  DOMAIN_AUTO_VERIFIED: "DOMAIN_AUTO_VERIFIED",
  // Hardening del motor de escaneo (a.md, secciones 1.1 y 1.2).
  SCAN_TARGET_OUT_OF_SCOPE: "SCAN_TARGET_OUT_OF_SCOPE",
  SCAN_TIME_BUDGET_EXCEEDED: "SCAN_TIME_BUDGET_EXCEEDED",
  // Seguimiento del motor de escaneo (a.md, Tarea 1): rechazo explícito de
  // un activo `cidr`, distinto de "tipo no soportado" (skipped).
  CIDR_SCAN_BLOCKED: "CIDR_SCAN_BLOCKED",
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditResourceType =
  | "evidence"
  | "finding"
  | "report"
  | "user"
  | "organization"
  | "scan"
  | "asset"
  | "auth"
  | "audit";

interface LogAuditEventParams {
  organizationId: string | null;
  actorId: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  payloadBefore?: unknown;
  payloadAfter?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Escribe un evento en `audit_logs` con service_role (la tabla no acepta
 * UPDATE/DELETE de ningún rol — ver migración 009). Nunca debe poder
 * tumbar la operación de negocio que la originó: los errores se registran
 * en consola pero no se propagan.
 */
export async function logAuditEvent(params: LogAuditEventParams): Promise<void> {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    organization_id: params.organizationId,
    actor_id: params.actorId,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    payload_before: params.payloadBefore ?? null,
    payload_after: params.payloadAfter ?? null,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
  });

  if (error) {
    console.error(`[audit-logger] no se pudo registrar el evento ${params.action}:`, error.message);
  }
}

/** IP y user-agent del request, para adjuntar al log sin repetir esto en cada ruta. */
export function requestContext(req: Request): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  };
}
