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
import { SCAN_ERROR_MESSAGES, scanObject, scannerProvider } from "@/lib/services/malware-scanner";
import {
  magicBytesMatch,
  maxBytesFor,
  validateDeclaredFile,
  type UploadKind,
} from "@/lib/security/file-validation";
import {
  BUCKETS,
  createSignedUploadUrl,
  moveObject,
  permanentKey,
  quarantineKey,
  readObjectHead,
  removeObject,
  statObject,
} from "@/lib/storage/storage";
import type { ScanInfo, UploadOutcome, UploadTicket } from "@/lib/types/document";
import type { UploadCompleteBody, UploadSessionBody } from "@/lib/validators/document.validators";

/**
 * Two-step upload (ADR-005, FR-H002/H003).
 *
 *   1. `createUploadSession` validates what the browser *claims*, records a
 *      session and hands back a signed URL into the private quarantine bucket.
 *      The key is derived from the owner id and the session id, so the browser
 *      never chooses a path.
 *   2. `completeUpload` measures what actually arrived — real size, leading
 *      bytes — runs the malware-scan boundary, and only then moves the object
 *      into its permanent bucket and calls `promote_upload()`.
 *
 * Nothing exists as a Document until step 2 succeeds, and a rejected object is
 * deleted from quarantine rather than left behind.
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
    BUCKETS.quarantine,
    quarantineKey(user.id, session.id),
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
const IN_PROGRESS: readonly UploadStatus[] = ["VALIDATING", "SCANNING", "SCANNED_CLEAN"];
/**
 * A session that has sat mid-pipeline this long belongs to a request that died
 * (the longest scan is bounded well below it), so a retry may reclaim it.
 */
export const STALE_IN_PROGRESS_MS = 6 * 60_000;

