import "server-only";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createServiceClient, createUserClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";
import * as documentRepository from "@/lib/repositories/document.repository";
import * as folderRepository from "@/lib/repositories/folder.repository";
import * as uploadRepository from "@/lib/repositories/upload.repository";
import type { UploadStatus } from "@/lib/repositories/upload.repository";
import {
  magicBytesMatch,
  maxBytesFor,
  validateDeclaredFile,
  type UploadKind,
} from "@/lib/security/file-validation";
import {
  createSignedUploadUrl,
  readObjectHead,
  removeObject,
  statObject,
  uploadBucketFor,
  uploadObjectKey,
} from "@/lib/storage/storage";
import type { UploadOutcome, UploadTicket } from "@/lib/types/document";
import type { UploadCompleteBody, UploadSessionBody } from "@/lib/validators/document.validators";

/**
 * Two-step upload (ADR-005, FR-H002/H003).
 *
 *   1. `createUploadSession` validates what the browser *claims*, records a
 *      session and hands back a signed URL straight into the private bucket
 *      for the upload's kind (`documents` or `videos`). The key is derived
 *      from the owner id and the session id, so the browser never chooses a
 *      path, and the bucket's own size limit and MIME allow-list apply to the
 *      bytes it sends.
 *   2. `completeUpload` measures what actually arrived — real size, leading
 *      bytes — and only then calls `promote_upload()`, which creates the row
 *      that makes the object reachable.
 *
 * No malware scanner runs, and nothing claims one did: promoted rows record
 * `scan_status = NOT_SCANNED`. Nothing exists as a Document until step 2
 * succeeds — an object with no row behind it cannot be downloaded, shared or
 * released — and a rejected object is deleted rather than left behind.
 */
const SESSION_TTL_MINUTES = 60;

export async function createUploadSession(
  user: AppUser,
  body: UploadSessionBody,
  correlationId: string,
): Promise<UploadTicket> {
  assertAccountActive(user);
  const db = await createUserClient();
  const kind = body.kind as UploadKind;

  const validated = validateDeclaredFile(kind, {
    name: body.name,
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
  });
  if (!validated.ok) {
    throw ApiError.validation({ [validated.failure.field]: [validated.failure.reason] });
  }

  // Both optional references must belong to the caller before a URL is minted.
  if (body.folderId) {
    const folder = await folderRepository.findById(db, user.id, body.folderId);
    if (!folder) throw ApiError.notFound("That folder does not exist.");
  }
  let targetDocumentId: string | null = null;
  if (kind === "DOCUMENT_VERSION") {
    if (!body.documentId) {
      throw ApiError.validation({ documentId: ["Choose the document this version replaces."] });
    }
    const target = await documentRepository.findById(db, user.id, body.documentId);
    if (!target) throw ApiError.notFound("That document does not exist.");
    targetDocumentId = target.id;
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000).toISOString();
  const session = await uploadRepository.insert(createServiceClient(), {
    userId: user.id,
    kind: body.kind,
    declaredName: validated.name,
    declaredMimeType: body.mimeType,
    declaredSizeBytes: body.sizeBytes,
    folderId: body.folderId ?? null,
    targetDocumentId,
    expiresAt,
  });

  const upload = await createSignedUploadUrl(
    uploadBucketFor(kind),
    uploadObjectKey(user.id, session.id),
  );

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "upload.session_created",
    resourceType: "upload_session",
    resourceId: session.id,
    outcome: "SUCCESS",
    metadata: { kind: body.kind, declaredSizeBytes: body.sizeBytes, mimeType: body.mimeType },
    correlationId,
  });

  return {
    uploadId: session.id,
    uploadUrl: upload.url,
    token: upload.token,
    expiresAt,
    declaredName: validated.name,
    maxBytes: maxBytesFor(kind),
  };
}

