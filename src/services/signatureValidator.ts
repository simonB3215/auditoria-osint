import { z } from "zod";
import { normalizeRut } from "./domainVerificationRules.js";

export type SignatureCheck =
  | { status: "valid"; signerRut: string }
  | { status: "invalid"; reason: "signature_rejected" | "not_advanced" | "signer_mismatch" }
  | { status: "not_configured" }
  | { status: "unavailable" };

const providerResponseSchema = z.object({
  valid: z.boolean(),
  advanced: z.boolean(),
  signer_rut: z.string().nullable().optional(),
});

/**
 * Patrón "preparado pero no conectado": sin `SIGNATURE_VALIDATOR_URL` (el
 * proveedor es el pendiente P2) responde `not_configured`, y quien llama debe
 * rechazar. Ningún camino de error aprueba una firma.
 *
 * El contrato HTTP es provisional. Al contratar el proveedor, solo debería
 * cambiar esta función: el resto del flujo depende de `SignatureCheck`.
 */
export async function validateSignedDocument(document: Buffer, expectedSignerRut: string): Promise<SignatureCheck> {
  const url = process.env.SIGNATURE_VALIDATOR_URL;
  if (!url) return { status: "not_configured" };

  let body: unknown;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SIGNATURE_VALIDATOR_API_KEY
          ? { Authorization: `Bearer ${process.env.SIGNATURE_VALIDATOR_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ document_base64: document.toString("base64") }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`[signature] el proveedor respondió ${response.status}`);
      return { status: "unavailable" };
    }
    body = await response.json();
  } catch (err) {
    console.error("[signature] no se pudo consultar al proveedor:", err instanceof Error ? err.message : err);
    return { status: "unavailable" };
  }

  const parsed = providerResponseSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[signature] respuesta del proveedor con formato inesperado");
    return { status: "unavailable" };
  }

  const { valid, advanced, signer_rut: signerRut } = parsed.data;
  if (!valid) return { status: "invalid", reason: "signature_rejected" };
  if (!advanced) return { status: "invalid", reason: "not_advanced" };
  if (!signerRut || normalizeRut(signerRut) !== expectedSignerRut) {
    return { status: "invalid", reason: "signer_mismatch" };
  }
  return { status: "valid", signerRut: expectedSignerRut };
}
