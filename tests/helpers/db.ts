import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { mintLocalJwt } from "./jwt";

/**
 * Database helpers for integration tests (task T015) against the LOCAL Supabase
 * stack only (`pnpm db:start`). Values come from the environment printed by
 * `supabase status`; the defaults below are the CLI's documented local defaults.
 *
 * The user-scoped client mirrors `createUserClient()` (T028): publishable key plus a
 * Clerk-shaped JWT as the access token, so RLS, column grants and guarded functions
 * are exercised exactly as in the application. The service client mirrors
 * `createServiceClient()` and bypasses RLS — use it only to arrange/inspect data.
 */
export const LOCAL_SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";

const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";

export function hasLocalStackConfig(): boolean {
  return Boolean(publishableKey && secretKey) && /127\.0\.0\.1|localhost/.test(LOCAL_SUPABASE_URL);
}

/** Resolves true when the local Supabase API answers (used to skip DB suites gracefully). */
export async function isLocalStackAvailable(): Promise<boolean> {
  if (!hasLocalStackConfig()) return false;
  try {
    const response = await fetch(`${LOCAL_SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(2000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function createUserScopedClient(clerkUserId: string): Promise<SupabaseClient> {
  const token = await mintLocalJwt({ sub: clerkUserId });
  return createClient(LOCAL_SUPABASE_URL, publishableKey, {
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createServiceScopedClient(): SupabaseClient {
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is required for the service client");
  return createClient(LOCAL_SUPABASE_URL, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Returns the id of a test user, creating it on first use.
 *
 * Test users are reused rather than deleted and re-created: the audit log is
 * append-only and references its actors, so a user that has done anything
 * auditable cannot (and must not) be deleted.
 */
export async function ensureTestUser(
  service: SupabaseClient,
  clerkUserId: string,
  name = clerkUserId,
): Promise<string> {
  const { data, error } = await service
    .from("users")
    .upsert(
      { clerk_user_id: clerkUserId, email: `${clerkUserId}@example.com`, name },
      { onConflict: "clerk_user_id" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * Per-test data reset. The LegacyVault schema does not exist yet (T018/T218/T019);
 * once it does, this truncates the domain tables through the service client.
 */
export async function resetTestData(_client: SupabaseClient): Promise<void> {
  throw new Error(
    "resetTestData() is not available until the schema migrations (T018) exist — call it from T212/T215 onwards.",
  );
}
