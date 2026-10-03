import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { VideoAssignment, VideoMessage } from "@/lib/types/video";
import type { Database } from "@/lib/types/database";

/**
 * Video legacy data access (FR-K001–K006).
 *
 * Rows are created by `promote_upload()` and soft-deleted by `delete_video()`.
 * The Class A grant covers (title, description, delivery_condition, metadata),
 * which is what an owner may edit after the fact.
 */
export type VideoRow = Database["public"]["Tables"]["video_messages"]["Row"];

export function toVideo(row: VideoRow, assignments: VideoAssignment[]): VideoMessage {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    deliveryCondition: row.delivery_condition,
    assignments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeSearch(term: string): string {
  return term
    .replace(/[^\p{L}\p{N}\s.@_-]/gu, " ")
    .trim()
    .slice(0, 60);
}

export async function list(
  db: TypedSupabaseClient,
  userId: string,
  filters: { deliveryCondition?: string; search?: string; page: number; limit: number },
): Promise<{ rows: VideoRow[]; total: number }> {
  let query = db
    .from("video_messages")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (filters.deliveryCondition) {
    query = query.eq("delivery_condition", filters.deliveryCondition as never);
  }
  const term = filters.search ? sanitizeSearch(filters.search) : "";
  if (term) query = query.ilike("title", `%${term}%`);

  const from = (filters.page - 1) * filters.limit;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + filters.limit - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function findById(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
): Promise<VideoRow | null> {
  const { data, error } = await db
    .from("video_messages")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function update(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    delivery_condition?: Database["public"]["Enums"]["delivery_condition"];
  },
): Promise<VideoRow> {
  const { data, error } = await db
    .from("video_messages")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Assignments for a set of videos, resolved with beneficiary names in one pass. */
export async function assignmentsFor(
  db: TypedSupabaseClient,
  userId: string,
  videoIds: readonly string[],
): Promise<Map<string, VideoAssignment[]>> {
  const result = new Map<string, VideoAssignment[]>();
  if (videoIds.length === 0) return result;

  const { data, error } = await db
    .from("beneficiary_assignments")
    .select("id, beneficiary_id, resource_id, created_at")
    .eq("user_id", userId)
    .eq("resource_type", "VIDEO_MESSAGE")
    .in("resource_id", [...videoIds]);
  if (error) throw error;
  if (!data || data.length === 0) return result;

  const { data: beneficiaries, error: beneficiaryError } = await db
    .from("beneficiaries")
    .select("id, name")
    .eq("user_id", userId)
    .in(
      "id",
      data.map((row) => row.beneficiary_id),
    );
  if (beneficiaryError) throw beneficiaryError;

  const names = new Map((beneficiaries ?? []).map((row) => [row.id, row.name]));
  for (const row of data) {
    const list = result.get(row.resource_id) ?? [];
    list.push({
      id: row.id,
      beneficiaryId: row.beneficiary_id,
      beneficiaryName: names.get(row.beneficiary_id) ?? "Beneficiary",
      createdAt: row.created_at,
    });
    result.set(row.resource_id, list);
  }
  return result;
}
