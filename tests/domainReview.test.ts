import { createHash, randomBytes } from "node:crypto";
import { jest } from "@jest/globals";
import { api, bearer } from "./helpers/apiClient.js";
import {
  createDomainAsset,
  pdfWith,
  removeOrganizationDocuments,
  SIGNER_RUT,
  ORGANIZATION_RUT,
  startProviderStub,
  submitDeclaration,
  tokenFromEmail,
  uniqueDomain,
  type ProviderStub,
} from "./helpers/domainVerification.js";
import {
  createOrganization,
  createTestUser,
  destroyOrganization,
  destroyTestUser,
  enableMfa,
  type TestUser,
} from "./helpers/tenants.js";
import { env } from "../src/config/env.js";
import { supabaseAdmin } from "../src/config/supabase.js";

describe("Parte 1 (V2): correo y revisión manual", () => {
  let stub: ProviderStub;
  let orgId: string;
  let reviewerOrgId: string;
  let domain: string;
  let ciso: TestUser;
  let sameDomainColleague: TestUser;
  let reviewer: TestUser;

  function confirm(user: TestUser, token: string) {
    return api
      .post("/api/v1/domain-verification/confirm")
      .set("Authorization", bearer(user.accessToken))
      .send({ token });
  }

  function approve(user: TestUser, itemId: string) {
    return api
      .post(`/api/v1/admin/domain-reviews/${itemId}/approve`)
      .set("Authorization", bearer(user.accessToken))
      .send({});
  }

  function reject(user: TestUser, itemId: string, body: object) {
    return api
      .post(`/api/v1/admin/domain-reviews/${itemId}/reject`)
      .set("Authorization", bearer(user.accessToken))
      .send(body);
  }

  async function assetStatus(assetId: string): Promise<string | undefined> {
    const { data } = await supabaseAdmin.from("assets").select("verification_status").eq("id", assetId).single();
    return data?.verification_status;
  }

  beforeAll(async () => {
    stub = await startProviderStub();
    process.env.SIGNATURE_VALIDATOR_URL = stub.signatureUrl;
    process.env.RESEND_API_KEY = "re_test_clave_falsa";
    process.env.EMAIL_FROM = "Aegis <no-reply@aegis.local>";
    process.env.RESEND_API_URL = stub.emailUrl;

    domain = uniqueDomain();
    orgId = await createOrganization("QA Org - Revisión");
    reviewerOrgId = await createOrganization("QA Org Plataforma - Revisión");
    ciso = await createTestUser(orgId, "ciso-rev", "ciso", domain);
    sameDomainColleague = await createTestUser(orgId, "ciso-2-rev", "ciso", domain);
    reviewer = await createTestUser(reviewerOrgId, "admin-rev", "ciso");
    await Promise.all([ciso, sameDomainColleague, reviewer].map(enableMfa));

    const { error } = await supabaseAdmin.from("profiles").update({ is_platform_admin: true }).eq("id", reviewer.userId);
    if (error) throw new Error(`No se pudo marcar al revisor: ${error.message}`);
  }, 60000);

  afterAll(async () => {
    delete process.env.SIGNATURE_VALIDATOR_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_API_URL;
    await stub.close();
    await Promise.all([removeOrganizationDocuments(orgId), removeOrganizationDocuments(reviewerOrgId)]);
    await Promise.all([ciso, sameDomainColleague, reviewer].map(destroyTestUser));
    await Promise.all([destroyOrganization(orgId), destroyOrganization(reviewerOrgId)]);
  }, 60000);

  test("TC-VER-22: firma válida, link de correo y aprobación verifican el dominio", async () => {
    const asset = await createDomainAsset(ciso, domain);
    const signed = pdfWith("declaracion-feliz");

    const declared = await submitDeclaration(ciso, [asset.id], { signed });
    expect(declared.status).toBe(201);
    const [item] = declared.body.data.items;
    expect(item).toMatchObject({ status: "pending_email", email_sent: true, domain });
    expect(await assetStatus(asset.id)).toBe("pending");

    // El correo salió a la cuenta del ciso y la base solo tiene el hash.
    expect(stub.sentEmails).toHaveLength(1);
    expect(stub.sentEmails[0]!.to).toEqual([ciso.email]);
    const token = tokenFromEmail(stub.sentEmails[0]!);
    const { data: challenges } = await supabaseAdmin
      .from("domain_email_challenges")
      .select("token_hash")
      .eq("declaration_item_id", item.id);
    expect(challenges).toEqual([{ token_hash: createHash("sha256").update(token).digest("hex") }]);

    // Los documentos quedan cifrados en Storage.
    const { data: declaration } = await supabaseAdmin
      .from("domain_ownership_declarations")
      .select("signed_document_path, signature_status, signer_rut")
      .eq("id", declared.body.data.id)
      .single();
    expect(declaration).toMatchObject({ signature_status: "valid", signer_rut: SIGNER_RUT });
    const { data: stored } = await supabaseAdmin.storage
      .from(env.DOMAIN_DECLARATION_BUCKET)
      .download(declaration!.signed_document_path);
    expect(Buffer.from(await stored!.arrayBuffer()).includes("%PDF")).toBe(false);

    // Sin confirmar el correo, el trámite no se puede aprobar.
    const tooEarly = await approve(reviewer, item.id);
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe("DECLARATION_ITEM_NOT_IN_REVIEW");

    // Reenviado a otra cuenta, el link no sirve aunque sea del mismo dominio.
    const forwarded = await confirm(sameDomainColleague, token);
    expect(forwarded.status).toBe(410);

    const confirmed = await confirm(ciso, token);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe("pending_review");
    expect(await assetStatus(asset.id)).toBe("pending");

    // Sirve una sola vez.
    const reused = await confirm(ciso, token);
    expect(reused.status).toBe(410);
    expect(reused.body.error.code).toBe("INVALID_OR_EXPIRED_LINK");

    // El revisor ve el trámite y descarga el mismo documento que se firmó.
    const queue = await api.get("/api/v1/admin/domain-reviews").set("Authorization", bearer(reviewer.accessToken));
    expect(queue.status).toBe(200);
    expect(queue.body.data.find((row: { id: string }) => row.id === item.id)).toMatchObject({
      domain,
      signer_rut: SIGNER_RUT,
      organization_rut: ORGANIZATION_RUT,
      review_reason: null,
    });
    const document = await api
      .get(`/api/v1/admin/domain-reviews/${item.id}/documents/signed`)
      .set("Authorization", bearer(reviewer.accessToken))
      .responseType("blob");
    expect(document.status).toBe(200);
    expect(Buffer.compare(document.body as Buffer, signed)).toBe(0);

    const approved = await approve(reviewer, item.id);
    expect(approved.status).toBe(200);
    expect(await assetStatus(asset.id)).toBe("verified");

    const { data: organization } = await supabaseAdmin.from("organizations").select("rut").eq("id", orgId).single();
    expect(organization?.rut).toBe(ORGANIZATION_RUT);
    const { data: logs } = await supabaseAdmin
      .from("audit_logs")
      .select("actor_id")
      .eq("resource_id", asset.id)
      .eq("action", "DOMAIN_VERIFICATION_APPROVED");
    expect(logs).toEqual([{ actor_id: reviewer.userId }]);
  });

  test("TC-VER-23: sin Resend no queda ningún link vivo ni en la base ni en los logs", async () => {
    const secondDomain = uniqueDomain();
    const secondCiso = await createTestUser(orgId, "ciso-3-rev", "ciso", secondDomain);
    await enableMfa(secondCiso);
    const asset = await createDomainAsset(secondCiso, secondDomain);

    const apiKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const logSpy = jest.spyOn(console, "log");
    const errorSpy = jest.spyOn(console, "error");
    try {
      const declared = await submitDeclaration(secondCiso, [asset.id]);
      expect(declared.status).toBe(201);
      const [item] = declared.body.data.items;
      expect(item).toMatchObject({ status: "pending_email", email_sent: false });

      const { count } = await supabaseAdmin
        .from("domain_email_challenges")
        .select("id", { count: "exact", head: true })
        .eq("declaration_item_id", item.id);
      expect(count).toBe(0);

      const resendWithoutKey = await api
        .post(`/api/v1/domain-declarations/items/${item.id}/resend-link`)
        .set("Authorization", bearer(secondCiso.accessToken));
      expect(resendWithoutKey.status).toBe(503);
      expect(resendWithoutKey.body.error.code).toBe("EMAIL_NOT_AVAILABLE");

      const printed = JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls]);
      expect(printed).not.toContain("#token=");
      expect(printed).not.toContain("verify-domain");

      // Con la clave, el reenvío emite un link nuevo que deja sin efecto al anterior.
      process.env.RESEND_API_KEY = apiKey;
      const sentBefore = stub.sentEmails.length;
      for (const _ of [1, 2]) {
        const resend = await api
          .post(`/api/v1/domain-declarations/items/${item.id}/resend-link`)
          .set("Authorization", bearer(secondCiso.accessToken));
        expect(resend.status).toBe(200);
      }
      expect(stub.sentEmails).toHaveLength(sentBefore + 2);
      const firstToken = tokenFromEmail(stub.sentEmails[sentBefore]!);
      expect((await confirm(secondCiso, firstToken)).status).toBe(410);

      // Un link vencido tampoco sirve.
      const expiredToken = randomBytes(32).toString("hex");
      const { error: challengeError } = await supabaseAdmin.from("domain_email_challenges").insert({
        organization_id: orgId,
        declaration_item_id: item.id,
        issued_to: secondCiso.userId,
        token_hash: createHash("sha256").update(expiredToken).digest("hex"),
        created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
        expires_at: new Date(Date.now() - 3600_000).toISOString(),
      });
      expect(challengeError).toBeNull();
      expect((await confirm(secondCiso, expiredToken)).status).toBe(410);
    } finally {
      process.env.RESEND_API_KEY = apiKey;
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await destroyTestUser(secondCiso);
    }
  });

  test("TC-VER-24: con correo de otro dominio pasa a revisión y se puede rechazar", async () => {
    const assetToReject = await createDomainAsset(ciso);
    const assetAfterPowers = await createDomainAsset(ciso);

    const declared = await submitDeclaration(ciso, [assetToReject.id, assetAfterPowers.id]);
    expect(declared.status).toBe(201);
    for (const item of declared.body.data.items) {
      expect(item).toMatchObject({ status: "pending_review", review_reason: "email_domain_mismatch", email_sent: false });
    }
    const itemFor = (assetId: string) =>
      declared.body.data.items.find((item: { asset_id: string }) => item.asset_id === assetId).id as string;

    const withoutReason = await reject(reviewer, itemFor(assetToReject.id), { notes: "corto" });
    expect(withoutReason.status).toBe(400);

    const rejected = await reject(reviewer, itemFor(assetToReject.id), {
      notes: "El certificado de poderes está vencido",
      powers_invalid: true,
    });
    expect(rejected.status).toBe(200);
    expect(await assetStatus(assetToReject.id)).toBe("pending");

    // Los poderes rechazados frenan a los demás dominios de esa declaración.
    const blocked = await approve(reviewer, itemFor(assetAfterPowers.id));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("POWERS_REJECTED");
    expect(await assetStatus(assetAfterPowers.id)).toBe("pending");
  });

  test("TC-VER-25: la revisión es solo para admins y no de la propia organización", async () => {
    const asset = await createDomainAsset(reviewer);
    const declared = await submitDeclaration(reviewer, [asset.id]);
    expect(declared.status).toBe(201);
    const itemId = declared.body.data.items[0].id as string;

    const notAdmin = await api.get("/api/v1/admin/domain-reviews").set("Authorization", bearer(ciso.accessToken));
    expect(notAdmin.status).toBe(403);
    const notAdminDocument = await api
      .get(`/api/v1/admin/domain-reviews/${itemId}/documents/powers`)
      .set("Authorization", bearer(ciso.accessToken));
    expect(notAdminDocument.status).toBe(403);
    expect((await approve(ciso, itemId)).status).toBe(403);

    const ownOrganization = await approve(reviewer, itemId);
    expect(ownOrganization.status).toBe(403);
    expect(ownOrganization.body.error.code).toBe("REVIEWER_CONFLICT");
    expect(await assetStatus(asset.id)).toBe("pending");
  });

  test("TC-VER-26: el ciso ve sus trámites, sin rutas de documentos, y no los de otros", async () => {
    const own = await api.get("/api/v1/domain-declarations").set("Authorization", bearer(reviewer.accessToken));
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveLength(1);
    expect(JSON.stringify(own.body.data)).not.toContain("document_path");
    expect(own.body.data[0].domain_declaration_items[0].assets.value).toBeDefined();
  });
});
