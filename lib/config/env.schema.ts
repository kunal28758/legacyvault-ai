import { z } from "zod";

/**
 * Environment schema for LegacyVault AI (task T007, constitution I / XXI, ADR-015).
 *
 * This module is dependency-free (no `server-only`) so it can be unit-tested and
 * used by `scripts/check-env.ts`. Application code must import the validated
 * values from `lib/config/env.ts` (server) or `lib/config/public-env.ts` (client).
 */

const KEY_BYTES = 32;

/** `<keyId>:<base64 of 32 random bytes>` — e.g. `k1:...`. The keyId is stored with
 *  every ciphertext so `ENCRYPTION_KEY_PREVIOUS` can be dual-read during rotation (T020/T240). */
export const versionedKey = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9+/=]+$/, "expected <keyId>:<base64>")
  .refine((value) => decodeKeyBytes(value.split(":")[1]) === KEY_BYTES, {
    message: `key material must decode to exactly ${KEY_BYTES} bytes`,
  })
  .transform((value) => {
    const [keyId, material] = value.split(":") as [string, string];
    return { keyId, material };
  });

/** Plain 32-byte base64 secret (access-cookie encryption key, ADR-014). */
export const rawKey32 = z.string().refine((value) => decodeKeyBytes(value) === KEY_BYTES, {
  message: `must be base64 of exactly ${KEY_BYTES} bytes`,
});

function decodeKeyBytes(value: string | undefined): number {
  if (!value) return -1;
  try {
    return Buffer.from(value, "base64").length;
  } catch {
    return -1;
  }
}

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url(),

    // Identity (ADR-003)
    CLERK_SECRET_KEY: z.string().min(1),
    CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1),

    // Database / storage (ADR-002, ADR-005)
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1),

    // Application cryptography (constitution IV, ADR-014)
    ENCRYPTION_KEY: versionedKey,
    ENCRYPTION_KEY_PREVIOUS: versionedKey.optional(),
    ACCESS_COOKIE_KEY: rawKey32,

    // AI providers (ADR-008)
    OPENAI_API_KEY: z.string().min(1),
    GEMINI_API_KEY: z.string().min(1),
    AI_DEFAULT_PROVIDER: z.enum(["openai", "gemini"]).default("openai"),

    // Email (ADR-009)
    RESEND_API_KEY: z.string().min(1),
    EMAIL_FROM: z.string().min(3),
    EMAIL_WEBHOOK_SECRET: z.string().min(1),

    // Observability (ADR-010) — optional locally, expected in production
    SENTRY_DSN: z.url().optional(),

    // Internal automation (ADR-006)
    CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters"),

    // Malware scanning (ADR-015)
    MALWARE_SCANNER_PROVIDER: z.enum(["noop", "clamav"]).default("noop"),
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    CLAMAV_TLS: booleanString,

    // Operations
    ADMIN_EMAIL: z.email(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.MALWARE_SCANNER_PROVIDER === "noop") {
      ctx.addIssue({
        code: "custom",
        path: ["MALWARE_SCANNER_PROVIDER"],
        message:
          "MALWARE_SCANNER_PROVIDER=noop is refused in production (ADR-015): configure clamav.",
      });
    }
    if (env.MALWARE_SCANNER_PROVIDER === "clamav" && !env.CLAMAV_HOST) {
      ctx.addIssue({
        code: "custom",
        path: ["CLAMAV_HOST"],
        message: "CLAMAV_HOST is required when MALWARE_SCANNER_PROVIDER=clamav.",
      });
    }
    if (env.NODE_ENV === "production" && !env.SENTRY_DSN) {
      ctx.addIssue({
        code: "custom",
        path: ["SENTRY_DSN"],
        message: "SENTRY_DSN is required in production (constitution XXI, ADR-010).",
      });
    }
    if (
      env.ENCRYPTION_KEY_PREVIOUS &&
      env.ENCRYPTION_KEY_PREVIOUS.keyId === env.ENCRYPTION_KEY.keyId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ENCRYPTION_KEY_PREVIOUS"],
        message: "ENCRYPTION_KEY_PREVIOUS must use a different keyId than ENCRYPTION_KEY.",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** The only `NEXT_PUBLIC_*` names that may legitimately contain "KEY". */
const PUBLIC_KEY_ALLOW_LIST = new Set([
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
]);

/**
 * Constitution I: no secret may be exposed under a `NEXT_PUBLIC_` prefix.
 * Returns the offending variable names (never their values).
 */
export type EnvSource = Record<string, string | undefined>;

export function findSuspiciousPublicVariables(env: EnvSource): string[] {
  return Object.keys(env)
    .filter((name) => name.startsWith("NEXT_PUBLIC_"))
    .filter((name) => !PUBLIC_KEY_ALLOW_LIST.has(name))
    .filter((name) => /SECRET|PRIVATE|PASSWORD|TOKEN|_KEY$/i.test(name))
    .sort();
}

export type EnvValidationResult<T> =
  { ok: true; value: T } | { ok: false; issues: { path: string; message: string }[] };

export function validateServerEnv(env: EnvSource): EnvValidationResult<ServerEnv> {
  const suspicious = findSuspiciousPublicVariables(env);
  if (suspicious.length > 0) {
    return {
      ok: false,
      issues: suspicious.map((name) => ({
        path: name,
        message: "secret-like variable exposed with NEXT_PUBLIC_ prefix (constitution I)",
      })),
    };
  }
  const parsed = serverEnvSchema.safeParse(env);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: formatIssues(parsed.error) };
}

export function validatePublicEnv(env: EnvSource): EnvValidationResult<PublicEnv> {
  const parsed = publicEnvSchema.safeParse(env);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: formatIssues(parsed.error) };
}

function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

/** Human-readable, secret-free summary used in start-up failures. */
export function describeIssues(issues: { path: string; message: string }[]): string {
  return issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n");
}
