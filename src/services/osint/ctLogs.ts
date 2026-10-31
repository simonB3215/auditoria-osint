import { z } from "zod";
import { supabaseAdmin } from "../../config/supabase.js";
import { env } from "../../config/env.js";
import { buildCtFindings } from "../findingsNormalization.js";
import { isSubdomainOf } from "../subdomainScope.js";
import { readOsintCache, writeOsintCache } from "./cache.js";
import { osintFetch } from "./httpClient.js";
import { resolveHosts } from "./subdomainResolve.js";
import type { OsintSource } from "./types.js";

const crtShResponseSchema = z.array(
  z.object({
    name_value: z.string(),
    not_before: z.string().nullish(),
    entry_timestamp: z.string().nullish(),
  })
);

interface DiscoveredHost {
  hostname: string;
  firstSeen: string | null;
  lastSeen: string | null;
  resolvedIps: string[];
  behindCdn: boolean;
}

interface CtCachePayload {
  hosts: DiscoveredHost[];
  /** Nombres distintos antes de aplicar `OSINT_MAX_SUBDOMAINS`. */
  totalFound: number;
}

/** crt.sh guarda las fechas en UTC sin indicarlo. */
function toUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseCrtShHosts(
  body: string,
  domain: string
): Array<{ hostname: string; firstSeen: string | null; lastSeen: string | null }> {
  const entries = crtShResponseSchema.parse(JSON.parse(body));
  const hosts = new Map<string, { hostname: string; firstSeen: string | null; lastSeen: string | null }>();

  for (const entry of entries) {
    const firstSeen = toUtc(entry.not_before);
    const lastSeen = toUtc(entry.entry_timestamp) ?? firstSeen;

    for (const raw of entry.name_value.split("\n")) {
      const hostname = raw.trim().toLowerCase().replace(/\.$/, "");
      // Un comodín no es un host, y crt.sh también devuelve otros nombres del certificado.
      if (hostname.includes("*") || !isSubdomainOf(hostname, domain)) continue;

      const known = hosts.get(hostname);
      hosts.set(hostname, {
        hostname,
        firstSeen: !known?.firstSeen || (firstSeen && firstSeen < known.firstSeen) ? firstSeen : known.firstSeen,
        lastSeen: !known?.lastSeen || (lastSeen && lastSeen > known.lastSeen) ? lastSeen : known.lastSeen,
      });
    }
  }
  return [...hosts.values()].sort((a, b) => a.hostname.localeCompare(b.hostname));
}

/**
 * Subdominios en Certificate Transparency. Solo los sugiere como activos: nunca
 * se escanean automáticamente.
 */
export const ctLogsSource: OsintSource = {
  id: "ct",
  async run({ organizationId, auditId, osintRunId, assetId, domain }) {
    const cached = await readOsintCache<CtCachePayload>(organizationId, "ct", domain);
    let payload = cached;

    if (!payload) {
      const base = process.env.OSINT_CRTSH_BASE_URL ?? env.OSINT_CRTSH_BASE_URL;
      // crt.sh suele tardar y cortar: más tiempo por intento y menos reintentos.
      const response = await osintFetch(`${base}/?q=${encodeURIComponent(`%.${domain}`)}&output=json`, {
        timeoutMs: env.OSINT_HTTP_TIMEOUT_MS * 2,
        retries: 1,
      });
      if (response.status !== 200) {
        return { status: "failed", detail: `crt.sh respondió ${response.status}` };
      }

      const found = parseCrtShHosts(response.body, domain);
      const kept = found.slice(0, env.OSINT_MAX_SUBDOMAINS);
      const resolved = new Map((await resolveHosts(kept.map((host) => host.hostname))).map((host) => [host.hostname, host]));

      payload = {
        totalFound: found.length,
        hosts: kept.map((host) => ({
          ...host,
          resolvedIps: resolved.get(host.hostname)?.resolvedIps ?? [],
          behindCdn: resolved.get(host.hostname)?.behindCdn ?? false,
        })),
      };
      await writeOsintCache(organizationId, "ct", domain, payload);
    }

    if (payload.hosts.length === 0) {
      return { status: "no_data", detail: "Sin subdominios en los registros de certificados", cached: cached !== null };
    }

    const [{ data: assets, error: assetsError }, { data: dismissed, error: dismissedError }] = await Promise.all([
      supabaseAdmin.from("assets").select("value").eq("organization_id", organizationId),
      // Lo que el usuario ya descartó sigue descartado en las corridas siguientes.
      supabaseAdmin
        .from("osint_discovered_subdomains")
        .select("hostname")
        .eq("organization_id", organizationId)
        .eq("status", "dismissed"),
    ]);
    if (assetsError) throw new Error(assetsError.message);
    if (dismissedError) throw new Error(dismissedError.message);

    const registered = new Set((assets ?? []).map((asset) => asset.value.toLowerCase()));
    const dismissedHosts = new Set((dismissed ?? []).map((row) => row.hostname.toLowerCase()));

    const { error: insertError } = await supabaseAdmin.from("osint_discovered_subdomains").insert(
      payload.hosts.map((host) => ({
        organization_id: organizationId,
        audit_id: auditId,
        osint_run_id: osintRunId,
        parent_asset_id: assetId,
        hostname: host.hostname,
        first_seen: host.firstSeen,
        last_seen: host.lastSeen,
        resolved_ips: host.resolvedIps,
        behind_cdn: host.behindCdn,
        status: dismissedHosts.has(host.hostname) ? "dismissed" : "new",
      }))
    );
    if (insertError) throw new Error(insertError.message);

    const unregistered = payload.hosts
      .filter((host) => !registered.has(host.hostname) && !dismissedHosts.has(host.hostname))
      .map((host) => host.hostname);
    const truncated = payload.totalFound > payload.hosts.length;

    return {
      status: "ok",
      detail: truncated ? `Se analizaron ${payload.hosts.length} de ${payload.totalFound} subdominios` : undefined,
      cached: cached !== null,
      findings: buildCtFindings(auditId, assetId, domain, unregistered),
      summary: {
        subdomains: payload.totalFound,
        unregistered: unregistered.length,
        behindCdn: payload.hosts.filter((host) => host.behindCdn).length,
      },
    };
  },
};
