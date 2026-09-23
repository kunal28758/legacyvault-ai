import type { NextConfig } from "next";

/**
 * Next.js configuration.
 *
 * Security headers (task T024, constitution XI/XXI, FR-Q015) are set here for
 * every response; the per-request CSP nonce is injected by `proxy.ts` (T192)
 * because it must vary per request and cannot be a static header.
 */
const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The baseline is upload-only for video (Clarifications 2026-09-18), so no
  // page needs camera, microphone or geolocation.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Defence in depth: the API layer also sets this on every response.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
