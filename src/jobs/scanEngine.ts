import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connect as tlsConnect } from "node:tls";

const execFileAsync = promisify(execFile);

/**
 * Timeout por invocación de nmap. Exportado (no solo local) porque
 * `scanWorker.ts` deriva `JOB_TIME_BUDGET_MS` a partir de este mismo
 * valor — una sola fuente de verdad para que ambos números no puedan
 * desincronizarse (a.md, seguimiento del motor de escaneo, Tarea 2).
 */
export const NMAP_TIMEOUT_MS = 5 * 60 * 1000;

const CHECK_TIMEOUT_MS = 8000;
const HTTPS_PORTS = new Set([443, 8443]);
const HTTP_LIKE_PORTS = new Set([80, 443, 8080, 8443]);
const WEAK_TLS_PROTOCOLS = new Set(["TLSv1", "TLSv1.1", "SSLv3"]);
const REQUIRED_SECURITY_HEADERS = [
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "content-security-policy",
];

export interface OpenPort {
  port: number;
  protocol: "tcp" | "udp";
  service: string;
}

export type ScanEngineResult =
  | { ok: true; openPorts: OpenPort[] }
  | {
      ok: false;
      // "out_of_scope_or_proxied": el activo resolvió (o apunta directo) a
      // una IP dentro de un rango de CDN/proxy conocido — ver
      // src/jobs/ipScopeCheck.ts (hardening del motor de escaneo, a.md
      // sección 1.1). El chequeo ocurre en scanWorker.ts antes de llamar a
      // esta función, no acá adentro.
      reason: "engine_not_available" | "scan_failed" | "out_of_scope_or_proxied";
      detail: string;
    };

/**
 * Ejecuta un escaneo de puertos con Nmap contra un target ya validado
 * (IP / CIDR / dominio verificado — ver assets.ts). Usa execFile con args
 * en array (nunca interpolación de shell) para eliminar el riesgo de
 * inyección de comandos vía el valor del activo.
 *
 * Nota de alcance del MVP: solo se detectan puertos abiertos + servicio
 * asociado (banner grabbing básico de Nmap, `-sV`). Detección de cifrados
 * débiles (`--script ssl-enum-ciphers`) y de parches faltantes (NSE `vuln`
 * scripts / integración con Nuclei) queda fuera de este MVP y se deja como
 * punto de extensión de ScanEngineResult.
 *
 * `topPorts`: cuántos puertos más comunes escanea nmap (`--top-ports`).
 * Lo decide el llamador (scanWorker.ts, desde `env.SCAN_TOP_PORTS`) — este
 * motor no importa configuración directamente, la recibe como parámetro
 * (a.md, seguimiento del motor de escaneo, Tarea 3).
 */
export async function runNmapScan(target: string, topPorts: number): Promise<ScanEngineResult> {
  try {
    const { stdout } = await execFileAsync(
      // -T3 ("normal", el default de nmap) en vez de -T4 ("aggressive"):
      // -T4 aumenta la probabilidad de disparar IDS/IPS del cliente, y acá
      // se está escaneando infraestructura de terceros — aunque esté
      // autorizada, conviene el timing más prudente (a.md, hardening del
      // motor de escaneo, sección 1.3). No se expone como configuración
      // libre (a.md, seguimiento, Fuera de alcance).
      "nmap",
      ["-Pn", "-T3", "--top-ports", String(topPorts), "-sV", "-oG", "-", target],
      { timeout: NMAP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    );
    return { ok: true, openPorts: parseGrepableOutput(stdout) };
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      return {
        ok: false,
        reason: "engine_not_available",
        detail:
          "El binario 'nmap' no está instalado en este worker. Instalar Nmap o desplegar el worker en la imagen que lo incluye.",
      };
    }
    return { ok: false, reason: "scan_failed", detail: nodeErr.message ?? "Error desconocido ejecutando nmap" };
  }
}

export interface TlsCertFinding {
  kind: "expired_cert" | "expiring_soon_cert" | "weak_protocol" | "untrusted_cert";
  detail: string;
}

