import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";

import { CORRELATION_HEADER, resolveCorrelationId } from "@/lib/api/correlation";
import { ApiError, mapDatabaseError, toErrorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseOrThrow, parseQuery } from "@/lib/api/validate";
import { audit } from "@/lib/audit/audit.service";
import { requireAccessGrant } from "@/lib/auth/require-access-grant";
import { requireRole, requireUser, type UserRole } from "@/lib/auth/require-user";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import type { AccessGrant } from "@/lib/services/access-portal.service";
import { getEnvGroup } from "@/lib/config/env";
import { errorFields, supabaseClientFields } from "@/lib/observability/error-fields";
import { requestLogger, redactPath } from "@/lib/observability/logger";
import { safeEqual } from "@/lib/security/encryption";
import {
  clientIpFrom,
  enforceRateLimit,
  type RateLimitPolicyName,
} from "@/lib/security/rate-limit";
import type { ApiMeta, ApiSuccess } from "@/lib/types/api";

/**
 * Shared Route Handler pipeline (task T030, ADR-001 § 4).
 *
 * Replaces what Express middleware would have done, in a fixed order so every
 * endpoint behaves identically:
 *
 *   correlation id → no-store → authenticate → CSRF → rate limit → validate
 *   → handler → envelope → safe error mapping (+ DENIED/FAILURE audit)
 *
 * Handlers stay thin: they call a service and return data. Business logic lives
 * in `lib/services` (constitution VIII), authorization is re-checked there, and
 * RLS is the second barrier beneath both.
 */
export type AuthMode = "public" | "user" | "admin" | "access-cookie" | "cron" | "webhook";

export interface ApiContext<TBody = unknown, TQuery = unknown, TParams = unknown> {
  request: Request;
  /** Present for `user` and `admin` modes; never derived from client input. */
  user: AppUser;
  /** Present for `access-cookie` mode: the beneficiary grant, re-checked per request. */
  grant: AccessGrant;
  body: TBody;
  query: TQuery;
  params: TParams;
  correlationId: string;
  logger: ReturnType<typeof requestLogger>;
  ip: string;
}

/** Same as `ApiContext` but without a guaranteed user (public/cron/webhook). */
export type AnonymousApiContext<TBody = unknown, TQuery = unknown, TParams = unknown> = Omit<
  ApiContext<TBody, TQuery, TParams>,
  "user" | "grant"
> & { user: AppUser | null; grant: AccessGrant | null };

export interface WithApiOptions<TBody, TQuery, TParams> {
  auth: AuthMode;
  roles?: readonly UserRole[];
  reverification?: "strict" | "multi_factor";
  rateLimit?: RateLimitPolicyName;
  schema?: {
    body?: z.ZodType<TBody>;
    query?: z.ZodType<TQuery>;
    params?: z.ZodType<TParams>;
  };
  /** Webhook mode only: verify the provider signature over the RAW body. */
  verify?: (rawBody: string, headers: Headers) => Promise<void> | void;
  /** Audit action recorded for DENIED / FAILURE outcomes on this route. */
  auditAction?: string;
  auditResourceType?: string;
}

type RouteArgs = { params: Promise<Record<string, string | string[]>> };

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Modes that travel with ambient credentials and therefore need CSRF defence. */
const COOKIE_MODES = new Set<AuthMode>(["public", "user", "admin", "access-cookie"]);

/**
 * Same-origin check for cookie-bearing mutations (FR-Q007).
 *
 * `cron` and `webhook` are exempt *only* because they carry no cookies and are
 * authenticated per request by a bearer secret or a provider signature — they
 * still get the correlation id, no-store, safe errors and audit rows.
 */
function assertSameOrigin(request: Request): void {
  const method = request.method.toUpperCase();
  if (!MUTATING_METHODS.has(method)) return;

  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  if (site && site !== "same-origin")
    throw ApiError.forbidden("Cross-site requests are not allowed.");

  // Older clients without Sec-Fetch-Site: fall back to comparing Origin.
  const origin = request.headers.get("origin");
  if (!origin) throw ApiError.forbidden("Cross-site requests are not allowed.");
  const target = new URL(request.url).origin;
  if (origin !== target) throw ApiError.forbidden("Cross-site requests are not allowed.");
}

function assertCronSecret(request: Request): void {
  const expected = getEnvGroup("cron").CRON_SECRET;
  const provided = request.headers.get("authorization");
  // Constant-time: a byte-by-byte `!==` would let response timing leak the secret.
  if (!provided || !safeEqual(provided, `Bearer ${expected}`)) throw ApiError.unauthenticated();
}

/**
 * Clerk step-up verification for sensitive operations (FR-A018).
 *
 * The API contract names two levels: `strict` (recent re-auth) and
 * `multi_factor` (DMS check-in / cancel when MFA is enabled). Clerk expresses
 * the latter as the `strict_mfa` preset, so the mapping happens here and the
 * contract's vocabulary is what callers and the client error shape use.
 */
async function assertReverification(level: "strict" | "multi_factor"): Promise<void> {
  const { auth } = await import("@clerk/nextjs/server");
  const { has } = await auth();
  const reverification = level === "multi_factor" ? "strict_mfa" : "strict";
  const satisfied = has?.({ reverification });
  if (!satisfied) throw ApiError.reverificationRequired(level);
}

