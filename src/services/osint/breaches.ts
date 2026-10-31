import { z } from "zod";
import { supabaseAdmin } from "../../config/supabase.js";
import { env } from "../../config/env.js";
import { buildBreachFindings } from "../findingsNormalization.js";
import { readOsintCache, writeOsintCache } from "./cache.js";
import { osintFetch } from "./httpClient.js";
import type { OsintSource } from "./types.js";

const domainSearchSchema = z.record(z.string(), z.array(z.string()));
const breachCatalogSchema = z.array(z.object({ Name: z.string(), BreachDate: z.string() }));

const CATALOG_CACHE_KEY = "catalog";
const RECENT_BREACH_MONTHS = 24;

interface MaskedExposure {
  aliasMasked: string;
  breaches: string[];
}

/** Se aplica en memoria, antes de guardar nada: el alias crudo no llega a ninguna tabla ni log. */
export function maskAlias(alias: string, domain: string): string {
  const first = alias.trim().charAt(0).toLowerCase();
  return `${first || "*"}***@${domain}`;
}

function hibpBaseUrl(): string {
  return process.env.OSINT_HIBP_BASE_URL ?? env.OSINT_HIBP_BASE_URL;
}

/**
 * Fechas de las brechas, para la severidad. Sin el catálogo se informa igual, con
 * la severidad menor: es un dato complementario y no debe frenar el hallazgo.
 */
async function loadBreachDates(organizationId: string): Promise<Record<string, string> | null> {
  const cached = await readOsintCache<Record<string, string>>(organizationId, "breaches", CATALOG_CACHE_KEY);
  if (cached) return cached;

  try {
    const response = await osintFetch(`${hibpBaseUrl()}/breaches`);
    if (response.status !== 200) return null;
    const dates = Object.fromEntries(
      breachCatalogSchema.parse(JSON.parse(response.body)).map((breach) => [breach.Name, breach.BreachDate])
    );
    await writeOsintCache(organizationId, "breaches", CATALOG_CACHE_KEY, dates);
    return dates;
  } catch (err) {
    console.error("[osint-breaches] no se pudo leer el catálogo:", err instanceof Error ? err.message : err);
    return null;
  }
}

function hasRecentBreach(breaches: string[], dates: Record<string, string> | null): boolean {
  if (!dates) return false;
  const limit = new Date();
  limit.setMonth(limit.getMonth() - RECENT_BREACH_MONTHS);
  return breaches.some((breach) => {
    const date = dates[breach];
    return date !== undefined && new Date(date) >= limit;
  });
}

/**
 * Cuentas del dominio en brechas públicas, según Have I Been Pwned. Queda
 * "preparada pero no conectada": sin `HIBP_API_KEY` no consulta nada, y además
 * HIBP exige una suscripción y verificar cada dominio en su propio panel.
 * Nunca se obtienen contraseñas ni hashes: HIBP solo informa en qué brechas
 * aparece cada cuenta.
 */
export const breachesSource: OsintSource = {
  id: "breaches",
  async run({ organizationId, auditId, osintRunId, assetId, domain }) {
    const apiKey = process.env.HIBP_API_KEY;
    if (!apiKey) {
      return { status: "not_configured", detail: "Sin HIBP_API_KEY: esta fuente no está conectada" };
    }

    const cached = await readOsintCache<MaskedExposure[]>(organizationId, "breaches", domain);
    let exposures = cached;

    if (!exposures) {
      const response = await osintFetch(`${hibpBaseUrl()}/breacheddomain/${encodeURIComponent(domain)}`, {
        headers: { "hibp-api-key": apiKey },
      });
      if (response.status === 404) {
        exposures = [];
      } else if (response.status === 401 || response.status === 403) {
        return { status: "failed", detail: "HIBP rechazó la consulta: revisar la clave y que el dominio esté verificado en su panel" };
      } else if (response.status !== 200) {
        return { status: "failed", detail: `HIBP respondió ${response.status}` };
      } else {
        exposures = Object.entries(domainSearchSchema.parse(JSON.parse(response.body))).map(([alias, breaches]) => ({
          aliasMasked: maskAlias(alias, domain),
          breaches,
        }));
      }
      await writeOsintCache(organizationId, "breaches", domain, exposures);
    }

    if (exposures.length === 0) {
      return { status: "no_data", detail: "Sin cuentas del dominio en brechas públicas", cached: cached !== null };
    }

    const { error } = await supabaseAdmin.from("osint_breach_exposures").insert(
      exposures.map((exposure) => ({
        organization_id: organizationId,
        audit_id: auditId,
        osint_run_id: osintRunId,
        parent_asset_id: assetId,
        alias_masked: exposure.aliasMasked,
        breaches: exposure.breaches,
      }))
    );
    if (error) throw new Error(error.message);

    const breachNames = [...new Set(exposures.flatMap((exposure) => exposure.breaches))].sort();
    const dates = await loadBreachDates(organizationId);
    return {
      status: "ok",
      cached: cached !== null,
      ...buildBreachFindings(auditId, assetId, domain, exposures.length, breachNames, hasRecentBreach(breachNames, dates)),
    };
  },
};
