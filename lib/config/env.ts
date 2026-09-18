import "server-only";

import { describeIssues, validateServerEnv, type ServerEnv } from "@/lib/config/env.schema";

export { publicEnv } from "@/lib/config/public-env";
export type { ServerEnv } from "@/lib/config/env.schema";

/**
 * Server-only, Zod-validated environment (task T007).
 *
 * Validation runs once, on first access, and throws a secret-free error listing the
 * offending variable names. Every server module that needs configuration must read
 * it from here — never from `process.env` directly (constitution I, IX).
 *
 * Production refuses to start with `MALWARE_SCANNER_PROVIDER=noop` (ADR-015).
 */
let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const result = validateServerEnv(process.env);
  if (!result.ok) {
    throw new Error(
      `Invalid server environment configuration:\n${describeIssues(result.issues)}\n` +
        "See .env.example and docs/DEPLOYMENT.md.",
    );
  }
  cached = result.value;
  return cached;
}

/** Ergonomic accessor: `serverEnv.CRON_SECRET` validates lazily on first use. */
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, property) {
    return getServerEnv()[property as keyof ServerEnv];
  },
  has(_target, property) {
    return property in getServerEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(getServerEnv());
  },
  getOwnPropertyDescriptor(_target, property) {
    return Object.getOwnPropertyDescriptor(getServerEnv(), property);
  },
});

/** For tests only: forget the cached value so a new `process.env` is re-validated. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
