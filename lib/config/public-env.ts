import { describeIssues, validatePublicEnv, type PublicEnv } from "@/lib/config/env.schema";

/**
 * Client-safe environment (task T007). Only `NEXT_PUBLIC_*` values live here; Next.js
 * inlines them at build time, which is why each one is referenced explicitly.
 * Values are validated lazily so a missing Clerk key (before T195 is completed) does
 * not break unrelated pages; call sites that need Clerk should check `isClerkConfigured()`.
 */
let cached: PublicEnv | undefined;

const rawPublicEnv = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
};

export function getPublicEnv(): PublicEnv {
  if (cached) return cached;
  const result = validatePublicEnv(rawPublicEnv);
  if (!result.ok) {
    throw new Error(`Invalid public environment configuration:\n${describeIssues(result.issues)}`);
  }
  cached = result.value;
  return cached;
}

export const publicEnv: PublicEnv = new Proxy({} as PublicEnv, {
  get(_target, property) {
    return getPublicEnv()[property as keyof PublicEnv];
  },
});

/** True once the Clerk publishable key is present (Phase 1 checklist T195). */
export function isClerkConfigured(): boolean {
  return Boolean(rawPublicEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
