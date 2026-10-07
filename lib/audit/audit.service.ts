import "server-only";

import { createServiceClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";
import type { Database } from "@/lib/types/database";

/**
 * Append-only audit logging (task T027, constitution XII).
 *
 * Division of labour, so nothing is double-counted and nothing is missed:
 *  • guarded `SECURITY DEFINER` functions write their own SUCCESS row inside
 *    the same transaction as the change they make;
 *  • `audit_class_a_change()` triggers cover direct Class A writes;
 *  • this service records what the database cannot see — DENIED and FAILURE
 *    outcomes, Class C system actions, and reads that must be auditable
 *    (document downloads, credential reveals).
 *
 * The service client is used because `audit_log` has no insert grant for
 * `authenticated`, and the table rejects UPDATE and DELETE for every role.
 * There is deliberately no update or delete method here.
 */
export type AuditOutcome = Database["public"]["Enums"]["audit_outcome"];

export interface AuditEntry {
  actorId: string | null;
  actorRole?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

/** Field names whose values must never reach an audit row. */
const REDACTED_KEYS = new Set([
  "identificationDetails",
  "identification_details",
  "accountNumber",
  "account_number",
  "policyNumber",
  "policy_number",
  "credentials",
  "recoveryInfo",
  "recovery_info",
  "content",
  "token",
  "tokenHash",
  "token_hash",
  "otp",
  "otpHash",
  "otp_hash",
  "verificationCode",
  "verificationCodeHash",
  "verification_code_hash",
  "password",
  "secret",
]);

/** Replaces sensitive values with a marker, preserving the shape for forensics. */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redactForAudit(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_KEYS.has(key) ? "[encrypted]" : redactForAudit(item, depth + 1);
    }
    return output;
  }
  return value;
}

/**
 * Builds a redacted before/after diff for the audit metadata.
 * Only changed keys are included, and sensitive ones are reduced to a marker.
 */
export function diffForAudit(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { changed: string[]; previous: Record<string, unknown>; next: Record<string, unknown> } {
  const changed: string[] = [];
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    const from = before?.[key];
    const to = after?.[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changed.push(key);
    if (REDACTED_KEYS.has(key)) {
      previous[key] = "[encrypted]";
      next[key] = "[encrypted]";
    } else {
      previous[key] = redactForAudit(from);
      next[key] = redactForAudit(to);
    }
  }
  return { changed, previous, next };
}

/**
 * Writes one audit row.
 *
 * Auditing must never take down the operation it is recording, so a failure is
 * logged loudly (it is a security-relevant event in itself) rather than thrown.
 * Operations whose audit trail is legally required write theirs inside the
 * guarded function's transaction instead, where it cannot be lost.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const db = createServiceClient();
    const { error } = await db.from("audit_log").insert({
      actor_id: entry.actorId,
      actor_role: entry.actorRole ?? null,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      outcome: entry.outcome,
      metadata: (entry.metadata ? redactForAudit(entry.metadata) : null) as never,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      correlation_id: entry.correlationId ?? null,
    });
    if (error) throw error;
  } catch (cause) {
    logger.error(
      { err: cause, action: entry.action, correlationId: entry.correlationId },
      "failed to write audit row",
    );
  }
}

export const audit = { log: recordAudit, diff: diffForAudit, redact: redactForAudit };
