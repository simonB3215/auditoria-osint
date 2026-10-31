import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../src/config/supabase.js";
import { env } from "../../src/config/env.js";

export type TestRole = "ciso" | "auditor" | "viewer";

export interface TestUser {
  userId: string;
  organizationId: string;
  email: string;
  accessToken: string;
  role: TestRole;
}

function uniqueEmail(prefix: string, domain: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${domain}`;
}

export async function createOrganization(name: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .insert({ name })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`No se pudo crear la organización de test '${name}': ${error?.message}`);
  }
  return data.id;
}

/**
 * Crea un usuario de Supabase Auth + su profile de aplicación, y devuelve
 * un access_token real obtenido por login (no un JWT simulado), para
 * ejercitar exactamente el mismo camino que authenticateToken valida en
 * producción.
 */
export async function createTestUser(
  organizationId: string,
  emailPrefix: string,
  role: TestRole,
  emailDomain = "test.aegis.local"
): Promise<TestUser> {
  const email = uniqueEmail(emailPrefix, emailDomain);
  const password = "TestPass123!Secure";

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`No se pudo crear el usuario de test '${email}': ${userError?.message}`);
  }

  const { error: profileError } = await supabaseAdmin.from("profiles").insert({
    id: userData.user.id,
    organization_id: organizationId,
    role,
    full_name: emailPrefix,
  });
  if (profileError) {
    throw new Error(`No se pudo crear el profile de test para '${email}': ${profileError.message}`);
  }

  const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.session) {
    throw new Error(`No se pudo loguear al usuario de test '${email}': ${signInError?.message}`);
  }

  return {
    userId: userData.user.id,
    organizationId,
    email,
    accessToken: signInData.session.access_token,
    role,
  };
}

/**
 * Borra el usuario de Auth; `profiles` cae en cascada (FK on delete cascade).
 * Acepta `undefined` a propósito: si `beforeAll` falla antes de crear el
 * usuario, `afterAll` igual se ejecuta con la variable sin asignar — esto
 * evita que la limpieza tape el error real con un TypeError secundario.
 */
export async function destroyTestUser(user: TestUser | undefined): Promise<void> {
  if (!user) return;
  await supabaseAdmin.auth.admin.deleteUser(user.userId);
}

/** Borra la organización; assets/audits/findings/reports caen en cascada. */
export async function destroyOrganization(organizationId: string | undefined): Promise<void> {
  if (!organizationId) return;
  await supabaseAdmin.from("organizations").delete().eq("id", organizationId);
}

function totpCode(base32Secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...base32Secret.replace(/=+$/, "")]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/**
 * Activa TOTP real en Supabase Auth y deja en `user.accessToken` la sesión
 * con segundo factor (aal2), igual que después de pasar la pantalla de 2FA.
 */
export async function enableMfa(user: TestUser): Promise<void> {
  async function call<T>(path: string, body: object, accessToken: string): Promise<T> {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/factors${path}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`MFA de test falló en '${path}': ${await res.text()}`);
    return (await res.json()) as T;
  }

  const factor = await call<{ id: string; totp: { secret: string } }>(
    "",
    { factor_type: "totp", friendly_name: "qa" },
    user.accessToken
  );
  const challenge = await call<{ id: string }>(`/${factor.id}/challenge`, {}, user.accessToken);
  const verified = await call<{ access_token: string }>(
    `/${factor.id}/verify`,
    { challenge_id: challenge.id, code: totpCode(factor.totp.secret) },
    user.accessToken
  );
  user.accessToken = verified.access_token;
}