/** Statuses a completion request may claim the session from. */
const CLAIMABLE: readonly UploadStatus[] = ["PENDING", "UPLOADED"];
/** Statuses that mean a completion request is (or was) working on the session. */
const IN_PROGRESS: readonly UploadStatus[] = ["VALIDATING", "VALIDATED"];
/**
 * A session that has sat mid-pipeline this long belongs to a request that died
 * (completion is a size check, a few-KB read and one database call, and the
 * route is capped at 60 s), so a retry may reclaim it.
 */
export const STALE_IN_PROGRESS_MS = 2 * 60_000;

const RETRY_HINT = "Your file is held privately and has not been added to your vault — try again.";

function isStale(updatedAt: string, now = Date.now()): boolean {
  return now - Date.parse(updatedAt) > STALE_IN_PROGRESS_MS;
}

export async function completeUpload(
  user: AppUser,
  uploadId: string,
  body: UploadCompleteBody,
  correlationId: string,
): Promise<UploadOutcome> {
  assertAccountActive(user);
  const db = await createUserClient();
  const service = createServiceClient();

  const session = await uploadRepository.findById(db, user.id, uploadId);
  if (!session) throw ApiError.notFound();
  if (session.status === "PROMOTED") {
    throw ApiError.conflict("CONFLICT", "This upload has already been completed.");
  }
  if (session.status === "REJECTED") {
    throw ApiError.conflict("CONFLICT", "This upload was rejected and cannot be completed.");
  }

  // Narrowed once here so the pipeline below, a nested function, can use it.
  const row = session;
  const kind = session.kind as UploadKind;
  const object = { bucket: uploadBucketFor(kind), key: uploadObjectKey(user.id, uploadId) };

  if (session.status === "EXPIRED" || new Date(session.expires_at).getTime() < Date.now()) {
    const closed = await uploadRepository.transition(
      service,
      uploadId,
      [...CLAIMABLE, ...IN_PROGRESS],
      "EXPIRED",
      { rejectionReason: "The upload window expired." },
    );
    // Only the request that closed the session removes its object, so a late
    // request can never delete bytes another one has just promoted.
    if (closed) {
      await removeObject(object.bucket, object.key).catch((cause: unknown) =>
        logger.warn({ err: cause, uploadId }, "expired upload cleanup skipped"),
      );
    }
    throw ApiError.conflict("CONFLICT", "This upload expired. Start a new one.");
  }

  // Claim the session atomically. Only one completion runs the pipeline; a
  // second one (a double click, a retry racing the first) is told it is in
  // progress instead of promoting the same object twice.
  const claimed =
    (await uploadRepository.transition(service, uploadId, CLAIMABLE, "VALIDATING")) ||
    (await uploadRepository.transition(service, uploadId, IN_PROGRESS, "VALIDATING", {
      staleBefore: new Date(Date.now() - STALE_IN_PROGRESS_MS).toISOString(),
    }));
  if (!claimed) {
    return {
      uploadId,
      status: session.status,
      rejectionReason: null,
      retryable: false,
      inProgress: true,
    };
  }

  const reject = async (reason: string): Promise<UploadOutcome> => {
    const stillOurs = await uploadRepository.transition(
      service,
      uploadId,
      IN_PROGRESS,
      "REJECTED",
      {
        rejectionReason: reason,
      },
    );
    // A rejected object never becomes a document, so it is not kept — unless
    // another request has taken the session over, in which case it decides.
    if (stillOurs) {
      await removeObject(object.bucket, object.key).catch((cause: unknown) =>
        logger.error({ err: cause, uploadId }, "failed to remove rejected upload"),
      );
    }
    await audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: "upload.rejected",
      resourceType: "upload_session",
      resourceId: uploadId,
      outcome: "FAILURE",
      metadata: { reason, kind: session.kind },
      correlationId,
    });
    return {
      uploadId,
      status: "REJECTED",
      rejectionReason: reason,
      retryable: false,
      inProgress: false,
    };
  };

  try {
    return await runPipeline();
  } catch (cause) {
    // Anything unexpected hands the session back as retryable rather than
    // leaving it mid-pipeline. The object stays where it is, unpromoted.
    await uploadRepository
      .transition(service, uploadId, IN_PROGRESS, "UPLOADED", {
        rejectionReason: `Something went wrong while saving your file. ${RETRY_HINT}`,
      })
      .catch((releaseError: unknown) =>
        logger.error({ err: releaseError, uploadId }, "failed to release upload session"),
      );
    throw cause;
  }

  async function runPipeline(): Promise<UploadOutcome> {
    const stat = await statObject(object.bucket, object.key);
    if (!stat || stat.sizeBytes <= 0) {
      return await reject("No file was uploaded.");
    }
    if (stat.sizeBytes > maxBytesFor(kind)) {
      return await reject("The uploaded file is larger than the limit for its type.");
    }

    // The declared type has to match the bytes that arrived — a renamed
    // executable is caught here, not by trusting the browser's Content-Type.
    const head = await readObjectHead(object.bucket, object.key);
    if (!magicBytesMatch(kind, row.declared_mime_type, head)) {
      return await reject("The file contents do not match the declared file type.");
    }

    // `promote_upload()` accepts only a VALIDATED session. Moving there is a
    // compare-and-set too, so a request that lost its claim cannot promote.
    const validated = await uploadRepository.transition(
      service,
      uploadId,
      ["VALIDATING"],
      "VALIDATED",
    );
    if (!validated) {
      return {
        uploadId,
        status: "VALIDATING",
        rejectionReason: null,
        retryable: false,
        inProgress: true,
      };
    }

    const metadata =
      kind === "VIDEO"
        ? {
            title: body.title ?? row.declared_name,
            description: body.description ?? null,
            deliveryCondition: body.deliveryCondition ?? "IMMEDIATE",
            metadata: {},
          }
        : { document: {} };

    const { data, error } = await service.rpc("promote_upload", {
      p_upload_id: uploadId,
      p_target: {
        bucket: object.bucket,
        key: object.key,
        mimeType: row.declared_mime_type,
        sizeBytes: stat.sizeBytes,
      } as never,
      p_metadata: metadata as never,
    });
    // The object stays at its key either way; a retry finds it there.
    if (error) throw error;

    const resourceId = data as string;
    await audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: kind === "VIDEO" ? "video.uploaded" : "document.uploaded",
      resourceType: kind === "VIDEO" ? "video_message" : "document",
      resourceId,
      outcome: "SUCCESS",
      metadata: {
        uploadId,
        sizeBytes: stat.sizeBytes,
        mimeType: row.declared_mime_type,
      },
      correlationId,
    });

    return {
      uploadId,
      status: "PROMOTED",
      rejectionReason: null,
      retryable: false,
      inProgress: false,
      ...(kind === "VIDEO" ? { videoId: resourceId } : { documentId: resourceId }),
    };
  }
}

/**
 * The session as it stands, for a browser that lost its connection mid-upload
 * or is waiting on another request's completion. A session abandoned
 * mid-pipeline is reported as retryable rather than as still in progress, so no
 * screen can show an endless spinner.
 */
export async function getUploadStatus(user: AppUser, uploadId: string): Promise<UploadOutcome> {
  const db = await createUserClient();
  const session = await uploadRepository.findById(db, user.id, uploadId);
  if (!session) throw ApiError.notFound();

  const expired =
    session.status === "EXPIRED" ||
    (session.status !== "PROMOTED" &&
      session.status !== "REJECTED" &&
      Date.parse(session.expires_at) < Date.now());
  const inProgress = !expired && IN_PROGRESS.includes(session.status);
  const stale = inProgress && isStale(session.updated_at);

  return {
    uploadId: session.id,
    status: expired ? "EXPIRED" : session.status,
    rejectionReason: expired
      ? "The upload window expired. Start a new upload."
      : stale
        ? `The previous attempt stopped before finishing. ${RETRY_HINT}`
        : session.rejection_reason,
    retryable: !expired && (stale || session.status === "UPLOADED" || session.status === "PENDING"),
    inProgress: inProgress && !stale,
  };
}
