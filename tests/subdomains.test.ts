import { api, bearer } from "./helpers/apiClient.js";
import { startDnsStub, type DnsStub } from "./helpers/dnsStub.js";
import { uniqueDomain } from "./helpers/domainVerification.js";
import {
  createOrganization,
  createTestUser,
  destroyOrganization,
  destroyTestUser,
  enableMfa,
  type TestUser,
} from "./helpers/tenants.js";
import { env } from "../src/config/env.js";
import { supabaseAdmin, supabaseForUser } from "../src/config/supabase.js";
import { checkSubdomainScope, isSubdomainOf } from "../src/services/subdomainScope.js";

describe("Parte 1 (V5): subdominios desde el dominio padre", () => {
  let dns: DnsStub;
  let orgId: string;
  let otherOrgId: string;
  let ciso: TestUser;
  let cisoWithoutMfa: TestUser;
  let auditor: TestUser;
  let otherCiso: TestUser;
  let parent: string;
  let parentId: string;
  const cnames = new Map<string, string>();
  const nxdomain = new Set<string>();

  function createAsset(user: TestUser, value: string) {
    return api.post("/api/v1/assets").set("Authorization", bearer(user.accessToken)).send({ type: "domain", value });
  }

  function enable(user: TestUser, assetId: string) {
    return api.post(`/api/v1/assets/${assetId}/enable-from-parent`).set("Authorization", bearer(user.accessToken));
  }

  async function status(assetId: string) {
    const { data } = await supabaseAdmin
      .from("assets")
      .select("verification_status, parent_asset_id")
      .eq("id", assetId)
      .single();
    return data;
  }

  beforeAll(async () => {
    parent = uniqueDomain();
    cnames.set(`www.${parent}`, `app.${parent}`);
    cnames.set(`shop.${parent}`, "tienda.saas.example");
    cnames.set(`mixto.${parent}`, `shop.${parent}`);
    nxdomain.add(`nada.${parent}`);

    dns = await startDnsStub({ cname: cnames, nxdomain });
    process.env.DNS_RESOLVER_SERVER = dns.server;

    orgId = await createOrganization("QA Org - Subdominios");
    otherOrgId = await createOrganization("QA Org B - Subdominios");
    ciso = await createTestUser(orgId, "ciso-sub", "ciso");
    cisoWithoutMfa = await createTestUser(orgId, "ciso-sub-sin-mfa", "ciso");
    auditor = await createTestUser(orgId, "auditor-sub", "auditor");
    otherCiso = await createTestUser(otherOrgId, "ciso-b-sub", "ciso");
    await Promise.all([ciso, otherCiso].map(enableMfa));

    const { data, error } = await supabaseAdmin
      .from("assets")
      .insert({
        type: "domain",
        value: parent,
        organization_id: orgId,
        created_by: ciso.userId,
        verification_status: "verified",
        verified_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el dominio padre: ${error?.message}`);
    parentId = data.id;
  }, 60000);

  afterAll(async () => {
    delete process.env.DNS_RESOLVER_SERVER;
    dns.close();
    await Promise.all([ciso, cisoWithoutMfa, auditor, otherCiso].map(destroyTestUser));
    await Promise.all([destroyOrganization(orgId), destroyOrganization(otherOrgId)]);
  }, 60000);

  test("TC-VER-30: reconoce un subdominio sin confundirlo con un dominio parecido", () => {
    expect(isSubdomainOf("app.empresa.cl", "empresa.cl")).toBe(true);
    expect(isSubdomainOf("APP.Empresa.cl.", "empresa.cl")).toBe(true);
    expect(isSubdomainOf("empresa.cl", "empresa.cl")).toBe(false);
    expect(isSubdomainOf("otraempresa.cl", "empresa.cl")).toBe(false);
    expect(isSubdomainOf("empresa.cl.evil.com", "empresa.cl")).toBe(false);
  });

  test("TC-VER-31: la resolución sigue la cadena de CNAME y falla cerrada", async () => {
    await expect(checkSubdomainScope(`api.${parent}`, parent)).resolves.toEqual({ ok: true });
    await expect(checkSubdomainScope(`www.${parent}`, parent)).resolves.toEqual({ ok: true });
    await expect(checkSubdomainScope(`shop.${parent}`, parent)).resolves.toEqual({
      ok: false,
      reason: "third_party_cname",
      target: "tienda.saas.example",
    });
    // El primer salto es propio, pero la cadena termina en un tercero.
    await expect(checkSubdomainScope(`mixto.${parent}`, parent)).resolves.toMatchObject({
      reason: "third_party_cname",
    });
    await expect(checkSubdomainScope(`nada.${parent}`, parent)).resolves.toEqual({ ok: false, reason: "not_found" });

    const server = process.env.DNS_RESOLVER_SERVER;
    process.env.DNS_RESOLVER_SERVER = "127.0.0.1:1";
    try {
      await expect(checkSubdomainScope(`api.${parent}`, parent)).resolves.toEqual({
        ok: false,
        reason: "dns_unavailable",
      });
    } finally {
      process.env.DNS_RESOLVER_SERVER = server;
    }
  }, 60000);

  test("TC-VER-32: un subdominio sin CNAME de terceros se habilita desde el padre", async () => {
    const created = await createAsset(ciso, `api.${parent}`);
    expect(created.status).toBe(201);
    expect(created.body.data.parent_asset_id).toBe(parentId);
    expect(created.body.data.verification_status).toBe("pending");

    const enabled = await enable(ciso, created.body.data.id);
    expect(enabled.status).toBe(200);
    expect(await status(created.body.data.id)).toEqual({ verification_status: "verified", parent_asset_id: parentId });

    const { data: logs } = await supabaseAdmin
      .from("audit_logs")
      .select("actor_id")
      .eq("resource_id", created.body.data.id)
      .eq("action", "SUBDOMAIN_ENABLED");
    expect(logs).toEqual([{ actor_id: ciso.userId }]);
  });

  test("TC-VER-33: un CNAME hacia un tercero o un nombre inexistente no se habilitan", async () => {
    const shop = await createAsset(ciso, `shop.${parent}`);
    const thirdParty = await enable(ciso, shop.body.data.id);
    expect(thirdParty.status).toBe(422);
    expect(thirdParty.body.error.code).toBe("SUBDOMAIN_THIRD_PARTY_CNAME");
    expect((await status(shop.body.data.id))?.verification_status).toBe("pending");

    const { data: logs } = await supabaseAdmin
      .from("audit_logs")
      .select("id")
      .eq("resource_id", shop.body.data.id)
      .eq("action", "SUBDOMAIN_ENABLE_BLOCKED");
    expect(logs).toHaveLength(1);

    const missing = await createAsset(ciso, `nada.${parent}`);
    const notFound = await enable(ciso, missing.body.data.id);
    expect(notFound.status).toBe(422);
    expect(notFound.body.error.code).toBe("SUBDOMAIN_NOT_FOUND");
  });

  test("TC-VER-34: habilitar exige ciso con 2FA, de la misma organización y bajo un padre verificado", async () => {
    const created = await createAsset(ciso, `permisos.${parent}`);
    const assetId = created.body.data.id as string;

    expect((await enable(auditor, assetId)).body.error.code).toBe("FORBIDDEN");
    expect((await enable(cisoWithoutMfa, assetId)).body.error.code).toBe("MFA_REQUIRED");
    expect((await enable(otherCiso, assetId)).status).toBe(404);

    const unrelated = await createAsset(ciso, uniqueDomain());
    const noParent = await enable(ciso, unrelated.body.data.id);
    expect(noParent.status).toBe(422);
    expect(noParent.body.error.code).toBe("NO_VERIFIED_PARENT");

    // Otra organización no hereda de un padre ajeno.
    const foreign = await createAsset(otherCiso, `ajeno.${parent}`);
    expect(foreign.status).toBe(201);
    expect(foreign.body.data.parent_asset_id).toBeNull();
    expect((await enable(otherCiso, foreign.body.data.id)).body.error.code).toBe("NO_VERIFIED_PARENT");

    // Con su JWT, un usuario no puede colgarse de un padre.
    const { error } = await supabaseForUser(ciso.accessToken)
      .from("assets")
      .update({ parent_asset_id: parentId })
      .eq("id", unrelated.body.data.id);
    expect(error?.code).toBe("42501");
  });

  test("TC-VER-35: los subdominios no gastan el límite de activos y tienen el suyo", async () => {
    const orgLimitId = await createOrganization("QA Org C - Límites");
    const owner = await createTestUser(orgLimitId, "ciso-limite", "ciso");
    try {
      const limitParent = uniqueDomain();
      await supabaseAdmin.from("assets").insert({
        type: "domain",
        value: limitParent,
        organization_id: orgLimitId,
        created_by: owner.userId,
        verification_status: "verified",
      });

      const fill = (count: number, build: (i: number) => string) =>
        Array.from({ length: count }, (_, i) => ({
          type: "domain",
          value: build(i),
          organization_id: orgLimitId,
          created_by: owner.userId,
        }));

      // Activos normales hasta el tope: el padre ya cuenta como uno.
      await supabaseAdmin.from("assets").insert(fill(env.MAX_ASSETS_PER_ORG - 1, () => uniqueDomain()));
      const overLimit = await createAsset(owner, uniqueDomain());
      expect(overLimit.status).toBe(403);
      expect(overLimit.body.error.code).toBe("ASSET_LIMIT_REACHED");

      const sub = await createAsset(owner, `primero.${limitParent}`);
      expect(sub.status).toBe(201);

      const { data: parentRow } = await supabaseAdmin.from("assets").select("id").eq("value", limitParent).single();
      await supabaseAdmin
        .from("assets")
        .insert(
          fill(env.MAX_SUBDOMAIN_ASSETS_PER_ORG - 1, (i) => `s${i}.${limitParent}`).map((row) => ({
            ...row,
            parent_asset_id: parentRow!.id,
          }))
        );
      const overSubLimit = await createAsset(owner, `ultimo.${limitParent}`);
      expect(overSubLimit.status).toBe(403);
      expect(overSubLimit.body.error.code).toBe("SUBDOMAIN_LIMIT_REACHED");
    } finally {
      await destroyTestUser(owner);
      await destroyOrganization(orgLimitId);
    }
  });

  test("TC-VER-36: un escaneo respeta el tope y exige un padre verificado", async () => {
    const orgScanId = await createOrganization("QA Org D - Escaneo");
    const owner = await createTestUser(orgScanId, "ciso-escaneo", "ciso");
    try {
      const scanParent = uniqueDomain();
      const { data: parentRow } = await supabaseAdmin
        .from("assets")
        .insert({
          type: "domain",
          value: scanParent,
          organization_id: orgScanId,
          created_by: owner.userId,
          verification_status: "verified",
        })
        .select("id")
        .single();
      const { data: subs } = await supabaseAdmin
        .from("assets")
        .insert(
          Array.from({ length: env.MAX_ASSETS_PER_SCAN }, (_, i) => ({
            type: "domain",
            value: `e${i}.${scanParent}`,
            organization_id: orgScanId,
            created_by: owner.userId,
            verification_status: "verified",
            parent_asset_id: parentRow!.id,
          }))
        )
        .select("id");

      const audit = await api
        .post("/api/v1/audits")
        .set("Authorization", bearer(owner.accessToken))
        .send({ title: "Tope de escaneo", framework: "iso27001" });
      const runScan = (body: object) =>
        api.post(`/api/v1/audits/${audit.body.data.id}/run-scan`).set("Authorization", bearer(owner.accessToken)).send(body);

      // Sin elegir activos, supera el tope por uno.
      const tooMany = await runScan({});
      expect(tooMany.status).toBe(422);
      expect(tooMany.body.error.code).toBe("TOO_MANY_ASSETS_PER_SCAN");

      // Los subdominios dejan de valer si su padre pierde la verificación.
      await supabaseAdmin.from("assets").update({ verification_status: "pending" }).eq("id", parentRow!.id);
      const orphaned = await runScan({ asset_ids: [subs![0]!.id] });
      expect(orphaned.status).toBe(403);
      expect(orphaned.body.error.code).toBe("UNAUTHORIZED_SCAN_TARGET");
    } finally {
      await destroyTestUser(owner);
      await destroyOrganization(orgScanId);
    }
  });

  test("TC-VER-37: borrar el dominio padre borra sus subdominios", async () => {
    const created = await createAsset(ciso, `cascada.${parent}`);
    expect(created.status).toBe(201);

    const { error } = await supabaseAdmin.from("assets").delete().eq("id", parentId);
    expect(error).toBeNull();

    const { count } = await supabaseAdmin
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("parent_asset_id", parentId);
    expect(count).toBe(0);
  });
});
