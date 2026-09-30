import "server-only";

import { ApiError } from "@/lib/api/errors";
import { createServiceClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";

/**
 * Application rate limiting (task T025, ADR-007, FR-Q008).
 *
 * Fixed-window counters in PostgreSQL via the `rate_limit_hit()` function — no
 * Redis (ADR-006/007). This is the innermost of three layers; Clerk attack
 * protection and the Vercel WAF sit in front of it.
 *
 * The store is behind an interface so Upstash Redis can replace it later
 * without touching callers, exactly as ADR-007's revisit trigger describes.
 */
export type RateLimitPolicyName =
  | "default"
  | "read"
  | "autosave"
  | "sensitive"
  | "ai"
  | "publicEmergency"
  | "accessExchange"
  | "tokenAccess";

interface PolicyDefinition {
  limit: number;
  windowSeconds: number;
}

/**
 * Policies are fixed by the API contract; callers pick a name, never a number.
 *
 * `read` and `autosave` were added (2026-09-30) because reads and the wizard's
 * auto-save shared `default`'s 100 requests per 15 minutes with every write:
 * one dashboard load issues ~13 reads, so ordinary browsing exhausted the
 * budget and auto-save started failing with 429. Reads of one's own data and
 * debounced section saves now have their own, larger, still-bounded budgets;
 * every other write keeps `default`. `withApi()` applies `read` to GET/HEAD
 * requests on `default` routes.
 */
export const RATE_LIMIT_POLICIES: Record<RateLimitPolicyName, PolicyDefinition> = {
  default: { limit: 100, windowSeconds: 15 * 60 },
  read: { limit: 600, windowSeconds: 15 * 60 },
  autosave: { limit: 600, windowSeconds: 15 * 60 },
  sensitive: { limit: 5, windowSeconds: 15 * 60 },
  ai: { limit: 20, windowSeconds: 60 * 60 },
  publicEmergency: { limit: 5, windowSeconds: 60 * 60 },
  accessExchange: { limit: 10, windowSeconds: 15 * 60 },
  tokenAccess: { limit: 60, windowSeconds: 15 * 60 },
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  hit(key: string, windowStart: Date, limit: number): Promise<{ allowed: boolean; count: number }>;
}

/** Default store: atomic upsert inside PostgreSQL, safe under concurrency. */
const postgresStore: RateLimitStore = {
  async hit(key, windowStart, limit) {
    const db = createServiceClient();
    const { data, error } = await db.rpc("rate_limit_hit", {
      p_key: key,
      p_window_start: windowStart.toISOString(),
      p_limit: limit,
    });
    if (error) throw error;
    const result = data as unknown as { allowed: boolean; count: number };
    return { allowed: result.allowed, count: result.count };
  },
};

let store: RateLimitStore = postgresStore;

/** Test seam; production always uses the PostgreSQL store. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

function windowStartFor(windowSeconds: number, now: Date): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export interface EnforceRateLimitArgs {
  policy: RateLimitPolicyName;
  /** Stable subject: app user id, client IP, access-token id or config id. */
  subject: string;
  now?: Date;
}

/**
 * Counts one hit and reports the outcome.
 *
 * A limiter outage must not become an authentication bypass *or* a denial of
 * service: if the store errors the request is allowed and the failure is logged
 * as a security-relevant event. The edge WAF still applies.
 */
export async function checkRateLimit({
  policy,
  subject,
  now = new Date(),
}: EnforceRateLimitArgs): Promise<RateLimitResult> {
  const definition = RATE_LIMIT_POLICIES[policy];
  const windowStart = windowStartFor(definition.windowSeconds, now);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStart.getTime() + definition.windowSeconds * 1000 - now.getTime()) / 1000),
  );

  try {
    const { allowed, count } = await store.hit(
      `${policy}:${subject}`,
      windowStart,
      definition.limit,
    );
    return {
      allowed,
      limit: definition.limit,
      remaining: Math.max(0, definition.limit - count),
      retryAfterSeconds,
    };
  } catch (cause) {
    logger.error({ err: cause, policy }, "rate limiter unavailable — allowing request");
    return {
      allowed: true,
      limit: definition.limit,
      remaining: definition.limit,
      retryAfterSeconds,
    };
  }
}

/** Throws the 429 described by the contract when the window is exhausted. */
export async function enforceRateLimit(args: EnforceRateLimitArgs): Promise<RateLimitResult> {
  const result = await checkRateLimit(args);
  if (!result.allowed) throw ApiError.rateLimited(result.retryAfterSeconds);
  return result;
}

/**
 * Client IP for per-IP policies.
 *
 * Only the platform-provided header is trusted (Vercel sets it and strips any
 * inbound copy); an arbitrary `X-Forwarded-For` from the client would let a
 * caller pick its own bucket.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}
