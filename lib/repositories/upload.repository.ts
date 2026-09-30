import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { Database } from "@/lib/types/database";

/**
 * Upload session data access (ADR-005).
 *
 * `upload_sessions` is Class C with SELECT-own: the owner can read their own
 * sessions, but every write goes through the service client from the upload
 * service, which has already proven ownership. That keeps the status machine
 * (PENDING → VALIDATING → SCANNING → SCANNED_CLEAN → PROMOTED, or REJECTED /
 * EXPIRED; UPLOADED marks a file held in quarantine awaiting a retry) out of
 * the browser's reach entirely.
 */
export type UploadSessionRow = Database["public"]["Tables"]["upload_sessions"]["Row"];
export type UploadStatus = Database["public"]["Enums"]["upload_status"];

export interface UploadSessionInsert {
  userId: string;
  kind: Database["public"]["Enums"]["upload_kind"];
  declaredName: string;
  declaredMimeType: string;
  declaredSizeBytes: number;
  folderId: string | null;
  targetDocumentId: string | null;
  expiresAt: string;
}

export async function insert(
  serviceDb: TypedSupabaseClient,
  input: UploadSessionInsert,
): Promise<UploadSessionRow> {
  const { data, error } = await serviceDb
    .from("upload_sessions")
    .insert({
      user_id: input.userId,
      kind: input.kind,
      declared_name: input.declaredName,
      declared_mime_type: input.declaredMimeType,
      declared_size_bytes: input.declaredSizeBytes,
      folder_id: input.folderId,
      target_document_id: input.targetDocumentId,
      expires_at: input.expiresAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function findById(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
): Promise<UploadSessionRow | null> {
  const { data, error } = await db
    .from("upload_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function setStatus(
  serviceDb: TypedSupabaseClient,
  id: string,
  status: UploadStatus,
  rejectionReason?: string | null,
): Promise<void> {
  const { error } = await serviceDb
    .from("upload_sessions")
    .update({ status, rejection_reason: rejectionReason ?? null })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Compare-and-set on the status machine.
 *
 * Moves the session to `to` only while it is still in one of `from` (and, when
 * given, was last touched before `staleBefore`). Returns false when another
 * request got there first, so two concurrent completions cannot both run the
 * pipeline — and a late failure handler cannot overwrite a PROMOTED session.
 */
export async function transition(
  serviceDb: TypedSupabaseClient,
  id: string,
  from: readonly UploadStatus[],
  to: UploadStatus,
  options: { rejectionReason?: string | null; staleBefore?: string } = {},
): Promise<boolean> {
  let query = serviceDb
    .from("upload_sessions")
    .update({ status: to, rejection_reason: options.rejectionReason ?? null })
    .eq("id", id)
    .in("status", [...from]);
  if (options.staleBefore) query = query.lt("updated_at", options.staleBefore);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
