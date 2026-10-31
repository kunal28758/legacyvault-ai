import "server-only";

import {
  describeIssues,
  groupSchema,
  validateServerEnv,
  type ServerEnv,
  type ServerEnvGroupName,
} from "@/lib/config/env.schema";
import type { z } from "zod";

export { publicEnv } from "@/lib/config/public-env";
export type { ServerEnv } from "@/lib/config/env.schema";

/**
 * Server-only, Zod-validated environment (task T007).
 *
 * Validation runs once, on first access, and throws a secret-free error listing the
 * offending variable names. Every server module that needs configuration must read
 * it from here — never from `process.env` directly (constitution I, IX).
 *
 * Two accessors, same rules:
 *  • `getServerEnv()` validates the **entire** schema. Production start-up and
 *    `pnpm env:check` use it, so a deployment still cannot boot with anything
 *    missing.
 *  • `getEnvGroup(name)` validates only one feature's variables, at the moment
 *    that feature runs. A developer working on the database locally is then
 *    blocked by the database variables, not by an AI key they are not using
 *    (docs/DEPLOYMENT.md § 3). No rule is relaxed — the failure is narrower,
 *    never weaker, and nothing becomes optional.
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

type GroupValue<K extends ServerEnvGroupName> = z.infer<ReturnType<typeof groupSchema<K>>>;

const groupCache = new Map<ServerEnvGroupName, unknown>();

/**
 * Validates and returns one feature's environment slice.
 *
 * Throws the same secret-free error as `getServerEnv()`, naming only the
 * variables that feature needs.
 */
export function getEnvGroup<K extends ServerEnvGroupName>(name: K): GroupValue<K> {
  const hit = groupCache.get(name);
  if (hit) return hit as GroupValue<K>;

  const result = groupSchema(name).safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join(".") || "(root)",
      message: issue.message,
    }));
    throw new Error(
      `Invalid "${name}" environment configuration:\n${describeIssues(issues)}\n` +
        "See .env.example and docs/DEPLOYMENT.md.",
    );
  }
  groupCache.set(name, result.data);
  return result.data as GroupValue<K>;
}

/** For tests only: forget cached group values so a new `process.env` is re-validated. */
export function resetEnvGroupCache(): void {
  groupCache.clear();
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

/**
 * Runtime cutover switch. An invalid value blocks mutations rather than
 * silently disabling the safety control; an absent value keeps normal operation.
 */
export function legacyPlanMaintenanceEnabled(): boolean {
  const value = process.env.LEGACY_PLAN_MAINTENANCE_MODE;
  if (value === undefined) return false;
  if (value === "enabled") return true;
  if (value === "disabled") return false;
  console.error("[config] Invalid LEGACY_PLAN_MAINTENANCE_MODE; failing closed.");
  return true;
}
