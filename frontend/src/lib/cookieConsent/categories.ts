import type { CookieCategoryDefinition, CookieCategoryId, ConsentSelections } from "./types";

/**
 * Fuente única de verdad de las categorías de cookies. Agregar una
 * categoría nueva (p. ej. "marketing") es sumar una entrada acá — el
 * resto del sistema (cookie, UI, reconciliación) la recoge sola. La
 * copia visible (label/descripción) vive en el diccionario de i18n bajo
 * `cookieConsent.categories.<id>`, no acá.
 */
export const COOKIE_CATEGORIES: CookieCategoryDefinition[] = [
  { id: "necessary", required: true },
  { id: "analytics", required: false },
];

export function defaultSelections(): ConsentSelections {
  return COOKIE_CATEGORIES.reduce((acc, category) => {
    acc[category.id] = category.required;
    return acc;
  }, {} as ConsentSelections);
}

export function allAcceptedSelections(): ConsentSelections {
  return COOKIE_CATEGORIES.reduce((acc, category) => {
    acc[category.id] = true;
    return acc;
  }, {} as ConsentSelections);
}

export function isKnownCategory(id: string): id is CookieCategoryId {
  return COOKIE_CATEGORIES.some((category) => category.id === id);
}
