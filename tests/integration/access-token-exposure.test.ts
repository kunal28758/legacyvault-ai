import pino from "pino";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as exchangeRoute } from "@/app/api/v1/access/exchange/route";
import type { TypedSupabaseClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";
import { accessLinkFor, mintAccessToken } from "@/lib/security/access-token";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * An access-link secret must never be recorded anywhere it was not meant to be.
 *
 * The real exchange route (withApi: logging, rate limit, audit) is driven with a
 * valid, a wrong, a revoked and an expired secret. Every line the application
 * logger writes — captured at its one output stream, after its redaction rules —
 * every audit row written meanwhile, and every response is then searched for
 * the secret. The link itself carries the secret only in its fragment, so no
 * request line (and so no server or platform request log) ever holds it.
 */
const SUBJECT = "user_token_exposure_alice";
const available = await isLocalStackAvailable();
let aliceId: string;
let alice: TypedSupabaseClient;
let service: TypedSupabaseClient;
let written: string[] = [];

if (!available) {
  console.warn("[access-token-exposure] local Supabase stack unreachable. Assertions are SKIPPED.");
}

beforeAll(async () => {
  if (!available) return;
  process.env.ACCESS_COOKIE_KEY ??= Buffer.from(new Uint8Array(32).fill(9)).toString("base64");
  service = createServiceScopedClient() as unknown as TypedSupabaseClient;
  await service.from("users").delete().eq("clerk_user_id", SUBJECT);
  const { data, error } = await service
    .from("users")
    .insert({ clerk_user_id: SUBJECT, email: "alice.exposure@example.com", name: "Alice" })
    .select("id")
    .single();
  if (error) throw error;
  aliceId = data.id;
  alice = (await createUserScopedClient(SUBJECT)) as unknown as TypedSupabaseClient;
}, 60_000);

beforeEach(async () => {
  if (!available) return;
  await service.from("access_tokens").delete().eq("owner_user_id", aliceId);
  await service.from("beneficiaries").delete().eq("user_id", aliceId);
  await service.from("financial_assets").delete().eq("user_id", aliceId);
  written = [];
  const stream = (logger as unknown as Record<symbol, { write: (line: string) => void }>)[
    pino.symbols.streamSym
  ];
  vi.spyOn(stream, "write").mockImplementation((line: string) => {
    written.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A live fixed-scope link for a new beneficiary; returns its secret and id. */
async function liveLink(): Promise<{ secret: string; tokenId: string }> {
  const { data: beneficiary, error: beneficiaryError } = await alice
    .from("beneficiaries")
    .insert({
      user_id: aliceId,
      name: "Trusted Person",
      relationship: "Sibling",
      email: `exposure-${crypto.randomUUID()}@example.com`,
    })
    .select("id")
    .single();
  if (beneficiaryError) throw beneficiaryError;
  const { data: assetId } = await alice.rpc("create_asset", {
    p_resource_type: "FINANCIAL_ASSET",
    p_plain: { name: "Savings", category: "BANK_ACCOUNT", currency: "INR" } as never,
  });
  await alice.rpc("assign_beneficiary", {
    p_beneficiary_id: beneficiary.id,
    p_resource_type: "FINANCIAL_ASSET",
    p_resource_id: assetId as string,
  });
  const minted = mintAccessToken();
  const { data: tokenId, error } = await alice.rpc("issue_access_token", {
    p_beneficiary_id: beneficiary.id,
    p_scope: {
      documents: [],
      assets: [{ type: "FINANCIAL_ASSET", id: assetId as string }],
      videos: [],
      planSections: [],
    } as never,
    p_token_hash: minted.hash,
    p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  if (error) throw error;
  return { secret: minted.plaintext, tokenId: tokenId as string };
}

/** The exchange exactly as the portal sends it: a same-origin POST, secret in the body. */
function exchange(secret: string) {
  return exchangeRoute(
    new Request("http://localhost:3000/api/v1/access/exchange", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        // A fresh client address per call, so the per-IP exchange budget is not shared.
        "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      },
      body: JSON.stringify({ token: secret }),
    }),
  );
}

async function auditSince(since: string): Promise<string> {
  const { data } = await service
    .from("audit_log")
    .select("action, resource_type, metadata, ip_address, user_agent")
    .gte("created_at", since);
  return JSON.stringify(data ?? []);
}

describe.skipIf(!available)("access-link secret exposure", () => {
  it("keeps the secret out of the request line by putting it in the fragment", () => {
    const url = new URL(accessLinkFor("not-a-real-secret"));
    expect(url.hash).toBe("#t=not-a-real-secret");
    // What a browser sends as the request target: path and query, never the fragment.
    expect(`${url.pathname}${url.search}`).toBe("/access");
  });

  it("logs, audits and answers a valid exchange without the secret", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const { secret } = await liveLink();

    const response = await exchange(secret);
    const body = await response.text();

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/access/);
    expect(cookie).toMatch(/Max-Age=1800/);
    for (const surface of [body, cookie, written.join("\n"), await auditSince(since)]) {
      expect(surface).not.toContain(secret);
    }
    // The exchange was audited — just never with the secret.
    expect(await auditSince(since)).toContain("access.exchanged");
  });

  it("refuses a wrong, a revoked and an expired secret, and records none of them", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const wrong = mintAccessToken().plaintext;
    const revoked = await liveLink();
    await alice.rpc("revoke_access_token", { p_token_id: revoked.tokenId });
    const expired = await liveLink();
    await service
      .from("access_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", expired.tokenId);

    for (const secret of [wrong, revoked.secret, expired.secret]) {
      const response = await exchange(secret);
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).not.toContain(secret);
    }
    // The capture is real: each refusal was logged (without the secret).
    expect(written.filter((line) => line.includes("request rejected"))).toHaveLength(3);
    const everything = `${written.join("\n")}\n${await auditSince(since)}`;
    for (const secret of [wrong, revoked.secret, expired.secret]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("lets a live link open again until it is revoked or expires (it is not one-time)", async () => {
    const { secret, tokenId } = await liveLink();
    expect((await exchange(secret)).status).toBe(200);
    expect((await exchange(secret)).status).toBe(200);

    await alice.rpc("revoke_access_token", { p_token_id: tokenId });
    expect((await exchange(secret)).status).toBe(401);
  });
});
