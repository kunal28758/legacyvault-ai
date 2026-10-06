import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type {
  DocumentAttachmentSummary,
  DocumentSummary,
  DocumentVersionSummary,
} from "@/lib/types/document";
import { readDocumentProfile } from "@/lib/validators/document-profile";
import type { Database, Json } from "@/lib/types/database";

/**
 * Document data access (FR-H001–H010).
 *
 * `documents` rows are created only by `promote_upload()` and soft-deleted only
 * by `delete_document()`; the `authenticated` grant covers SELECT plus an
 * UPDATE allow-list of (name, folder_id, metadata). This repository therefore
 * reads and does the one allowed metadata write.
 *
 * `storage_key` and `storage_bucket` are read here because the service needs
 * them to sign a URL, but they are never mapped into a client-facing shape.
 */
export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
export type DocumentVersionRow = Database["public"]["Tables"]["document_versions"]["Row"];

export function toDocumentSummary(
  row: DocumentRow,
  versionCount = 0,
  shareCount = 0,
): DocumentSummary {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    folderId: row.folder_id,
    versionCount,
    shareCount,
    currentVersionId: row.current_version_id,
    profile: readDocumentProfile(row.metadata),
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

export interface DocumentListFilters {
  folderId?: string;
  search?: string;
  page: number;
  limit: number;
}

export async function list(
  db: TypedSupabaseClient,
  userId: string,
  filters: DocumentListFilters,
): Promise<{ rows: DocumentRow[]; total: number }> {
  let query = db
    .from("documents")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (filters.folderId) query = query.eq("folder_id", filters.folderId);

  const term = filters.search ? sanitizeSearch(filters.search) : "";
  if (term) query = query.ilike("name", `%${term}%`);

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
): Promise<DocumentRow | null> {
  const { data, error } = await db
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Class A metadata write: exactly the columns the grant allows. */
export async function updateMetadata(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
  patch: { name?: string; folder_id?: string | null; metadata?: Json },
): Promise<DocumentRow> {
  const { data, error } = await db
    .from("documents")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listVersions(
  db: TypedSupabaseClient,
  documentId: string,
  currentVersionId: string | null,
): Promise<DocumentVersionSummary[]> {
  const { data, error } = await db
    .from("document_versions")
    .select("id, version_number, size_bytes, created_at")
    .eq("document_id", documentId)
    .order("version_number", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    isCurrent: row.id === currentVersionId,
  }));
}

export async function findVersion(
  db: TypedSupabaseClient,
  documentId: string,
  versionId: string,
): Promise<DocumentVersionRow | null> {
  const { data, error } = await db
    .from("document_versions")
    .select("*")
    .eq("id", versionId)
    .eq("document_id", documentId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Version counts for a page of documents, in one query rather than per row. */
export async function versionCounts(
  db: TypedSupabaseClient,
  documentIds: readonly string[],
): Promise<Map<string, number>> {
  if (documentIds.length === 0) return new Map();
  const { data, error } = await db
    .from("document_versions")
    .select("document_id")
    .in("document_id", [...documentIds]);
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.document_id, (counts.get(row.document_id) ?? 0) + 1);
  }
  return counts;
}

/** Share counts for a page of documents, in one query rather than per row. */
export async function shareCounts(
  db: TypedSupabaseClient,
  userId: string,
  documentIds: readonly string[],
): Promise<Map<string, number>> {
  if (documentIds.length === 0) return new Map();
  const { data, error } = await db
    .from("beneficiary_assignments")
    .select("resource_id")
    .eq("user_id", userId)
    .eq("resource_type", "DOCUMENT")
    .in("resource_id", [...documentIds]);
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.resource_id, (counts.get(row.resource_id) ?? 0) + 1);
  }
  return counts;
}

export async function listAttachments(
  db: TypedSupabaseClient,
  userId: string,
  documentId: string,
): Promise<DocumentAttachmentSummary[]> {
  const { data, error } = await db
    .from("document_attachments")
    .select("id, resource_type, resource_id, created_at")
    .eq("user_id", userId)
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    createdAt: row.created_at,
  }));
}

/** Documents attached to one resource — used by the plan and asset detail views. */
export async function listAttachedDocumentIds(
  db: TypedSupabaseClient,
  userId: string,
  resourceType: string,
  resourceId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from("document_attachments")
    .select("document_id")
    .eq("user_id", userId)
    .eq("resource_type", resourceType as never)
    .eq("resource_id", resourceId);
  if (error) throw error;
  return (data ?? []).map((row) => row.document_id);
}

export async function findAttachmentByResource(
  db: TypedSupabaseClient,
  userId: string,
  documentId: string,
  resourceType: string,
  resourceId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from("document_attachments")
    .select("id")
    .eq("user_id", userId)
    .eq("document_id", documentId)
    .eq("resource_type", resourceType as never)
    .eq("resource_id", resourceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
