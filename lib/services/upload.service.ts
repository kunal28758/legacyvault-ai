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
import { scanObject, scannerProvider } from "@/lib/services/malware-scanner";
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
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await uploadRepository.setStatus(service, uploadId, "EXPIRED", "The upload window expired.");
    throw ApiError.conflict("CONFLICT", "This upload expired. Start a new one.");
  }

  const kind = session.kind as UploadKind;
  const quarantined = { bucket: BUCKETS.quarantine, key: quarantineKey(user.id, uploadId) };

  const reject = async (reason: string): Promise<UploadOutcome> => {
    await uploadRepository.setStatus(service, uploadId, "REJECTED", reason);
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
      scan: { status: "ERROR", performed: false, provider: null, scannedAt: null },
    };
  };

  await uploadRepository.setStatus(service, uploadId, "VALIDATING");

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
  if (!magicBytesMatch(kind, session.declared_mime_type, head)) {
    return await reject("The file contents do not match the declared file type.");
  }

  await uploadRepository.setStatus(service, uploadId, "SCANNING");
  const scan = await scanObject({
    bucket: quarantined.bucket,
    key: quarantined.key,
    sizeBytes: stat.sizeBytes,
    mimeType: session.declared_mime_type,
  });

  if (scan.verdict === "INFECTED") {
    return await reject("The file was rejected by the malware scanner.");
  }
  if (scan.verdict === "ERROR") {
    return await reject("The file could not be scanned. Try again later.");
  }

  await uploadRepository.setStatus(service, uploadId, "SCANNED_CLEAN");

  const destinationBucket = kind === "VIDEO" ? BUCKETS.videos : BUCKETS.documents;
  const destinationKey = permanentKey(user.id, uploadId);
  await moveObject(quarantined, { bucket: destinationBucket, key: destinationKey });

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
          title: body.title ?? session.declared_name,
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
      mimeType: session.declared_mime_type,
      sizeBytes: stat.sizeBytes,
    } as never,
    p_metadata: metadata as never,
  });
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
      mimeType: session.declared_mime_type,
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
    ...(kind === "VIDEO" ? { videoId: resourceId } : { documentId: resourceId }),
  };
}

export async function getUploadStatus(user: AppUser, uploadId: string): Promise<UploadOutcome> {
  const db = await createUserClient();
  const session = await uploadRepository.findById(db, user.id, uploadId);
  if (!session) throw ApiError.notFound();

  return {
    uploadId: session.id,
    status: session.status,
    rejectionReason: session.rejection_reason,
    scan: {
      status: session.status === "PROMOTED" ? "CLEAN" : "PENDING",
      performed: scannerProvider() !== "noop" && session.status === "PROMOTED",
      provider: scannerProvider(),
      scannedAt: null,
    },
  };
}
