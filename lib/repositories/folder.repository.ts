import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { FolderSummary } from "@/lib/types/document";
import type { Database } from "@/lib/types/database";

/**
 * Folder data access.
 *
 * Folders are Class A: the grant covers INSERT (user_id, parent_id, name) and
 * UPDATE (name, parent_id, deleted_at), and the insert policy additionally
 * requires any parent to belong to the same owner — so a folder cannot be
 * re-parented under somebody else's tree even with a crafted request.
 */
export type FolderRow = Database["public"]["Tables"]["folders"]["Row"];

export async function list(db: TypedSupabaseClient, userId: string): Promise<FolderRow[]> {
  const { data, error } = await db
    .from("folders")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function findById(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
): Promise<FolderRow | null> {
  const { data, error } = await db
    .from("folders")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insert(
  db: TypedSupabaseClient,
  userId: string,
  input: { name: string; parentId: string | null },
): Promise<FolderRow> {
  const { data, error } = await db
    .from("folders")
    .insert({ user_id: userId, name: input.name, parent_id: input.parentId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function update(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
  patch: { name?: string; parent_id?: string | null },
): Promise<FolderRow> {
  const { data, error } = await db
    .from("folders")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Soft delete through the same allow-list; documents inside are left in place. */
export async function softDelete(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await db
    .from("folders")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
}

/** Live document counts per folder, in one query. */
export async function documentCounts(
  db: TypedSupabaseClient,
  userId: string,
): Promise<Map<string, number>> {
  const { data, error } = await db
    .from("documents")
    .select("folder_id")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.folder_id) continue;
    counts.set(row.folder_id, (counts.get(row.folder_id) ?? 0) + 1);
  }
  return counts;
}

export function toFolderSummary(row: FolderRow, documentCount: number): FolderSummary {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    documentCount,
    createdAt: row.created_at,
  };
}
