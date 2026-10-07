import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import { enqueue } from "@/lib/repositories/job.repository";
import type { NotificationItem } from "@/lib/types/notification";
import type { Database } from "@/lib/types/database";

/**
 * Notification data access (FR-L001–L006).
 *
 * Rows are written by the guarded functions and by the system; the only write
 * `authenticated` may make is to `read_at`, which is exactly the column grant.
 */
export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    channel: row.channel,
    deliveryStatus: row.delivery_status,
    readAt: row.read_at,
    metadata: asRecord(row.metadata),
    createdAt: row.created_at,
  };
}

export async function list(
  db: TypedSupabaseClient,
  userId: string,
  filters: { unreadOnly?: boolean; page: number; limit: number },
): Promise<{ rows: NotificationRow[]; total: number }> {
  let query = db.from("notifications").select("*", { count: "exact" }).eq("user_id", userId);
  if (filters.unreadOnly) query = query.is("read_at", null);

  const from = (filters.page - 1) * filters.limit;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + filters.limit - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function unreadCount(db: TypedSupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function markRead(
  db: TypedSupabaseClient,
  userId: string,
  ids: readonly string[],
): Promise<number> {
  const readAt = new Date().toISOString();
  let query = db
    .from("notifications")
    .update({ read_at: readAt })
    .eq("user_id", userId)
    .is("read_at", null);
  if (ids.length > 0) query = query.in("id", [...ids]);

  const { data, error } = await query.select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function findById(
  db: TypedSupabaseClient,
  id: string,
): Promise<NotificationRow | null> {
  const { data, error } = await db.from("notifications").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/** System-created notification (service role; `notifications` has no insert grant). */
export async function insertSystem(
  serviceDb: TypedSupabaseClient,
  input: {
    userId: string;
    type: string;
    title: string;
    content: string;
    channel: Database["public"]["Enums"]["notification_channel"];
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const { data, error } = await serviceDb
    .from("notifications")
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      content: input.content,
      channel: input.channel,
      metadata: (input.metadata ?? {}) as never,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * A system notification plus its delivery job. The row is the record; email
 * is a separate retried job, so a slow provider never holds up the caller.
 */
export async function notifyOwner(
  serviceDb: TypedSupabaseClient,
  input: Omit<Parameters<typeof insertSystem>[1], "channel">,
): Promise<string> {
  const notificationId = await insertSystem(serviceDb, { ...input, channel: "BOTH" });
  await enqueue(
    serviceDb,
    "notification.deliver",
    { notificationId },
    `notification.deliver:${notificationId}`,
  );
  return notificationId;
}

export async function markDelivered(
  serviceDb: TypedSupabaseClient,
  id: string,
  providerMessageId: string | null,
  status: Database["public"]["Enums"]["notification_delivery_status"],
  provider: "resend" | "brevo" | null = null,
): Promise<void> {
  const { error } = await serviceDb
    .from("notifications")
    .update({
      delivery_status: status,
      provider_message_id: providerMessageId,
      delivery_provider: provider,
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Records what the provider reported for a message it had accepted. Only a
 * row still at SENT moves: a webhook that got there first is not overwritten.
 */
export async function recordOutcome(
  serviceDb: TypedSupabaseClient,
  id: string,
  status: "DELIVERED" | "BOUNCED" | "FAILED",
): Promise<boolean> {
  const { data, error } = await serviceDb
    .from("notifications")
    .update({ delivery_status: status })
    .eq("id", id)
    .eq("delivery_status", "SENT")
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** The release warnings of one switch since a moment (the current cycle), newest first. */
export async function listReleaseWarnings(
  db: TypedSupabaseClient,
  userId: string,
  switchId: string,
  since: string,
): Promise<NotificationRow[]> {
  const { data, error } = await db
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .in("type", [...RELEASE_WARNING_TYPES])
    .eq("metadata->>switchId", switchId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

/** The owner warnings that can satisfy the release gate in dms_transition() (0009). */
export const RELEASE_WARNING_TYPES = [
  "dms.grace_period",
  "dms.escalating",
  "dms.release_held",
] as const;
