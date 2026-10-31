import { breachesSource } from "./breaches.js";
import { ctLogsSource } from "./ctLogs.js";
import { emailDnsSource } from "./emailDns.js";
import type { OsintSource } from "./types.js";
import { waybackSource } from "./wayback.js";

/** Fuentes activas del Módulo C. */
export const OSINT_SOURCES: OsintSource[] = [ctLogsSource, emailDnsSource, waybackSource, breachesSource];