const RETRY_HINT = "Your file is held securely in quarantine — try again.";

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
  const quarantined = { bucket: BUCKETS.quarantine, key: quarantineKey(user.id, uploadId) };

  if (session.status === "EXPIRED" || new Date(session.expires_at).getTime() < Date.now()) {
    await uploadRepository.transition(
      service,
      uploadId,
      [...CLAIMABLE, ...IN_PROGRESS],
      "EXPIRED",
      {
        rejectionReason: "The upload window expired.",
      },
    );
    await removeObject(quarantined.bucket, quarantined.key).catch((cause: unknown) =>
      logger.warn({ err: cause, uploadId }, "expired upload cleanup skipped"),
    );
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
      scan: { status: "PENDING", performed: false, provider: null, scannedAt: null },
      retryable: false,
      inProgress: true,
    };
  }

  const reject = async (
    reason: string,
    scan: ScanInfo = { status: "ERROR", performed: false, provider: null, scannedAt: null },
  ): Promise<UploadOutcome> => {
    await uploadRepository.transition(service, uploadId, IN_PROGRESS, "REJECTED", {
      rejectionReason: reason,
    });
    // A rejected object must not linger in quarantine.
    await removeObject(quarantined.bucket, quarantined.key).catch((cause: unknown) =>
      logger.error({ err: cause, uploadId }, "failed to remove rejected upload"),
    );
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
      scan,
      retryable: false,
      inProgress: false,
    };
  };

  try {
    return await runPipeline();
  } catch (cause) {
    // Anything unexpected hands the session back as retryable rather than
    // leaving it mid-pipeline. The file stays in quarantine, unpromoted.
    await uploadRepository
      .transition(service, uploadId, IN_PROGRESS, "UPLOADED", {
        rejectionReason: `Something went wrong while securing your file. ${RETRY_HINT}`,
      })
      .catch((releaseError: unknown) =>
        logger.error({ err: releaseError, uploadId }, "failed to release upload session"),
      );
    throw cause;
  }

  async function runPipeline(): Promise<UploadOutcome> {
    const stat = await statObject(quarantined.bucket, quarantined.key);
    if (!stat || stat.sizeBytes <= 0) {
      return await reject("No file was uploaded.");
    }
    if (stat.sizeBytes > maxBytesFor(kind)) {
      return await reject("The uploaded file is larger than the limit for its type.");
    }

    // The declared type has to match the bytes that arrived — a renamed
    // executable is caught here, not by trusting the browser's Content-Type.
    const head = await readObjectHead(quarantined.bucket, quarantined.key);
    if (!magicBytesMatch(kind, row.declared_mime_type, head)) {
      return await reject("The file contents do not match the declared file type.");
    }

    await uploadRepository.setStatus(service, uploadId, "SCANNING");
    const scan = await scanObject({
      bucket: quarantined.bucket,
      key: quarantined.key,
      sizeBytes: stat.sizeBytes,
      mimeType: row.declared_mime_type,
    });

    if (scan.verdict === "INFECTED") {
      return await reject("The file was rejected by the malware scanner.", {
        status: "INFECTED",
        performed: true,
        provider: scan.provider,
        scannedAt: scan.scannedAt,
      });
    }
    if (scan.verdict === "ERROR") {
      const reason = SCAN_ERROR_MESSAGES[scan.errorReason ?? "UNAVAILABLE"];
      // A file too large for the scanner will never pass; anything else
      // (scanner down, timeout) is worth retrying. Never treated as clean.
      if (scan.errorReason === "SIZE_LIMIT") return await reject(reason);

      await uploadRepository.transition(service, uploadId, IN_PROGRESS, "UPLOADED", {
        rejectionReason: `${reason} ${RETRY_HINT}`,
      });
      await audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: "upload.scan_failed",
        resourceType: "upload_session",
        resourceId: uploadId,
        outcome: "FAILURE",
        metadata: { reason: scan.errorReason ?? "UNAVAILABLE", kind: row.kind },
        correlationId,
      });
      return {
        uploadId,
        status: "UPLOADED",
        rejectionReason: `${reason} ${RETRY_HINT}`,
        scan: { status: "ERROR", performed: false, provider: scan.provider, scannedAt: null },
        retryable: true,
        inProgress: false,
      };
    }

    await uploadRepository.setStatus(service, uploadId, "SCANNED_CLEAN");

    const destinationBucket = kind === "VIDEO" ? BUCKETS.videos : BUCKETS.documents;
    const destinationKey = permanentKey(user.id, uploadId);
    const destination = { bucket: destinationBucket, key: destinationKey };
    await moveObject(quarantined, destination);

    // Recorded on the row so the UI can say "not scanned" truthfully when the
    // environment has no scanner configured (ADR-015).
    const scanRecord = {
      performed: scan.performed,
      provider: scan.provider,
      scannedAt: scan.scannedAt,
      verdict: scan.verdict,
    };

    const metadata =
      kind === "VIDEO"
        ? {
            title: body.title ?? row.declared_name,
            description: body.description ?? null,
            deliveryCondition: body.deliveryCondition ?? "IMMEDIATE",
            metadata: { scan: scanRecord },
          }
        : { document: { scan: scanRecord } };

    const { data, error } = await service.rpc("promote_upload", {
      p_upload_id: uploadId,
      p_target: {
        bucket: destinationBucket,
        key: destinationKey,
        mimeType: row.declared_mime_type,
        sizeBytes: stat.sizeBytes,
      } as never,
      p_metadata: metadata as never,
    });
    if (error) {
      // Put the bytes back where a retry expects them, so a failed promotion
      // never leaves an object in the vault with no row pointing at it.
      await moveObject(destination, quarantined).catch((cause: unknown) =>
        logger.error({ err: cause, uploadId }, "failed to return object to quarantine"),
      );
      throw error;
    }

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
        scanPerformed: scan.performed,
        scanProvider: scan.provider,
      },
      correlationId,
    });

    const scanInfo: ScanInfo = {
      status: "CLEAN",
      performed: scan.performed,
      provider: scan.provider,
      scannedAt: scan.scannedAt,
    };

    return {
      uploadId,
      status: "PROMOTED",
      rejectionReason: null,
      scan: scanInfo,
      retryable: false,
      inProgress: false,
      ...(kind === "VIDEO" ? { videoId: resourceId } : { documentId: resourceId }),
    };
  }
}

/**
 * The session as it stands, for a browser that lost its connection mid-upload
 * or is waiting on another request's scan. A session abandoned mid-pipeline is
 * reported as retryable rather than as "still scanning", so no screen can show
 * an endless spinner.
 */
export async function getUploadStatus(user: AppUser, uploadId: string): Promise<UploadOutcome> {
  const db = await createUserClient();
  const session = await uploadRepository.findById(db, user.id, uploadId);
  if (!session) throw ApiError.notFound();

  const provider = scannerProvider();
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
    scan: {
      status:
        session.status === "PROMOTED"
          ? "CLEAN"
          : session.status === "UPLOADED" && session.rejection_reason
            ? "ERROR"
            : "PENDING",
      performed: provider !== "noop" && session.status === "PROMOTED",
      provider,
      scannedAt: null,
    },
    retryable: !expired && (stale || session.status === "UPLOADED" || session.status === "PENDING"),
    inProgress: inProgress && !stale,
  };
}
