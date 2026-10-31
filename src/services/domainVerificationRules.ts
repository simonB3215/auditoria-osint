/**
 * Reglas puras de la verificación de dominios (Parte 1 del plan del Módulo
 * C): sin red ni base de datos, para poder probarlas sin levantar nada.
 */

/** Deja el RUT como lo guarda la base: sin puntos, con guion y K mayúscula. */
export function normalizeRut(raw: string): string {
  return raw.trim().replace(/\./g, "").toUpperCase();
}

/** Valida formato y dígito verificador (módulo 11) de un RUT ya normalizado. */
export function isValidRut(rut: string): boolean {
  const match = /^([0-9]{7,8})-([0-9K])$/.exec(rut);
  if (!match) return false;
  const [, body, verifier] = match;

  let sum = 0;
  let factor = 2;
  for (const digit of [...body!].reverse()) {
    sum += Number(digit) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return verifier === expected;
}

/**
 * Proveedores gratuitos: cualquiera puede abrir una cuenta ahí, así que ese
 * correo no dice nada sobre quién controla el dominio.
 */
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.cl",
  "hotmail.com",
  "hotmail.cl",
  "live.com",
  "live.cl",
  "msn.com",
  "yahoo.com",
  "yahoo.es",
  "yahoo.cl",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "zoho.com",
  "yandex.com",
  "mail.com",
]);

export function emailDomainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
}

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/** Coincidencia exacta: `mail.empresa.cl` no prueba control sobre `empresa.cl`. */
export function emailMatchesDomain(email: string, domain: string): boolean {
  return emailDomainOf(email) === domain.trim().toLowerCase();
}

const SENSITIVE_DOMAIN_SUFFIXES = ["gob.cl", "mil.cl"];

export function isSensitiveDomain(domain: string): boolean {
  const value = domain.trim().toLowerCase();
  return SENSITIVE_DOMAIN_SUFFIXES.some((suffix) => value === suffix || value.endsWith(`.${suffix}`));
}

export type DeclarantEmailProblem = "EMAIL_NOT_CONFIRMED" | "FREE_EMAIL_NOT_ALLOWED";

export function checkDeclarantEmail(
  email: string | null | undefined,
  emailConfirmedAt: string | null | undefined
): DeclarantEmailProblem | null {
  if (!email || !emailConfirmedAt) return "EMAIL_NOT_CONFIRMED";
  if (isFreeEmailDomain(emailDomainOf(email))) return "FREE_EMAIL_NOT_ALLOWED";
  return null;
}

export type DomainReviewReason = "email_domain_mismatch" | "sensitive_domain";

export interface DomainRoute {
  status: "pending_email" | "pending_review";
  reviewReason: DomainReviewReason | null;
}

/**
 * Todo dominio termina en revisión manual, porque el certificado de poderes
 * se revisa a mano. Lo que cambia es el camino: sin correo del dominio no hay
 * link que enviar y pasa directo a revisión, con el motivo a la vista.
 */
export function routeDeclaredDomain(email: string, domain: string): DomainRoute {
  if (!emailMatchesDomain(email, domain)) {
    return { status: "pending_review", reviewReason: "email_domain_mismatch" };
  }
  return { status: "pending_email", reviewReason: isSensitiveDomain(domain) ? "sensitive_domain" : null };
}
