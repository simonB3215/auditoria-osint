import type { OsintSource } from "./types.js";

/**
 * Fuentes activas del Módulo C. Se agregan por fase: certificados y DNS de correo
 * en C1, archivo web en C2 y brechas en C3.
 */
export const OSINT_SOURCES: OsintSource[] = [];
