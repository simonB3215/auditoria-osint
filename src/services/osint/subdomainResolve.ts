import { BlockList, isIP } from "node:net";
import { createDnsResolver } from "../dnsResolver.js";
import { matchCdnRange } from "../../jobs/ipScopeCheck.js";

const RESOLVE_CONCURRENCY = 20;

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}

export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return !NON_PUBLIC.check(ip, family === 4 ? "ipv4" : "ipv6");
}

export interface ResolvedHost {
  hostname: string;
  resolvedIps: string[];
  behindCdn: boolean;
}

/**
 * Solo sirve para priorizar qué sugerir como activo: qué nombres tienen IP
 * pública y cuáles están detrás de una CDN. Son consultas DNS, no conexiones a
 * los hosts. Los tiempos cortos acotan el peor caso a `OSINT_MAX_SUBDOMAINS`
 * nombres, y un nombre que no resuelve simplemente queda sin IP.
 */
export async function resolveHosts(hostnames: string[]): Promise<ResolvedHost[]> {
  const resolver = createDnsResolver({ timeout: 2_000, tries: 1 });
  const results: ResolvedHost[] = [];

  for (let i = 0; i < hostnames.length; i += RESOLVE_CONCURRENCY) {
    const batch = hostnames.slice(i, i + RESOLVE_CONCURRENCY);
    results.push(
      ...(await Promise.all(
        batch.map(async (hostname) => {
          const [v4, v6] = await Promise.all([
            resolver.resolve4(hostname).catch(() => [] as string[]),
            resolver.resolve6(hostname).catch(() => [] as string[]),
          ]);
          const resolvedIps = [...v4, ...v6].filter(isPublicIp);
          return { hostname, resolvedIps, behindCdn: resolvedIps.some((ip) => matchCdnRange(ip) !== null) };
        })
      ))
    );
  }
  return results;
}
