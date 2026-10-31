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
