import "server-only";

import { ApiError } from "@/lib/api/errors";
import { createServiceClient } from "@/lib/db/server";

/**
 * Private object storage (ADR-005).
 *
 * Every bucket is private and carries no storage RLS policy for
 * `authenticated`, so a browser session token cannot reach an object at all.
 * The only ways in or out are the short-lived signed URLs minted here, always
 * after a service has proven the caller owns the row that points at the object.
 *
 * Object keys are derived server-side from the authenticated owner id and a
 * fresh UUID. The browser never supplies a path, so a crafted filename cannot
 * traverse out of its owner's prefix or collide with another owner's object.
 */
export const BUCKETS = {
  documents: "documents",
  videos: "videos",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

/** The private bucket an upload of this kind is written to, and stays in. */
export function uploadBucketFor(kind: "DOCUMENT" | "DOCUMENT_VERSION" | "VIDEO"): BucketName {
  return kind === "VIDEO" ? BUCKETS.videos : BUCKETS.documents;
}

/** How long a download link stays valid (FR-H007: short-lived, single purpose). */
export const DOWNLOAD_URL_TTL_SECONDS = 900; // 15 minutes
/** An upload URL only has to survive the upload itself. */
export const UPLOAD_URL_TTL_SECONDS = 3600; // 1 hour, matching the session expiry

export interface SignedUpload {
  bucket: BucketName;
  key: string;
  url: string;
  token: string;
  expiresInSeconds: number;
}

/**
 * The object key for an upload session.
 *
 * Shape: `<ownerId>/<uploadId>`, derived rather than stored — the session row
 * has no key column, and deriving it means there is nothing to tamper with.
 * The original filename is deliberately not part of the path: it lives in a
 * column, so nothing a user types can influence where an object is written.
 *
 * The browser writes to this key in the private bucket for the upload's kind,
 * and the object stays there once promoted. Until `promote_upload()` creates a
 * row pointing at it, no download URL can be minted for it.
 */
export function uploadObjectKey(ownerId: string, uploadId: string): string {
  return `${ownerId}/${uploadId}`;
}

function storage() {
  // Service role: the browser has no storage credentials of its own.
  return createServiceClient().storage;
}

export async function createSignedUploadUrl(
  bucket: BucketName,
  key: string,
): Promise<SignedUpload> {
  const { data, error } = await storage().from(bucket).createSignedUploadUrl(key);
  if (error || !data) throw ApiError.internal(error ?? new Error("signed upload url failed"));
  return {
    bucket,
    key,
    url: data.signedUrl,
    token: data.token,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  };
}

export async function createSignedDownloadUrl(
  bucket: BucketName,
  key: string,
  options: { expiresInSeconds?: number; downloadAs?: string } = {},
): Promise<{ url: string; expiresAt: string }> {
  const ttl = options.expiresInSeconds ?? DOWNLOAD_URL_TTL_SECONDS;
  const { data, error } = await storage()
    .from(bucket)
    .createSignedUrl(key, ttl, options.downloadAs ? { download: options.downloadAs } : undefined);
  if (error || !data) throw ApiError.internal(error ?? new Error("signed download url failed"));
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
}

/** Size and content type as storage actually recorded them, not as declared. */
export async function statObject(
  bucket: BucketName,
  key: string,
): Promise<{ sizeBytes: number; contentType: string | null } | null> {
  const lastSlash = key.lastIndexOf("/");
  const prefix = lastSlash === -1 ? "" : key.slice(0, lastSlash);
  const name = key.slice(lastSlash + 1);

  const { data, error } = await storage().from(bucket).list(prefix, { search: name, limit: 100 });
  if (error) throw ApiError.internal(error);

  const match = data?.find((entry) => entry.name === name);
  if (!match) return null;

  const metadata = (match.metadata ?? {}) as { size?: number; mimetype?: string };
  return {
    sizeBytes: typeof metadata.size === "number" ? metadata.size : 0,
    contentType: metadata.mimetype ?? null,
  };
}

/** Upper bound for reading an object's leading bytes; the read is a few KB. */
export const OBJECT_HEAD_TIMEOUT_MS = 15_000;

/**
 * Reads the first bytes of an object without downloading the whole thing.
 *
 * Used for magic-byte sniffing: a 50 MB file must not be pulled into memory to
 * learn what its first four bytes are. The `Range` header bounds the response,
 * so the body is read whole with `arrayBuffer()` and trimmed.
 *
 * It deliberately does not stream and cancel. Inside a Route Handler `fetch` is
 * the Next.js-patched one, which can tee the response body; cancelling one
 * branch of a tee does not settle while the other branch is open, so a
 * completion request could hang forever. A server that ignores `Range` and
 * answers 200 is still bounded by the timeout and by the object size limits
 * enforced before this runs.
 */
export async function readObjectHead(
  bucket: BucketName,
  key: string,
  byteCount = 4096,
): Promise<Uint8Array> {
  const { url } = await createSignedDownloadUrl(bucket, key, { expiresInSeconds: 60 });
  const response = await fetch(url, {
    headers: { Range: `bytes=0-${byteCount - 1}` },
    cache: "no-store",
    signal: AbortSignal.timeout(OBJECT_HEAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw ApiError.internal(new Error(`object head read failed (${response.status})`));
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  return buffer.slice(0, byteCount);
}

/**
 * Reads a whole object into memory, for server-side processing of a file the
 * caller has already authorised (document intelligence). Bounded twice: by
 * `maxBytes`, checked against the response before the body is read, and by a
 * timeout. The signed URL lives for one minute and is never returned.
 */
export async function readObject(
  bucket: BucketName,
  key: string,
  options: { maxBytes: number; timeoutMs?: number },
): Promise<Uint8Array> {
  const { url } = await createSignedDownloadUrl(bucket, key, { expiresInSeconds: 60 });
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });
  if (!response.ok) {
    throw ApiError.internal(new Error(`object read failed (${response.status})`));
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    // Not awaited: cancelling a teed body may never settle (see readObjectHead).
    void response.body?.cancel().catch(() => undefined);
    throw ApiError.invariant("FILE_TOO_LARGE", "This file is too large to process.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > options.maxBytes) {
    throw ApiError.invariant("FILE_TOO_LARGE", "This file is too large to process.");
  }
  return bytes;
}

export async function removeObject(bucket: BucketName, key: string): Promise<void> {
  const { error } = await storage().from(bucket).remove([key]);
  // A missing object is the desired end state, so a failure here is logged by
  // the caller rather than failing the operation it is cleaning up after.
  if (error) throw ApiError.internal(error);
}
