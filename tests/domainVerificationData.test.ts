import { randomUUID } from "node:crypto";
import { api, bearer } from "./helpers/apiClient.js";
import {
  createOrganization,
  createTestUser,
  destroyOrganization,
  destroyTestUser,
  type TestUser,
} from "./helpers/tenants.js";
import { supabaseAdmin, supabaseForUser } from "../src/config/supabase.js";

const HASH = "a".repeat(64);

describe("Parte 1 (V1): datos de la verificación de dominios", () => {
  let orgAId: string;
  let orgBId: string;
  let cisoA: TestUser;
  let auditorA: TestUser;
  let viewerA: TestUser;
  let cisoB: TestUser;
  let pendingAssetId: string;
  let foreignAssetId: string;
  let declarationId: string;
  let itemId: string;

  async function createDomainAsset(user: TestUser, verified = false): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from("assets")
      .insert({
        type: "domain",
        value: `${randomUUID()}.test`,
        organization_id: user.organizationId,
        created_by: user.userId,
        ...(verified ? { verification_status: "verified", verified_at: new Date().toISOString() } : {}),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el activo de test: ${error?.message}`);
    return data.id;
  }

  beforeAll(async () => {
    orgAId = await createOrganization("QA Org A - Verificación");
    orgBId = await createOrganization("QA Org B - Verificación");
    cisoA = await createTestUser(orgAId, "ciso-a-ver", "ciso");
    auditorA = await createTestUser(orgAId, "auditor-a-ver", "auditor");
    viewerA = await createTestUser(orgAId, "viewer-a-ver", "viewer");
    cisoB = await createTestUser(orgBId, "ciso-b-ver", "ciso");

    pendingAssetId = await createDomainAsset(cisoA);
    foreignAssetId = await createDomainAsset(cisoB);

    const { data: declaration, error: declarationError } = await supabaseAdmin
      .from("domain_ownership_declarations")
      .insert({
        organization_id: orgAId,
        submitted_by: cisoA.userId,
        signer_rut: "11111111-1",
        declaration_version: "borrador-1",
        signed_document_path: `${orgAId}/declaracion.pdf`,
        signed_document_sha256: HASH,
        powers_document_path: `${orgAId}/poderes.pdf`,
        powers_document_sha256: HASH,
      })
      .select("id")
      .single();
    if (declarationError || !declaration) throw new Error(`Declaración de test: ${declarationError?.message}`);
    declarationId = declaration.id;

    const { data: item, error: itemError } = await supabaseAdmin
      .from("domain_declaration_items")
      .insert({ organization_id: orgAId, declaration_id: declarationId, asset_id: pendingAssetId })
      .select("id")
      .single();
    if (itemError || !item) throw new Error(`Ítem de test: ${itemError?.message}`);
    itemId = item.id;

    const { error: challengeError } = await supabaseAdmin.from("domain_email_challenges").insert({
      organization_id: orgAId,
      declaration_item_id: itemId,
      issued_to: cisoA.userId,
      token_hash: randomUUID().replace(/-/g, "").repeat(2),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    if (challengeError) throw new Error(`Link de test: ${challengeError.message}`);
  }, 60000);

  afterAll(async () => {
    await Promise.all([cisoA, auditorA, viewerA, cisoB].map(destroyTestUser));
    await Promise.all([destroyOrganization(orgAId), destroyOrganization(orgBId)]);
  }, 60000);

  test("TC-VER-01: el usuario no puede marcar su activo como verificado con su JWT", async () => {
    const { error } = await supabaseForUser(cisoA.accessToken)
      .from("assets")
      .update({ verification_status: "verified", verified_at: new Date().toISOString() })
      .eq("id", pendingAssetId);
    expect(error?.code).toBe("42501");

    const { data } = await supabaseAdmin
      .from("assets")
      .select("verification_status, verified_at")
      .eq("id", pendingAssetId)
      .single();
    expect(data).toEqual({ verification_status: "pending", verified_at: null });
  });

  test("TC-VER-02: el usuario no puede crear un activo ya verificado con su JWT", async () => {
    const value = `${randomUUID()}.test`;
    const { error } = await supabaseForUser(cisoA.accessToken).from("assets").insert({
      type: "domain",
      value,
      organization_id: orgAId,
      created_by: cisoA.userId,
      verification_status: "verified",
    });
    expect(error?.code).toBe("42501");

    const { count } = await supabaseAdmin
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("value", value);
    expect(count).toBe(0);
  });

  test("TC-VER-03: el usuario no puede cambiar el valor de un activo verificado con su JWT", async () => {
    const verifiedAssetId = await createDomainAsset(cisoA, true);
    const { data: before } = await supabaseAdmin.from("assets").select("value").eq("id", verifiedAssetId).single();

    const { error } = await supabaseForUser(cisoA.accessToken)
      .from("assets")
      .update({ value: `${randomUUID()}.test` })
      .eq("id", verifiedAssetId);
    expect(error?.code).toBe("42501");

    const { data: after } = await supabaseAdmin.from("assets").select("value").eq("id", verifiedAssetId).single();
    expect(after?.value).toBe(before?.value);
  });

  test("TC-VER-04: el usuario sigue pudiendo editar los demás campos de su activo", async () => {
    const { error } = await supabaseForUser(cisoA.accessToken)
      .from("assets")
      .update({ tags: ["qa"] })
      .eq("id", pendingAssetId);
    expect(error).toBeNull();
  });

  test("TC-VER-05: POST /assets/:id/verify sigue verificando una IP con rol ciso", async () => {
    const createRes = await api
      .post("/api/v1/assets")
      .set("Authorization", bearer(cisoA.accessToken))
      .send({ type: "ip", value: "203.0.113.30" });
    expect(createRes.status).toBe(201);

    const res = await api
      .post(`/api/v1/assets/${createRes.body.data.id}/verify`)
      .set("Authorization", bearer(cisoA.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.verification_status).toBe("verified");
  });

  test("TC-VER-06: otra organización no ve nada de las tablas de verificación", async () => {
    const supabase = supabaseForUser(cisoB.accessToken);
    for (const table of ["domain_ownership_declarations", "domain_declaration_items", "domain_email_challenges"]) {
      const { data, error } = await supabase.from(table).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  test("TC-VER-07: dentro de la organización, solo el ciso lee declaraciones e ítems", async () => {
    const own = supabaseForUser(cisoA.accessToken);
    const { data: ownDeclarations } = await own.from("domain_ownership_declarations").select("id");
    expect(ownDeclarations?.map((row) => row.id)).toEqual([declarationId]);
    const { data: ownItems } = await own.from("domain_declaration_items").select("id");
    expect(ownItems?.map((row) => row.id)).toEqual([itemId]);

    for (const user of [auditorA, viewerA]) {
      const supabase = supabaseForUser(user.accessToken);
      const { data: declarations } = await supabase.from("domain_ownership_declarations").select("id");
      expect(declarations).toEqual([]);
      const { data: items } = await supabase.from("domain_declaration_items").select("id");
      expect(items).toEqual([]);
    }
  });

  test("TC-VER-08: nadie lee los links de correo con su JWT, ni siquiera el ciso dueño", async () => {
    const { data, error } = await supabaseForUser(cisoA.accessToken).from("domain_email_challenges").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("TC-VER-09: el ciso no puede aprobar ni crear trámites con su JWT", async () => {
    const supabase = supabaseForUser(cisoA.accessToken);

    await supabase.from("domain_declaration_items").update({ status: "approved" }).eq("id", itemId);
    await supabase.from("domain_ownership_declarations").update({ signature_status: "valid" }).eq("id", declarationId);

    const { data: item } = await supabaseAdmin.from("domain_declaration_items").select("status").eq("id", itemId).single();
    expect(item?.status).toBe("pending_email");
    const { data: declaration } = await supabaseAdmin
      .from("domain_ownership_declarations")
      .select("signature_status")
      .eq("id", declarationId)
      .single();
    expect(declaration?.signature_status).toBe("pending");

    const { error: insertError } = await supabase.from("domain_ownership_declarations").insert({
      organization_id: orgAId,
      signer_rut: "11111111-1",
      declaration_version: "borrador-1",
      signed_document_path: "x",
      signed_document_sha256: HASH,
      powers_document_path: "y",
      powers_document_sha256: HASH,
      signature_status: "valid",
    });
    expect(insertError).not.toBeNull();
  });

  test("TC-VER-10: una declaración no puede enlazar un activo de otra organización", async () => {
    const { error } = await supabaseAdmin
      .from("domain_declaration_items")
      .insert({ organization_id: orgAId, declaration_id: declarationId, asset_id: foreignAssetId });
    expect(error?.code).toBe("23503");
  });

  test("TC-VER-11: un dominio no puede tener dos trámites abiertos", async () => {
    const { error } = await supabaseAdmin
      .from("domain_declaration_items")
      .insert({ organization_id: orgAId, declaration_id: declarationId, asset_id: pendingAssetId });
    expect(error?.code).toBe("23505");
  });
});
