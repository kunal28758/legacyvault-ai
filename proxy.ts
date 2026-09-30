import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (task T192; file convention replaces `middleware.ts`).
 *
 * Protected-first: everything is behind Clerk except the explicit public routes
 * below. Proxy protection is a UX / defense layer only — every Route Handler
 * re-checks authentication and authorization through `withApi()` (T030) and the
 * service layer (constitution III, ADR-004).
 *
 * A per-request CSP nonce is injected through Clerk's built-in CSP support
 * (`contentSecurityPolicy.strict`), which adds `'strict-dynamic'`, Clerk's own
 * origins and the `x-nonce` request header that Next.js reads for its scripts
 * (Next.js CSP guide). Application origins are merged in `cspDirectives`.
 *
 * Environment requirement: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
 * `CLERK_SECRET_KEY` (docs/DEPLOYMENT.md § Clerk, T195). Until they exist the
 * proxy fails closed: public routes still render (with CSP); every other route
 * answers 503 `AUTH_NOT_CONFIGURED` instead of being exposed.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/access(.*)",
  "/emergency-access/(.*)",
  "/api/webhooks/(.*)",
  "/api/internal/cron/(.*)",
  "/api/v1/health",
  // Overall state only for anonymous callers; the breakdown needs a session.
  "/api/v1/system-status",
  "/api/v1/access/(.*)",
  "/api/v1/emergency-access/(request|verify|requests/[^/]+/status)",
]);

const isProduction = process.env.NODE_ENV === "production";

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseWsOrigin = supabaseOrigin?.replace(/^http/, "ws");
const sentryOrigin = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);

/** Application directives merged with Clerk's defaults (Clerk adds its own origins). */
const cspDirectives = {
  "connect-src": [
    "self",
    ...(supabaseOrigin ? [supabaseOrigin] : []),
    ...(supabaseWsOrigin ? [supabaseWsOrigin] : []),
    ...(sentryOrigin ? [sentryOrigin] : []),
  ],
  "img-src": ["self", "blob:", "data:", ...(supabaseOrigin ? [supabaseOrigin] : [])],
  // Signed playback / preview URLs are served from Supabase Storage (ADR-005).
  "media-src": ["self", "blob:", ...(supabaseOrigin ? [supabaseOrigin] : [])],
  "font-src": ["self", "data:"],
  "object-src": ["none"],
  "base-uri": ["self"],
  "frame-ancestors": ["none"],
  ...(isProduction ? { "upgrade-insecure-requests": [] } : {}),
};

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

const clerkProxy = clerkMiddleware(
  async (auth, request) => {
    if (isPublicRoute(request)) return;

    // API routes must answer with the JSON error envelope, not a redirect to a
    // sign-in page, so `withApi()` (T030) performs the check and returns
    // 401 UNAUTHENTICATED. The proxy is a UX / defence layer only — every
    // handler re-checks authentication and authorization (constitution III).
    if (request.nextUrl.pathname.startsWith("/api/")) return;

    await auth.protect();
  },
  {
    contentSecurityPolicy: {
      strict: true,
      directives: cspDirectives,
    },
  },
);

/**
 * Fail-closed fallback used only while Clerk keys are absent (local bootstrap).
 * Mirrors the CSP shape with a locally generated nonce and never exposes a
 * protected route.
 */
function unconfiguredProxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  if (!isPublicRoute(request)) {
    const isApi = request.nextUrl.pathname.startsWith("/api/");
    const response = isApi
      ? NextResponse.json(
          {
            success: false,
            error: {
              code: "AUTH_NOT_CONFIGURED",
              message: "Authentication provider is not configured on this deployment.",
            },
          },
          { status: 503 },
        )
      : new NextResponse(
          "Authentication provider is not configured. See docs/DEPLOYMENT.md § Clerk.",
          {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

if (!clerkConfigured && !isProduction) {
  console.warn(
    "[proxy] Clerk keys are not configured — protected routes answer 503 until NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are set (docs/DEPLOYMENT.md § Clerk).",
  );
}

export default clerkConfigured ? clerkProxy : unconfiguredProxy;

export const config = {
  matcher: [
    // Skip Next.js internals and static assets unless they appear in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
