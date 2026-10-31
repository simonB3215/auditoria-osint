import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { decryptEvidence, encryptEvidence } from "../utils/evidenceCrypto.js";

export type DeclarationDocumentKind = "signed" | "powers";

export function declarationDocumentPath(
  organizationId: string,
  declarationId: string,
  kind: DeclarationDocumentKind
): string {
  return `${organizationId}/${declarationId}/${kind}.pdf.enc`;
}

/** Mismo cifrado que las evidencias, en un bucket privado propio. */
export async function uploadDeclarationDocument(path: string, buffer: Buffer): Promise<void> {
  const { blob } = encryptEvidence(buffer);
  const { error } = await supabaseAdmin.storage
    .from(env.DOMAIN_DECLARATION_BUCKET)
    .upload(path, blob, { contentType: "application/octet-stream", upsert: false });
  if (error) {
    throw new Error(`No se pudo subir el documento a Storage: ${error.message}`);
  }
}

export async function downloadDeclarationDocument(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(env.DOMAIN_DECLARATION_BUCKET).download(path);
  if (error || !data) {
    throw new Error(`No se pudo descargar el documento de Storage: ${error?.message}`);
  }
  return decryptEvidence(Buffer.from(await data.arrayBuffer()));
}

/** Best-effort: se usa para limpiar después de un fallo, sin tapar el error original. */
export async function removeDeclarationDocuments(paths: string[]): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(env.DOMAIN_DECLARATION_BUCKET).remove(paths);
  if (error) {
    console.error(`[domain-declaration] no se pudieron borrar documentos: ${error.message}`);
  }
}
