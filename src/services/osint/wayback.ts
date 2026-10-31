import { z } from "zod";
import { env } from "../../config/env.js";
import { buildArchiveFindings, classifyArchivedPath, type ArchivedUrl } from "../findingsNormalization.js";
import { isSubdomainOf } from "../subdomainScope.js";
import { readOsintCache, writeOsintCache } from "./cache.js";
import { osintFetch } from "./httpClient.js";
import type { OsintSource } from "./types.js";

const cdxResponseSchema = z.array(z.array(z.string()));

/** Una captura con error nunca expuso el recurso; `-` es como CDX marca algunas redirecciones. */
const EXPOSED_STATUS = /^([23]\d\d|-)$/;

/**
 * Se queda solo con las URLs sensibles y sin su query: puede traer tokens o
 * datos personales, y no aporta para el hallazgo.
 */
export function parseCdxUrls(body: string, domain: string): ArchivedUrl[] {
  const [header, ...rows] = cdxResponseSchema.parse(JSON.parse(body));
  if (!header) return [];

  const originalAt = header.indexOf("original");
  const statusAt = header.indexOf("statuscode");
  if (originalAt < 0 || statusAt < 0) throw new Error("Respuesta CDX sin las columnas esperadas");

  const urls = new Map<string, ArchivedUrl>();
  for (const row of rows) {
    if (!EXPOSED_STATUS.test(row[statusAt] ?? "")) continue;

    let parsed: URL;
    try {
      parsed = new URL(row[originalAt] ?? "");
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== domain && !isSubdomainOf(host, domain)) continue;

    const pattern = classifyArchivedPath(parsed.pathname);
    if (!pattern) continue;

    const url = `${host}${parsed.pathname}`;
    urls.set(url, { url, ...pattern });
  }
  return [...urls.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * URLs históricas en el archivo de Internet. Solo se consulta el índice de
 * archive.org: nunca se visita la URL original, porque eso sería tráfico hacia
 * el cliente.
 */
export const waybackSource: OsintSource = {
  id: "wayback",
  async run({ organizationId, auditId, assetId, domain }) {
    const cached = await readOsintCache<ArchivedUrl[]>(organizationId, "wayback", domain);
    let urls = cached;

    if (!urls) {
      const base = process.env.OSINT_WAYBACK_BASE_URL ?? env.OSINT_WAYBACK_BASE_URL;
      const query = new URLSearchParams({
        url: domain,
        matchType: "domain",
        output: "json",
        fl: "original,timestamp,statuscode",
        collapse: "urlkey",
        limit: String(env.OSINT_WAYBACK_LIMIT),
      });
      const response = await osintFetch(`${base}/cdx/search/cdx?${query}`, {
        timeoutMs: env.OSINT_HTTP_TIMEOUT_MS * 2,
        retries: 1,
      });
      if (response.status !== 200) {
        return { status: "failed", detail: `El archivo web respondió ${response.status}` };
      }
      urls = parseCdxUrls(response.body, domain);
      await writeOsintCache(organizationId, "wayback", domain, urls);
    }

    if (urls.length === 0) {
      return { status: "no_data", detail: "Sin URLs sensibles en el archivo web", cached: cached !== null };
    }
    return {
      status: "ok",
      cached: cached !== null,
      ...buildArchiveFindings(auditId, assetId, domain, urls),
    };
  },
};
