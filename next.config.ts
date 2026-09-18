import type { NextConfig } from "next";

/**
 * Next.js configuration (confirmed in T002). Security headers (HSTS, X-Frame-Options,
 * nosniff, Referrer-Policy, Permissions-Policy) are added by T024; the CSP nonce is
 * injected per request by proxy.ts (T192).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
