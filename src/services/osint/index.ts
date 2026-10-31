import { ctLogsSource } from "./ctLogs.js";
import { emailDnsSource } from "./emailDns.js";
import type { OsintSource } from "./types.js";

/**
 * Fuentes activas del Módulo C. Se agregan por fase: archivo web en C2 y brechas
 * en C3.
 */
export const OSINT_SOURCES: OsintSource[] = [ctLogsSource, emailDnsSource];
