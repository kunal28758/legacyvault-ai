import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { Database } from "@/lib/types/database";

/**
 * Upload session data access (ADR-005).
 *
 * `upload_sessions` is Class C with SELECT-own: the owner can read their own
 * sessions, but every write goes through the service client from the upload
 * service, which has already proven ownership. That keeps the status machine
 * (PENDING → UPLOADED → SCANNING → SCANNED_CLEAN → PROMOTED / REJECTED) out of
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
