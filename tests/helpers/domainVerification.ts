import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { api, bearer } from "./apiClient.js";
import { validPdfBuffer } from "./fixtures.js";
import type { TestUser } from "./tenants.js";
import { supabaseAdmin } from "../../src/config/supabase.js";
import { removeDeclarationDocuments } from "../../src/services/domainDeclarationDocuments.js";

export const ORGANIZATION_RUT = "22222222-2";
export const SIGNER_RUT = "11111111-1";
export const OTHER_RUT = "33333333-3";

export function uniqueDomain(): string {
  return `ver-${randomUUID()}.aegis.local`;
}

/** El contenido decide qué responde el proveedor falso de firma. */
export function pdfWith(label: string): Buffer {
  return Buffer.concat([validPdfBuffer, Buffer.from(`\n%${label}\n`)]);
}

export interface ProviderStub {
  signatureUrl: string;
  emailUrl: string;
  sentEmails: Array<{ to: string[]; subject: string; text: string; html: string }>;
  close(): Promise<void>;
}

/**
 * Servidor HTTP real que hace de proveedor de firma y de Resend: el código
 * bajo prueba hace su `fetch` real, igual que contra `127.0.0.1:1` para los
 * fallos de conexión.
 */
export async function startProviderStub(): Promise<ProviderStub> {
  const sentEmails: ProviderStub["sentEmails"] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/emails") {
        sentEmails.push(body);
        res.end(JSON.stringify({ id: randomUUID() }));
        return;
      }

      const document = Buffer.from(body.document_base64, "base64").toString("latin1");
      if (document.includes("FIRMA-RECHAZADA")) {
        res.end(JSON.stringify({ valid: false, advanced: false, signer_rut: null }));
      } else if (document.includes("FIRMA-SIMPLE")) {
        res.end(JSON.stringify({ valid: true, advanced: false, signer_rut: "11.111.111-1" }));
      } else {
        res.end(JSON.stringify({ valid: true, advanced: true, signer_rut: "11.111.111-1" }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    signatureUrl: `http://127.0.0.1:${port}/signature`,
    emailUrl: `http://127.0.0.1:${port}/emails`,
    sentEmails,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function createDomainAsset(user: TestUser, value = uniqueDomain()): Promise<{ id: string; value: string }> {
  const { data, error } = await supabaseAdmin
    .from("assets")
    .insert({ type: "domain", value, organization_id: user.organizationId, created_by: user.userId })
    .select("id, value")
    .single();
  if (error || !data) throw new Error(`No se pudo crear el activo de test: ${error?.message}`);
  return data;
}

export function submitDeclaration(
  user: TestUser,
  assetIds: string[],
  options: { signed?: Buffer; powers?: Buffer; signerRut?: string; organizationRut?: string } = {}
) {
  return api
    .post("/api/v1/domain-declarations")
    .set("Authorization", bearer(user.accessToken))
    .field("organization_rut", options.organizationRut ?? ORGANIZATION_RUT)
    .field("signer_rut", options.signerRut ?? SIGNER_RUT)
    .field("asset_ids", JSON.stringify(assetIds))
    .attach("signed_document", options.signed ?? pdfWith("declaracion"), { filename: "declaracion.pdf", contentType: "application/pdf" })
    .attach("powers_document", options.powers ?? pdfWith("poderes"), { filename: "poderes.pdf", contentType: "application/pdf" });
}

export function tokenFromEmail(email: { text: string }): string {
  const match = /#token=([0-9a-f]{64})/.exec(email.text);
  if (!match) throw new Error("El correo no trae un link de confirmación");
  return match[1]!;
}

export async function countDeclarations(organizationId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("domain_ownership_declarations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  return count ?? 0;
}

/** Los documentos no caen en cascada con la organización: viven en Storage. */
export async function removeOrganizationDocuments(organizationId: string | undefined): Promise<void> {
  if (!organizationId) return;
  const { data } = await supabaseAdmin
    .from("domain_ownership_declarations")
    .select("signed_document_path, powers_document_path")
    .eq("organization_id", organizationId);
  const paths = (data ?? []).flatMap((row) => [row.signed_document_path, row.powers_document_path]);
  if (paths.length > 0) await removeDeclarationDocuments(paths);
}
