import { describe, expect, it } from "vitest";

import {
  findSuspiciousPublicVariables,
  validatePublicEnv,
  validateServerEnv,
  type EnvSource,
} from "@/lib/config/env.schema";

// Synthetic values only (constitution XVII). 32 zero bytes in base64:
const KEY32 = Buffer.alloc(32, 1).toString("base64");

const validServerEnv: EnvSource = {
  NODE_ENV: "development",
  APP_URL: "http://localhost:3000",
  CLERK_SECRET_KEY: "sk_test_placeholder",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_placeholder",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "sb_secret_placeholder",
  ENCRYPTION_KEY: `k1:${KEY32}`,
  ACCESS_COOKIE_KEY: KEY32,
  OPENAI_API_KEY: "sk-placeholder",
  GEMINI_API_KEY: "placeholder",
  RESEND_API_KEY: "re_placeholder",
  EMAIL_FROM: "LegacyVault AI <no-reply@example.com>",
  EMAIL_WEBHOOK_SECRET: "placeholder",
  CRON_SECRET: "0123456789abcdef0123456789abcdef",
  ADMIN_EMAIL: "admin@example.com",
};

describe("server environment schema (T007)", () => {
  it("accepts a complete development configuration", () => {
    const result = validateServerEnv(validServerEnv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ENCRYPTION_KEY).toEqual({ keyId: "k1", material: KEY32 });
      expect(result.value.AI_DEFAULT_PROVIDER).toBe("openai");
    }
  });

  it("accepts a production configuration with no malware scanner", () => {
    const result = validateServerEnv({
      ...validServerEnv,
      NODE_ENV: "production",
      SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
    });
    expect(result.ok).toBe(true);
  });

  it("ignores scanner variables left over in a hosting dashboard", () => {
    const result = validateServerEnv({
      ...validServerEnv,
      NODE_ENV: "production",
      SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
      MALWARE_SCANNER_PROVIDER: "noop",
      CLAMAV_HOST: "",
      CLAMAV_PORT: "not-a-port",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("MALWARE_SCANNER_PROVIDER");
      expect(result.value).not.toHaveProperty("CLAMAV_HOST");
    }
  });

  it("rejects key material that is not exactly 32 bytes", () => {
    const short = Buffer.alloc(16, 1).toString("base64");
    const result = validateServerEnv({ ...validServerEnv, ENCRYPTION_KEY: `k1:${short}` });
    expect(result.ok).toBe(false);
  });

  it("fails fast when a required secret is missing and names only the variable", () => {
    const { CLERK_SECRET_KEY: _omitted, ...withoutClerk } = validServerEnv;
    const result = validateServerEnv(withoutClerk);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((entry) => entry.path === "CLERK_SECRET_KEY");
      expect(issue).toBeDefined();
      expect(JSON.stringify(result.issues)).not.toContain("sk_test_placeholder");
    }
  });

  it("rejects secret-like variables exposed with a NEXT_PUBLIC_ prefix (constitution I)", () => {
    expect(
      findSuspiciousPublicVariables({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
        NEXT_PUBLIC_OPENAI_API_KEY: "leaked",
        NEXT_PUBLIC_CRON_SECRET: "leaked",
      }),
    ).toEqual(["NEXT_PUBLIC_CRON_SECRET", "NEXT_PUBLIC_OPENAI_API_KEY"]);

    const result = validateServerEnv({
      ...validServerEnv,
      NEXT_PUBLIC_SUPABASE_SECRET_KEY: "leaked",
    });
    expect(result.ok).toBe(false);
  });
});

describe("public environment schema (T007)", () => {
  it("validates the four public variables", () => {
    const result = validatePublicEnv({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_placeholder",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
    });
    expect(result.ok).toBe(true);
  });
});

describe("cross-field production rules", () => {
  it("lists every production-only requirement even on a partial environment", async () => {
    const { crossFieldIssues } = await import("@/lib/config/env.schema");
    const paths = crossFieldIssues({ NODE_ENV: "production" }).map((issue) => issue.path);
    expect(paths).toEqual(["OPENAI_API_KEY", "SENTRY_DSN"]);
  });

  it("accepts either AI provider in production and ignores production rules in development", async () => {
    const { crossFieldIssues } = await import("@/lib/config/env.schema");
    expect(
      crossFieldIssues({
        NODE_ENV: "production",
        GEMINI_API_KEY: "key",
        SENTRY_DSN: "https://example.ingest.sentry.io/1",
      }),
    ).toEqual([]);
    expect(crossFieldIssues({ NODE_ENV: "development" })).toEqual([]);
  });
});
