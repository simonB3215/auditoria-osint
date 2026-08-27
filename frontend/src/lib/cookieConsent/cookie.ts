import { COOKIE_CATEGORIES, defaultSelections, isKnownCategory } from "./categories";
import type { ConsentRecord, ConsentSelections } from "./types";

export const CONSENT_COOKIE_NAME = "aegis_cookie_consent";

/**
 * Subir este número invalida cualquier consentimiento previo y vuelve a
 * mostrar el banner — usarlo cuando cambie el set de categorías de forma
 * que amerite que el usuario vuelva a decidir desde cero (p. ej. una
 * categoría dejó de ser opcional). Agregar una categoría opt-in nueva NO
 * requiere subir la versión: se reconcilia sola como no consentida
 * (ver `reconcileConsent`).
 */
export const CONSENT_SCHEMA_VERSION = 1;

const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // ~180 días

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredValue(raw: string): ConsentRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainRecord(parsed)) return null;
  const { version, timestamp, categories } = parsed;
  if (typeof version !== "number" || typeof timestamp !== "string" || !isPlainRecord(categories)) {
    return null;
  }

  const selections: ConsentSelections = defaultSelections();
  for (const [key, value] of Object.entries(categories)) {
    if (isKnownCategory(key) && typeof value === "boolean") {
      selections[key] = value;
    }
  }

  return { version, timestamp, categories: selections };
}

/** Lee y parsea la cookie de consentimiento a partir de un string `document.cookie` o de un header `Cookie`. */
export function parseConsentCookie(cookieString: string | undefined | null): ConsentRecord | null {
  if (!cookieString) return null;

  for (const part of cookieString.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const name = part.slice(0, eqIndex).trim();
    if (name !== CONSENT_COOKIE_NAME) continue;

    const rawValue = part.slice(eqIndex + 1).trim();
    try {
      return parseStoredValue(decodeURIComponent(rawValue));
    } catch {
      return null;
    }
  }

  return null;
}

export function serializeConsentCookie(record: ConsentRecord): string {
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  const value = encodeURIComponent(JSON.stringify(record));
  return `${CONSENT_COOKIE_NAME}=${value}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

export function readConsentCookieFromDocument(): ConsentRecord | null {
  if (typeof document === "undefined") return null;
  return parseConsentCookie(document.cookie);
}

export function writeConsentCookieToDocument(selections: ConsentSelections): ConsentRecord {
  const record: ConsentRecord = {
    version: CONSENT_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    categories: selections,
  };
  document.cookie = serializeConsentCookie(record);
  return record;
}

export interface ReconciledConsent {
  /** true si el usuario todavía no tomó una decisión (cookie ausente o de una versión de esquema anterior). */
  needsDecision: boolean;
  selections: ConsentSelections;
}

/**
 * Reconcilia una cookie leída con las categorías vigentes del código:
 * - Sin cookie, o con una versión de esquema distinta a la actual: reset
 *   total, el usuario debe decidir de nuevo (vuelve a mostrarse el banner).
 * - Cookie válida de la versión actual: se conservan las decisiones ya
 *   tomadas; cualquier categoría opcional nueva que no exista en la
 *   cookie guardada entra en `false` (no consentida) sin forzar que el
 *   banner reaparezca, ya que "apagada por defecto" ya es la postura
 *   conforme.
 */
export function reconcileConsent(stored: ConsentRecord | null): ReconciledConsent {
  if (!stored || stored.version !== CONSENT_SCHEMA_VERSION) {
    return { needsDecision: true, selections: defaultSelections() };
  }

  const selections: ConsentSelections = defaultSelections();
  for (const category of COOKIE_CATEGORIES) {
    if (category.required) {
      selections[category.id] = true;
      continue;
    }
    const storedValue = stored.categories[category.id];
    selections[category.id] = typeof storedValue === "boolean" ? storedValue : false;
  }

  return { needsDecision: false, selections };
}