export function jsonSuccess<T>(data: T, meta: ApiMeta, status = 200): NextResponse {
  const body: ApiSuccess<T> = { success: true, data, meta };
  const response = NextResponse.json(body, { status });
  applyBaseHeaders(response, meta.correlationId as string);
  return response;
}

function applyBaseHeaders(response: NextResponse, correlationId: string): void {
  // Constitution XV: user data must never sit in a shared cache.
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set(CORRELATION_HEADER, correlationId);
}

/**
 * Wraps a Route Handler with the pipeline.
 *
 * Usage: `export const GET = withApi({ auth: "user" }, async (ctx) => …)`
 */
export function withApi<
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
  TResult = unknown,
>(
  options: WithApiOptions<TBody, TQuery, TParams>,
  handler: (ctx: ApiContext<TBody, TQuery, TParams>) => Promise<TResult | NextResponse>,
) {
  return async function route(request: Request, routeArgs?: RouteArgs): Promise<NextResponse> {
    const internal = options.auth === "cron" || options.auth === "webhook";
    const correlationId = resolveCorrelationId(request.headers, internal);
    const url = new URL(request.url);
    const log = requestLogger(correlationId, {
      method: request.method,
      path: redactPath(url.pathname),
      mode: options.auth,
    });
    const ip = clientIpFrom(request.headers);
    let user: AppUser | null = null;
    let grant: AccessGrant | null = null;

    try {
      // 1. Authentication — before anything reads the body.
      if (options.auth === "webhook") {
        const rawBody = await request.text();
        if (!options.verify)
          throw ApiError.internal(new Error("webhook route is missing a verifier"));
        await options.verify(rawBody, request.headers);
        // Hand the already-read body back to the handler.
        request = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: rawBody,
        });
      } else if (options.auth === "cron") {
        assertCronSecret(request);
      } else if (options.auth === "user") {
        user = await requireUser();
      } else if (options.auth === "admin") {
        user = await requireRole(options.roles ?? ["SUPER_ADMIN"]);
      } else if (options.auth === "access-cookie") {
        // No Clerk session exists here; the token row is the authorization.
        grant = await requireAccessGrant();
      }

      // 2. CSRF for ambient-credential modes only.
      if (COOKIE_MODES.has(options.auth)) assertSameOrigin(request);

      // 3. Step-up verification for sensitive operations.
      if (options.reverification) await assertReverification(options.reverification);

      // 4. Rate limit — keyed by user where we have one, else by client IP.
      //    Reads on a `default` route count against the separate `read` budget.
      if (options.rateLimit) {
        const isRead = request.method === "GET" || request.method === "HEAD";
        await enforceRateLimit({
          policy: options.rateLimit === "default" && isRead ? "read" : options.rateLimit,
          subject: user?.id ?? grant?.tokenId ?? ip,
        });
      }

      // 5. Validation.
      const params = options.schema?.params
        ? parseOrThrow(options.schema.params, await resolveParams(routeArgs))
        : ((await resolveParams(routeArgs)) as TParams);
      const query = options.schema?.query
        ? parseQuery(url, options.schema.query)
        : (undefined as TQuery);
      const body = options.schema?.body
        ? await parseJsonBody(request, options.schema.body)
        : (undefined as TBody);

      // 6. Handler.
      const result = await handler({
        request,
        user: user as AppUser,
        grant: grant as AccessGrant,
        body,
        query,
        params,
        correlationId,
        logger: log,
        ip,
      });

      if (result instanceof NextResponse) {
        applyBaseHeaders(result, correlationId);
        return result;
      }
      return jsonSuccess(result, { correlationId });
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : mapDatabaseError(caught);

      if (apiError.status >= 500) {
        const cause = apiError.cause ?? caught;
        log.error(
          { err: cause, code: apiError.code, ...errorFields(cause), ...supabaseClientFields() },
          "request failed",
        );
      } else {
        log.warn({ code: apiError.code, status: apiError.status }, "request rejected");
      }

      // Security-relevant rejections are auditable even when no service ran.
      if (apiError.status === 401 || apiError.status === 403 || apiError.status >= 500) {
        await audit.log({
          actorId: user?.id ?? null,
          actorRole: user?.role ?? null,
          action: options.auditAction ?? `api.${request.method.toLowerCase()}`,
          resourceType: options.auditResourceType ?? "api",
          outcome: apiError.status >= 500 ? "FAILURE" : "DENIED",
          metadata: { path: redactPath(url.pathname), code: apiError.code },
          ipAddress: ip,
          userAgent: request.headers.get("user-agent"),
          correlationId,
        });
      }

      const { body, status } = toErrorResponse(apiError, { correlationId });
      const response = NextResponse.json(body, { status });
      applyBaseHeaders(response, correlationId);
      if (apiError.status === 429) {
        const retryAfter = apiError.details?.retryAfterSeconds;
        if (typeof retryAfter === "number") response.headers.set("Retry-After", String(retryAfter));
      }
      return response;
    }
  };
}

async function resolveParams(routeArgs?: RouteArgs): Promise<Record<string, string | string[]>> {
  if (!routeArgs?.params) return {};
  return routeArgs.params;
}
