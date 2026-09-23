import "server-only";

import { auth } from "@clerk/nextjs/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getEnvGroup } from "@/lib/config/env";
import { getPublicEnv } from "@/lib/config/public-env";
import type { Database } from "@/lib/types/database";

/**
 * Server-side Supabase clients (task T028, ADR-004 r2 § 3).
 *
 * There are exactly two, and choosing between them is a security decision:
 *
 * `createUserClient()` — publishable key plus the caller's Clerk session token.
 *   Supabase is registered with Clerk as a third-party auth provider, so
 *   `auth.jwt() ->> 'sub'` inside a policy is the Clerk subject and RLS, the
 *   column allow-lists and the guarded `SECURITY DEFINER` functions all apply.
 *   Use it for every read of the caller's own data, every Class A write and
 *   every `rpc()` call to a guarded function. It is the default.
 *
 * `createServiceClient()` — the Supabase secret key. It bypasses RLS entirely,
 *   so it is allowed ONLY on the system paths listed in ADR-004:
 *     • Clerk and email webhooks (no session exists)
 *     • cron / job handlers
 *     • audit-log writes
 *     • Super Admin operations (after an explicit role check)
 *     • token-based beneficiary / emergency access (no Clerk session)
 *     • upload promotion
 *   Every one of those paths must perform its own ownership/role check in code
 *   first. RLS is the second barrier, never the only one — if a query fails
 *   because authorization is working, fix the service, do not reach for this
 *   client.
 *
 * Neither client is ever constructed in the browser: the secret key is
 * server-only and this module is marked `server-only`.
 */
export type TypedSupabaseClient = SupabaseClient<Database>;

const NO_PERSIST = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/**
 * RLS-enforcing client bound to the current Clerk session.
 *
 * `getToken()` is called per request by supabase-js, so a refreshed session is
 * picked up without rebuilding the client. When there is no session the token
 * is null and the request arrives as `anon`, which has no grants and no
 * policies anywhere — it can read nothing.
 */
export async function createUserClient(): Promise<TypedSupabaseClient> {
  const { getToken } = await auth();
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = getPublicEnv();

  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    ...NO_PERSIST,
    accessToken: async () => (await getToken()) ?? null,
  });
}

/**
 * Same RLS-enforcing client, but for a token that the caller already holds
 * (job handlers acting for a user, tests minting Clerk-shaped claims).
 */
export function createUserClientWithToken(accessToken: string): TypedSupabaseClient {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = getPublicEnv();
  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    ...NO_PERSIST,
    accessToken: async () => accessToken,
  });
}

/** RLS-bypassing client. Read the allow-list in this file's header before using it. */
export function createServiceClient(): TypedSupabaseClient {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = getEnvGroup("database");
  return createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, NO_PERSIST);
}
