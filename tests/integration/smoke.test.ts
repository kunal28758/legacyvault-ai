import { describe, expect, it } from "vitest";

import { isLocalStackAvailable } from "../helpers/db";
import { mintLocalJwt, verifyLocalJwt } from "../helpers/jwt";

describe("integration smoke", () => {
  it("mints Clerk-shaped HS256 JWTs the local RLS policies can read", async () => {
    const token = await mintLocalJwt({ sub: "user_test_a" });
    const payload = await verifyLocalJwt(token);
    expect(payload.sub).toBe("user_test_a");
    expect(payload.role).toBe("authenticated");
    expect(payload.aud).toBe("authenticated");
  });

  it("reports whether the local Supabase stack is reachable (never fails the suite)", async () => {
    const available = await isLocalStackAvailable();
    expect(typeof available).toBe("boolean");
  });
});
