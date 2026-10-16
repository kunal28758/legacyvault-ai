// @vitest-environment node
import { describe, expect, it } from "vitest";

import { clerkHostOf, isolationProblems, PRODUCTION } from "@/scripts/staging/isolation";

/** A publishable key for a Frontend API host, as Clerk encodes it. */
const pk = (host: string) => `pk_test_${Buffer.from(`${host}$`).toString("base64")}`;

const STAGING = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk("staging-owl-12.clerk.accounts.dev"),
  CLERK_SECRET_KEY: "sk_test_placeholder",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_placeholder",
  APP_URL: "https://legacyvault-staging.vercel.app",
};

describe("staging isolation check", () => {
  it("passes a configuration with its own project, Clerk instance and host", () => {
    const report = isolationProblems(STAGING);
    expect(report.failures).toEqual([]);
    expect(report.facts).toEqual({
      supabase: "abcdefghijklmnopqrst.supabase.co",
      clerk: "staging-owl-12.clerk.accounts.dev",
      app: "legacyvault-staging.vercel.app",
    });
  });

  it.each([
    ["the production database", { SUPABASE_URL: `https://${PRODUCTION.supabaseRef}.supabase.co` }],
    [
      "the production Clerk instance",
      { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk(PRODUCTION.clerkFrontendApi) },
    ],
    ["the production host", { APP_URL: `https://${PRODUCTION.appHosts[0]}` }],
    ["two different projects", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }],
    ["no webhook secret", { CLERK_WEBHOOK_SIGNING_SECRET: undefined }],
    ["no publishable key", { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: undefined }],
  ])("refuses %s", (_label, override) => {
    expect(isolationProblems({ ...STAGING, ...override }).failures).not.toEqual([]);
  });

  it("warns when staging would send real email, unless mail goes to a local capture", () => {
    expect(isolationProblems({ ...STAGING, BREVO_API_KEY: "x" }).warnings).toHaveLength(1);
    expect(isolationProblems({ ...STAGING, RESEND_API_KEY: "x" }).warnings).toHaveLength(1);
    expect(
      isolationProblems({
        ...STAGING,
        RESEND_API_KEY: "x",
        RESEND_BASE_URL: "http://127.0.0.1:4010",
      }).warnings,
    ).toEqual([]);
  });

  it("reads the Frontend API host out of a publishable key", () => {
    expect(clerkHostOf(pk("a-b-1.clerk.accounts.dev"))).toBe("a-b-1.clerk.accounts.dev");
    expect(clerkHostOf("not-a-key")).toBeNull();
  });
});