/**
 * Conecta por TLS y revisa el certificado del peer: vencimiento (o por
 * vencer en <30 días), si la cadena es de confianza, y si el protocolo
 * negociado es una versión débil (TLSv1/1.1/SSLv3). Timeout estricto para
 * no colgar el worker si el host no responde.
 */
export async function checkTlsCertificate(host: string, port: number): Promise<TlsCertFinding[]> {
  return new Promise((resolve) => {
    const findings: TlsCertFinding[] = [];
    let settled = false;

    const socket = tlsConnect({ host, port, servername: host, timeout: CHECK_TIMEOUT_MS, rejectUnauthorized: false });

    function finish(result: TlsCertFinding[]) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    }

    socket.on("timeout", () => finish([]));
    socket.on("error", () => finish([])); // host sin TLS en ese puerto, o inalcanzable: no es un finding en sí

    socket.on("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const protocol = socket.getProtocol();

      if (protocol && WEAK_TLS_PROTOCOLS.has(protocol)) {
        findings.push({ kind: "weak_protocol", detail: `Protocolo TLS débil negociado: ${protocol}` });
      }

      if (!socket.authorized) {
        findings.push({
          kind: "untrusted_cert",
          detail: `Certificado no confiable: ${socket.authorizationError ?? "razón desconocida"}`,
        });
      }

      if (cert && cert.valid_to) {
        const validTo = new Date(cert.valid_to);
        const daysLeft = (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysLeft < 0) {
          findings.push({ kind: "expired_cert", detail: `Certificado vencido desde ${cert.valid_to}` });
        } else if (daysLeft < 30) {
          findings.push({
            kind: "expiring_soon_cert",
            detail: `Certificado vence en ${Math.floor(daysLeft)} día(s) (${cert.valid_to})`,
          });
        }
      }

      finish(findings);
    });
  });
}

export interface HeaderFinding {
  header: string;
}

/**
 * Pide "/" por HTTP(S) y revisa qué cabeceras de seguridad estándar faltan.
 * Timeout estricto vía AbortController.
 */
export async function checkSecurityHeaders(
  host: string,
  port: number,
  useHttps: boolean
): Promise<HeaderFinding[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  const url = `${useHttps ? "https" : "http"}://${host}:${port}/`;

  try {
    // Nota: si el host usa un certificado self-signed/no confiable, este
    // fetch() falla (Node valida la cadena por defecto) y el catch de abajo
    // devuelve "sin findings" en vez de reportar cabeceras faltantes —
    // limitación conocida; ese caso ya queda cubierto por el finding
    // "untrusted_cert" de checkTlsCertificate.
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return REQUIRED_SECURITY_HEADERS.filter((h) => !res.headers.has(h)).map((header) => ({ header }));
  } catch {
    return []; // host no responde HTTP en ese puerto: no es un finding de cabeceras
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isHttpsPort(port: number): boolean {
  return HTTPS_PORTS.has(port);
}

export function isHttpLikePort(port: number): boolean {
  return HTTP_LIKE_PORTS.has(port);
}

/** Parsea la salida "grepable" de nmap (-oG -). */
function parseGrepableOutput(output: string): OpenPort[] {
  const ports: OpenPort[] = [];
  const portsLineRegex = /Ports:\s*(.+?)(?:\tIgnored State|\n|$)/;

  for (const line of output.split("\n")) {
    if (!line.startsWith("Host:") || !line.includes("Ports:")) continue;

    const match = portsLineRegex.exec(line);
    if (!match) continue;

    for (const entry of match[1].split(",")) {
      const fields = entry.trim().split("/");
      // formato: puerto/estado/protocolo/owner/servicio/rpc-info/version
      const [portStr, state, protocol, , service] = fields;
      if (state !== "open") continue;
      const port = Number(portStr);
      if (!Number.isInteger(port)) continue;

      ports.push({
        port,
        protocol: protocol === "udp" ? "udp" : "tcp",
        service: service && service.length > 0 ? service : "desconocido",
      });
    }
  }

  return ports;
}
