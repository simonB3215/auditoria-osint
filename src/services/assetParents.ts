import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../middlewares/errorHandler.js";

export const TARGET_ASSET_SELECT = "id, type, value, verification_status, parent_asset_id";

export interface TargetAssetRow {
  id: string;
  type: string;
  value: string;
  verification_status: string;
  parent_asset_id: string | null;
  parent?: { value: string; verification_status: string };
}

/**
 * Trae aparte el dominio padre de cada subdominio: PostgREST no detecta la
 * relación del activo consigo mismo por la FK compuesta de la migración 024.
 * Un padre que no vuelve se trata como no verificado.
 */
export async function attachParents(supabase: SupabaseClient, assets: TargetAssetRow[]): Promise<TargetAssetRow[]> {
  const parentIds = [...new Set(assets.flatMap((a) => (a.parent_asset_id ? [a.parent_asset_id] : [])))];
  if (parentIds.length === 0) return assets;

  const { data, error } = await supabase.from("assets").select("id, value, verification_status").in("id", parentIds);
  if (error) throw new AppError(400, "ASSETS_FETCH_FAILED", error.message);

  const parents = new Map((data ?? []).map((parent) => [parent.id, parent]));
  return assets.map((a) =>
    a.parent_asset_id
      ? { ...a, parent: parents.get(a.parent_asset_id) ?? { value: "", verification_status: "pending" } }
      : a
  );
}
