import "server-only";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createUserClient } from "@/lib/db/server";
import { mergeDocumentProfile } from "@/lib/validators/document-profile";
import type { Json } from "@/lib/types/database";
import * as documentRepository from "@/lib/repositories/document.repository";
import * as folderRepository from "@/lib/repositories/folder.repository";
import * as accessService from "@/lib/services/access.service";
import { BUCKETS, createSignedDownloadUrl, type BucketName } from "@/lib/storage/storage";
import type {
  DocumentDetail,
  DocumentListResult,
  DocumentShare,
  DocumentSummary,
  SignedAccess,
} from "@/lib/types/document";
import type {
  DocumentAttachBody,
  DocumentListQuery,
  DocumentUpdateBody,
} from "@/lib/validators/document.validators";

/**
 * Vault documents (FR-H001–H010).
 *
 * Rows are created by `promote_upload()` and soft-deleted by
 * `delete_document()`, which also removes shares and attachments and queues the
 * object removal in the same transaction. Between those two the owner may
 * rename a document or move it between folders — the Class A allow-list.
 *
 * Every read of the bytes goes through `accessDocument`, which authorises
 * first, signs a short-lived URL second, and audits the fact that the document
 * was opened.
 */
export async function listDocuments(
  user: AppUser,
  query: DocumentListQuery,
): Promise<DocumentListResult> {
  const db = await createUserClient();
  const { rows, total } = await documentRepository.list(db, user.id, {
    folderId: query.folderId,
    search: query.q,
    page: query.page,
    limit: query.limit,
  });

  const ids = rows.map((row) => row.id);
  const [counts, shares, attachments] = await Promise.all([
    documentRepository.versionCounts(db, ids),
    documentRepository.shareCounts(db, user.id, ids),
    documentRepository.attachmentsFor(db, user.id, ids),
  ]);

  return {
    items: rows.map((row) =>
      documentRepository.toDocumentSummary(
        row,
        counts.get(row.id) ?? 1,
        shares.get(row.id) ?? 0,
        attachments.get(row.id) ?? [],
      ),
    ),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getDocument(user: AppUser, id: string): Promise<DocumentDetail> {
  const db = await createUserClient();
  const row = await documentRepository.findById(db, user.id, id);
  if (!row) throw ApiError.notFound();

  const [versions, attachments, shares] = await Promise.all([
    documentRepository.listVersions(db, id, row.current_version_id),
    documentRepository.listAttachments(db, user.id, id),
    listShares(db, user.id, id),
  ]);

  return {
    ...documentRepository.toDocumentSummary(row, versions.length, shares.length, attachments),
    versions,
    shares,
  };
}

export async function updateDocument(
  user: AppUser,
  id: string,
  body: DocumentUpdateBody,
  correlationId: string,
): Promise<DocumentSummary> {
  assertAccountActive(user);
  const db = await createUserClient();

  const before = await documentRepository.findById(db, user.id, id);
  if (!before) throw ApiError.notFound();

  const patch: { name?: string; folder_id?: string | null; metadata?: Json } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.folderId !== undefined) {
    if (body.folderId) {
      const folder = await folderRepository.findById(db, user.id, body.folderId);
      if (!folder) throw ApiError.notFound("That folder does not exist.");
    }
    patch.folder_id = body.folderId;
  }
  if (body.profile !== undefined) {
    patch.metadata = mergeDocumentProfile(before.metadata, body.profile) as Json;
  }

  const updated = await documentRepository.updateMetadata(db, user.id, id, patch);
  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "document.updated",
    resourceType: "document",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { changed: Object.keys(patch) },
    correlationId,
  });

  const [versions, shares, attachments] = await Promise.all([
    documentRepository.listVersions(db, id, updated.current_version_id),
    listShares(db, user.id, id),
    documentRepository.listAttachments(db, user.id, id),
  ]);
  return documentRepository.toDocumentSummary(updated, versions.length, shares.length, attachments);
}

export async function deleteDocument(
  user: AppUser,
  id: string,
  correlationId: string,
): Promise<{ id: string }> {
  assertAccountActive(user);
  const db = await createUserClient();

  // One transaction: shares removed, attachments removed, row soft-deleted, an
  // object-removal job queued, audit written.
  const { error } = await db.rpc("delete_document", { p_document_id: id, p_corr: correlationId });
  if (error) throw error;
  return { id };
}

/**
 * Signs a short-lived URL for the owner to open a document.
 *
 * Authorisation happens against the row before anything is signed, the link
 * expires in minutes, and the read is audited — a download is a security event
 * even when the person doing it owns the file.
 */
