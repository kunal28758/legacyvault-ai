import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
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

export async function markDelivered(
  serviceDb: TypedSupabaseClient,
  id: string,
  providerMessageId: string | null,
  status: Database["public"]["Enums"]["notification_delivery_status"],
): Promise<void> {
  const { error } = await serviceDb
    .from("notifications")
    .update({ delivery_status: status, provider_message_id: providerMessageId })
    .eq("id", id);
  if (error) throw error;
}
