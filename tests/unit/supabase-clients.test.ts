import { beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ getToken: vi.fn() }));
const created = vi.hoisted(
  () =>
    [] as {
      url: string;
      key: string;
      options: { accessToken?: () => Promise<string | null> };
    }[],
);

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ getToken: clerk.getToken }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, options: object) => {
    created.push({ url, key, options });
    return {};
  },
}));
vi.mock("@/lib/config/public-env", () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  }),
}));
vi.mock("@/lib/config/env", () => ({
  getEnvGroup: () => ({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
  }),
}));

import { createServiceClient, createUserClient } from "@/lib/db/server";

/**
 * Clerk → Supabase third-party auth, the application half (ADR-004).
 *
 * Supabase trusts Clerk's own session tokens (Dashboard → Authentication →
 * Third-party auth → Clerk); the deprecated JWT-template integration is not
 * used. So the user-scoped client must send the publishable key — never the
 * secret one — plus Clerk's *default* session token, fetched per request, and
 * nothing at all when there is no session.
 */
beforeEach(() => {
  created.length = 0;
  clerk.getToken.mockReset();
});

describe("createUserClient", () => {
  it("sends Clerk's default session token with the publishable key", async () => {
    clerk.getToken.mockResolvedValue("clerk-session-token");

    await createUserClient();

    expect(created).toHaveLength(1);
    expect(created[0].url).toBe("https://project.supabase.co");
    expect(created[0].key).toBe("sb_publishable_test");
    await expect(created[0].options.accessToken?.()).resolves.toBe("clerk-session-token");
    // The session token itself — no JWT template, no shared secret.
    expect(clerk.getToken).toHaveBeenCalledWith();
  });

  it("asks Clerk again on every request, so a refreshed session is picked up", async () => {
    clerk.getToken.mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    await createUserClient();
    const accessToken = created[0].options.accessToken!;

    await expect(accessToken()).resolves.toBe("first");
    await expect(accessToken()).resolves.toBe("second");
  });

  it("sends no token without a session, so the request is anonymous", async () => {
    clerk.getToken.mockResolvedValue(null);

    await createUserClient();

    await expect(created[0].options.accessToken?.()).resolves.toBeNull();
  });
});

describe("createServiceClient", () => {
  it("uses the secret key and never a user's token", () => {
    createServiceClient();

    expect(created[0].key).toBe("sb_secret_test");
    expect(created[0].options.accessToken).toBeUndefined();
  });
});
