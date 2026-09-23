import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { JobRow } from "@/lib/repositories/job.repository";

/**
 * Background job contract (ADR-006).
 *
 * A handler receives the claimed row and the service client. It must be safe to
 * run more than once: the queue guarantees at-least-once delivery, never
 * exactly-once, so every handler either checks for its own effect first or
 * relies on a database uniqueness rule to make the second run a no-op.
 */
export type JobHandler = (job: JobRow, db: TypedSupabaseClient) => Promise<void>;

export function payloadOf(job: JobRow): Record<string, unknown> {
  return job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? (job.payload as Record<string, unknown>)
    : {};
}

export function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`job payload is missing ${key}`);
  }
  return value;
}
