import "server-only";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import { createUserClient } from "@/lib/db/server";
import type { ActivityListResult } from "@/lib/types/activity";

/**
 * The caller's own audit trail (constitution XII).
 *
 * `audit_log` is append-only and its RLS policy scopes reads to
 * `actor_id = current_user_id()`, so this can only ever return the caller's own
 * rows. Metadata was already redacted when it was written — nothing sensitive
 * is stored there to begin with — so it is returned as-is.
 */
export async function listActivity(
  user: AppUser,
  query: { page: number; limit: number; resourceId?: string },
): Promise<ActivityListResult> {
  const db = await createUserClient();
  const from = (query.page - 1) * query.limit;

  let select = db
    .from("audit_log")
    .select("id, action, resource_type, resource_id, outcome, ip_address, created_at, metadata", {
      count: "exact",
    })
    .eq("actor_id", user.id);
  if (query.resourceId) select = select.eq("resource_id", query.resourceId);

  const { data, error, count } = await select
    .order("created_at", { ascending: false })
    .range(from, from + query.limit - 1);
  if (error) throw error;

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
      metadata:
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {},
    })),
    total: count ?? 0,
    page: query.page,
    limit: query.limit,
  };
}
