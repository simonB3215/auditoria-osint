import { randomUUID } from "node:crypto";
import { api, bearer } from "./helpers/apiClient.js";
import {
  createDomainAsset,
  countDeclarations,
  OTHER_RUT,
  pdfWith,
  removeOrganizationDocuments,
  startProviderStub,
  submitDeclaration,
  uniqueDomain,
  type ProviderStub,
} from "./helpers/domainVerification.js";
import { fakeExeDisguisedAsPdf } from "./helpers/fixtures.js";
import {
  createOrganization,
  createTestUser,
  destroyOrganization,
  destroyTestUser,
  type TestUser,
} from "./helpers/tenants.js";
import { supabaseAdmin } from "../src/config/supabase.js";
import {
  checkDeclarantEmail,
  emailMatchesDomain,
  isSensitiveDomain,
  isValidRut,
  normalizeRut,
  routeDeclaredDomain,
} from "../src/services/domainVerificationRules.js";

describe("Parte 1 (V2): rechazos al declarar un dominio", () => {
  let stub: ProviderStub;
  let orgId: string;
  let otherOrgId: string;
  let freeOrgId: string;
  let ciso: TestUser;
  let auditor: TestUser;
  let otherCiso: TestUser;
  let freeEmailCiso: TestUser;
  let assetId: string;

  async function blockedCodes(organizationId: string): Promise<string[]> {
    const { data } = await supabaseAdmin
      .from("audit_logs")
      .select("payload_after")
      .eq("organization_id", organizationId)
      .eq("action", "DOMAIN_DECLARATION_BLOCKED");
    return (data ?? []).map((row) => (row.payload_after as { code: string }).code);
  }

  beforeAll(async () => {
    stub = await startProviderStub();
    process.env.SIGNATURE_VALIDATOR_URL = stub.signatureUrl;

    const domain = uniqueDomain();
    orgId = await createOrganization("QA Org - Declaración");
    otherOrgId = await createOrganization("QA Org B - Declaración");
    freeOrgId = await createOrganization("QA Org C - Declaración");
    ciso = await createTestUser(orgId, "ciso-dec", "ciso", domain);
    auditor = await createTestUser(orgId, "auditor-dec", "auditor", domain);
    otherCiso = await createTestUser(otherOrgId, "ciso-b-dec", "ciso");
    freeEmailCiso = await createTestUser(freeOrgId, "ciso-c-dec", "ciso", "gmail.com");
    assetId = (await createDomainAsset(ciso, domain)).id;
  }, 60000);

  afterAll(async () => {
    delete process.env.SIGNATURE_VALIDATOR_URL;
    await stub.close();
    await removeOrganizationDocuments(otherOrgId);
    await Promise.all([ciso, auditor, otherCiso, freeEmailCiso].map(destroyTestUser));
    await Promise.all([orgId, otherOrgId, freeOrgId].map(destroyOrganization));
  }, 60000);

  test("TC-VER-12: reglas de RUT, correo y dominio", () => {
    expect(normalizeRut(" 11.111.111-k ")).toBe("11111111-K");
    expect(isValidRut("11111111-1")).toBe(true);
    expect(isValidRut("11111111-2")).toBe(false);
    expect(isValidRut("no-es-rut")).toBe(false);

    expect(emailMatchesDomain("ana@Empresa.cl", "empresa.cl")).toBe(true);
    expect(emailMatchesDomain("ana@mail.empresa.cl", "empresa.cl")).toBe(false);
    expect(emailMatchesDomain("ana@empresa.cl.evil.com", "empresa.cl")).toBe(false);

    expect(checkDeclarantEmail("ana@empresa.cl", null)).toBe("EMAIL_NOT_CONFIRMED");
    expect(checkDeclarantEmail("ana@gmail.com", "2026-01-01")).toBe("FREE_EMAIL_NOT_ALLOWED");
    expect(checkDeclarantEmail("ana@empresa.cl", "2026-01-01")).toBeNull();

    expect(isSensitiveDomain("sii.gob.cl")).toBe(true);
    expect(isSensitiveDomain("notgob.cl")).toBe(false);

    expect(routeDeclaredDomain("ana@empresa.cl", "empresa.cl")).toEqual({ status: "pending_email", reviewReason: null });
    expect(routeDeclaredDomain("ana@otra.cl", "empresa.cl")).toEqual({
      status: "pending_review",
      reviewReason: "email_domain_mismatch",
    });
    expect(routeDeclaredDomain("ana@sii.gob.cl", "sii.gob.cl")).toEqual({
      status: "pending_email",
      reviewReason: "sensitive_domain",
    });
  });

  test("TC-VER-13: sin proveedor de firma configurado no se acepta ninguna declaración", async () => {
    const url = process.env.SIGNATURE_VALIDATOR_URL;
    delete process.env.SIGNATURE_VALIDATOR_URL;
    try {
      const res = await submitDeclaration(ciso, [assetId]);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("SIGNATURE_PROVIDER_NOT_CONFIGURED");
    } finally {
      process.env.SIGNATURE_VALIDATOR_URL = url;
    }
    expect(await blockedCodes(orgId)).toContain("SIGNATURE_PROVIDER_NOT_CONFIGURED");
    expect(await countDeclarations(orgId)).toBe(0);
  });

  test("TC-VER-14: un activo ajeno y uno inexistente reciben la misma respuesta", async () => {
    const foreign = await submitDeclaration(otherCiso, [assetId]);
    const missing = await submitDeclaration(otherCiso, [randomUUID()]);

    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("UNAUTHORIZED_DECLARATION_TARGET");
    expect(missing.status).toBe(403);
    expect(missing.body).toEqual(foreign.body);
    expect((await blockedCodes(otherOrgId)).filter((code) => code === "UNAUTHORIZED_DECLARATION_TARGET")).toHaveLength(2);
  });

  test("TC-VER-15: solo el ciso puede declarar", async () => {
    const res = await submitDeclaration(auditor, [assetId]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("TC-VER-16: un correo gratuito no puede declarar dominios", async () => {
    const asset = await createDomainAsset(freeEmailCiso);
    const res = await submitDeclaration(freeEmailCiso, [asset.id]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("FREE_EMAIL_NOT_ALLOWED");
    expect(await countDeclarations(freeOrgId)).toBe(0);
  });

  test("TC-VER-17: firma rechazada, no avanzada o de otro RUT no pasan", async () => {
    const rejected = await submitDeclaration(ciso, [assetId], { signed: pdfWith("FIRMA-RECHAZADA") });
    const simple = await submitDeclaration(ciso, [assetId], { signed: pdfWith("FIRMA-SIMPLE") });
    const otherSigner = await submitDeclaration(ciso, [assetId], { signerRut: OTHER_RUT });

    for (const res of [rejected, simple, otherSigner]) {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("INVALID_SIGNATURE");
    }
    expect(await countDeclarations(orgId)).toBe(0);
  });

  test("TC-VER-18: un archivo que no es PDF se rechaza aunque diga serlo", async () => {
    const res = await submitDeclaration(ciso, [assetId], { powers: fakeExeDisguisedAsPdf });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("DOCUMENT_MUST_BE_PDF");
  });

  test("TC-VER-19: si el proveedor de firma no responde, tampoco se acepta", async () => {
    const url = process.env.SIGNATURE_VALIDATOR_URL;
    process.env.SIGNATURE_VALIDATOR_URL = "http://127.0.0.1:1/signature";
    try {
      const res = await submitDeclaration(ciso, [assetId]);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("SIGNATURE_PROVIDER_UNAVAILABLE");
    } finally {
      process.env.SIGNATURE_VALIDATOR_URL = url;
    }
    expect(await countDeclarations(orgId)).toBe(0);
  });

  test("TC-VER-20: no se acepta un RUT distinto al ya aprobado para la organización", async () => {
    const { error } = await supabaseAdmin.from("organizations").update({ rut: OTHER_RUT }).eq("id", orgId);
    expect(error).toBeNull();

    const res = await submitDeclaration(ciso, [assetId]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORGANIZATION_RUT_MISMATCH");
  });

  test("TC-VER-21: un RUT inválido se rechaza antes de hacer nada", async () => {
    const res = await submitDeclaration(ciso, [assetId], { signerRut: "11111111-2" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("TC-VER-27: un trámite abierto bloquea otra declaración del mismo dominio", async () => {
    const asset = await createDomainAsset(otherCiso);
    const first = await submitDeclaration(otherCiso, [asset.id]);
    expect(first.status).toBe(201);

    const second = await submitDeclaration(otherCiso, [asset.id]);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("DOMAIN_DECLARATION_ALREADY_OPEN");
    expect(await countDeclarations(otherOrgId)).toBe(1);
  });

  test("TC-VER-28: el flujo TXT ya no existe", async () => {
    const verify = await api.post(`/api/v1/assets/${assetId}/verify`).set("Authorization", bearer(ciso.accessToken));
    expect(verify.status).toBe(422);
    expect(verify.body.error.code).toBe("DOMAIN_REQUIRES_DECLARATION");
    const { data: asset } = await supabaseAdmin.from("assets").select("verification_status").eq("id", assetId).single();
    expect(asset?.verification_status).toBe("pending");

    const delegate = await api
      .post(`/api/v1/assets/${assetId}/delegate-verification`)
      .set("Authorization", bearer(ciso.accessToken))
      .send({ email: "ti@example.com" });
    expect(delegate.status).toBe(404);

    const read = await api.get(`/api/v1/assets/${assetId}`).set("Authorization", bearer(ciso.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data).not.toHaveProperty("verification_token");
  });
});