export async function accessDocument(
  user: AppUser,
  id: string,
  options: { versionId?: string; disposition?: "inline" | "attachment" },
  correlationId: string,
): Promise<SignedAccess> {
  const db = await createUserClient();
  const row = await documentRepository.findById(db, user.id, id);
  if (!row) throw ApiError.notFound();

  let key = row.storage_key;
  let versionNumber: number | null = null;
  if (options.versionId) {
    const version = await documentRepository.findVersion(db, id, options.versionId);
    if (!version) throw ApiError.notFound();
    key = version.storage_key;
    versionNumber = version.version_number;
  }

  const signed = await createSignedDownloadUrl(row.storage_bucket as BucketName, key, {
    downloadAs: options.disposition === "attachment" ? row.name : undefined,
  });

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "document.accessed",
    resourceType: "document",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: {
      disposition: options.disposition ?? "inline",
      versionId: options.versionId ?? null,
      versionNumber,
    },
    correlationId,
  });

  return { url: signed.url, expiresAt: signed.expiresAt, name: row.name, mimeType: row.mime_type };
}

/* ── Attachments (Class B) ────────────────────────────────────────────────── */

export async function attachDocument(
  user: AppUser,
  id: string,
  body: DocumentAttachBody,
  correlationId: string,
): Promise<{ attachmentId: string }> {
  assertAccountActive(user);
  const db = await createUserClient();

  // attach_document() re-checks that both sides belong to the caller.
  const { data, error } = await db.rpc("attach_document", {
    p_document_id: id,
    p_resource_type: body.resourceType,
    p_resource_id: body.resourceId,
    p_corr: correlationId,
  });
  if (error) throw error;
  return { attachmentId: data as string };
}

export async function detachDocument(
  user: AppUser,
  id: string,
  attachmentId: string,
  correlationId: string,
): Promise<{ id: string }> {
  assertAccountActive(user);
  const db = await createUserClient();

  const attachments = await documentRepository.listAttachments(db, user.id, id);
  if (!attachments.some((attachment) => attachment.id === attachmentId)) throw ApiError.notFound();

  const { error } = await db.rpc("detach_document", {
    p_attachment_id: attachmentId,
    p_corr: correlationId,
  });
  if (error) throw error;
  return { id: attachmentId };
}

/* ── Sharing with a beneficiary (Class B assignment) ──────────────────────── */

export async function shareDocument(
  user: AppUser,
  id: string,
  beneficiaryId: string,
  correlationId: string,
): Promise<{ shares: DocumentShare[]; accessEmailSent: boolean }> {
  assertAccountActive(user);
  const db = await createUserClient();

  const document = await documentRepository.findById(db, user.id, id);
  if (!document) throw ApiError.notFound();

  const { data: beneficiary, error: beneficiaryError } = await db
    .from("beneficiaries")
    .select("id, status")
    .eq("id", beneficiaryId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (beneficiaryError) throw beneficiaryError;
  if (!beneficiary) throw ApiError.notFound();
  if (beneficiary.status === "INACTIVE") {
    throw ApiError.invariant(
      "BENEFICIARY_INACTIVE",
      "Inactive beneficiaries cannot receive assignments or access.",
    );
  }

  // Documents are shared without a percentage — allocation is an asset concept.
  const { error } = await db.rpc("assign_beneficiary", {
    p_beneficiary_id: beneficiaryId,
    p_resource_type: "DOCUMENT",
    p_resource_id: id,
    p_corr: correlationId,
  });
  if (error) throw error;

  // The share is recorded; the beneficiary's link is emailed after it and its
  // failure never undoes the share.
  const { emailSent } = await accessService.issueDocumentShareLink(
    user,
    beneficiaryId,
    correlationId,
  );
  return { shares: await listShares(db, user.id, id), accessEmailSent: emailSent };
}

export async function unshareDocument(
  user: AppUser,
  id: string,
  beneficiaryId: string,
  correlationId: string,
): Promise<DocumentShare[]> {
  assertAccountActive(user);
  const db = await createUserClient();

  const shares = await listShares(db, user.id, id);
  const share = shares.find((entry) => entry.beneficiaryId === beneficiaryId);
  if (!share) throw ApiError.notFound();

  const { error } = await db.rpc("unassign_beneficiary", {
    p_assignment_id: share.assignmentId,
    p_corr: correlationId,
  });
  if (error) throw error;

  return listShares(db, user.id, id);
}

async function listShares(
  db: Awaited<ReturnType<typeof createUserClient>>,
  userId: string,
  documentId: string,
): Promise<DocumentShare[]> {
  const { data, error } = await db
    .from("beneficiary_assignments")
    .select("id, beneficiary_id, created_at")
    .eq("user_id", userId)
    .eq("resource_type", "DOCUMENT")
    .eq("resource_id", documentId);
  if (error) throw error;
  if (!data || data.length === 0) return [];

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
  return data.map((row) => ({
    assignmentId: row.id,
    beneficiaryId: row.beneficiary_id,
    beneficiaryName: names.get(row.beneficiary_id) ?? "Beneficiary",
    createdAt: row.created_at,
  }));
}

/** Bucket a document lives in — used by the object-removal job. */
export const DOCUMENT_BUCKET: BucketName = BUCKETS.documents;
