import { promises as dns } from "node:dns";
import { isIPv4, isIPv6 } from "node:net";
import { CDN_PROXY_RANGES, type CdnRange } from "./cdnRanges.js";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) >>> 0 === (ipv4ToInt(rangeIp) & mask) >>> 0;
}

/** Expande una dirección IPv6 (con o sin compresión "::") a un entero de 128 bits. */
function ipv6ToBigInt(ip: string): bigint {
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = Math.max(8 - headParts.length - tailParts.length, 0);
  const groups = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g || "0", 16)), 0n);
}

function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split("/");
  const prefix = BigInt(Number(prefixStr));
  const FULL_MASK = (1n << 128n) - 1n;
  const mask = prefix === 0n ? 0n : (FULL_MASK << (128n - prefix)) & FULL_MASK;
  return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(rangeIp) & mask);
}

/** Devuelve el rango CDN/proxy que contiene a `ip`, o `null` si no matchea ninguno. */
export function matchCdnRange(ip: string, ranges: CdnRange[] = CDN_PROXY_RANGES): CdnRange | null {
  for (const range of ranges) {
    if (isIPv4(ip) && range.cidr.includes(".") && isIpv4InCidr(ip, range.cidr)) return range;
    if (isIPv6(ip) && range.cidr.includes(":") && isIpv6InCidr(ip, range.cidr)) return range;
  }
  return null;
}

export type ScopeCheckResult =
  | { ok: true; targetIp: string }
  | { ok: false; reason: "cdn_or_proxy" | "dns_resolution_failed"; detail: string };

/**
 * Resuelve un dominio a sus IPs (A y AAAA) y verifica que ninguna caiga
 * dentro de un rango de CDN/proxy conocido, antes de permitir que se lo
 * escanee (a.md, hardening del motor de escaneo, sección 1.1).
 *
 * Si el dominio resuelve a alguna IP dentro de un rango conocido, se
 * bloquea el activo COMPLETO (no solo esa IP) — con DNS round-robin/geo-
 * routing no hay garantía de qué IP resolvería nmap en el momento real
 * del escaneo, así que basta con que UNA de las respuestas sea de un
 * CDN/proxy para tratar el dominio entero como fuera de alcance.
 *
 * Si pasa el chequeo, devuelve la IP ya verificada para que el worker se
 * la pase directo a `runNmapScan` — nunca el nombre de dominio original,
 * para que no haya una segunda resolución fuera de este control (evitaría
 * un bypass por un cambio de DNS entre el chequeo y el escaneo real).
 */
export async function resolveAndCheckScope(hostname: string): Promise<ScopeCheckResult> {
  const [v4, v6] = await Promise.all([
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve6(hostname).catch(() => [] as string[]),
  ]);
  const addresses = [...v4, ...v6];

  if (addresses.length === 0) {
    return {
      ok: false,
      reason: "dns_resolution_failed",
      detail: `No se pudo resolver '${hostname}' a ninguna IP (registros A/AAAA).`,
    };
  }

  for (const ip of addresses) {
    const match = matchCdnRange(ip);
    if (match) {
      return {
        ok: false,
        reason: "cdn_or_proxy",
        detail: `'${hostname}' resuelve a ${ip}, dentro del rango publicado de ${match.provider} (${match.cidr}) — infraestructura de terceros, fuera de alcance.`,
      };
    }
  }

  return { ok: true, targetIp: v4[0] ?? v6[0] };
}
