import { supabaseAdmin } from "../../config/supabase.js";
import { env } from "../../config/env.js";
import type { OsintSourceId } from "./types.js";

/**
 * Evita repetir consultas a fuentes externas al relanzar una corrida. Un fallo
 * de la caché nunca debe fallar la fuente: se comporta como si no hubiera dato.
 */
export async function readOsintCache<T>(
  organizationId: string,
  source: OsintSourceId,
  queryKey: string
): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from("osint_source_cache")
    .select("payload")
    .eq("organization_id", organizationId)
    .eq("source", source)
    .eq("query_key", queryKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) {
    console.error(`[osint-cache] no se pudo leer ${source}: ${error.message}`);
    return null;
  }
  return (data?.payload as T | undefined) ?? null;
}

export async function writeOsintCache(
  organizationId: string,
  source: OsintSourceId,
  queryKey: string,
  payload: unknown
): Promise<void> {
  const now = Date.now();
  const { error } = await supabaseAdmin.from("osint_source_cache").upsert(
    {
      organization_id: organizationId,
      source,
      query_key: queryKey,
      payload,
      fetched_at: new Date(now).toISOString(),
      expires_at: new Date(now + env.OSINT_CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: "organization_id,source,query_key" }
  );
  if (error) {
    console.error(`[osint-cache] no se pudo guardar ${source}: ${error.message}`);
  }
}
