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
  quarantine: "quarantine",
  documents: "documents",
  videos: "videos",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

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
 * The quarantine key for an upload session.
 *
 * Shape: `<ownerId>/<uploadId>`, derived rather than stored — the session row
 * has no key column, and deriving it means there is nothing to tamper with.
 * The original filename is deliberately not part of the path: it lives in a
 * column, so nothing a user types can influence where an object is written.
 */
export function quarantineKey(ownerId: string, uploadId: string): string {
  return `${ownerId}/${uploadId}`;
}

/** The permanent key an object takes once it has been promoted out of quarantine. */
export function permanentKey(ownerId: string, uploadId: string): string {
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

/**
 * Reads the first bytes of an object without downloading the whole thing.
 *
 * Used for magic-byte sniffing: a 50 MB file must not be pulled into memory to
 * learn what its first four bytes are, so the stream is cancelled as soon as
 * enough has arrived.
 */
export async function readObjectHead(
  bucket: BucketName,
  key: string,
  byteCount = 4096,
): Promise<Uint8Array> {
  const { url } = await createSignedDownloadUrl(bucket, key, { expiresInSeconds: 60 });
  const response = await fetch(url, { headers: { Range: `bytes=0-${byteCount - 1}` } });
  if (!response.ok && response.status !== 206) {
    throw ApiError.internal(new Error(`object head read failed (${response.status})`));
  }

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < byteCount) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const head = new Uint8Array(Math.min(total, byteCount));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= head.length) break;
    head.set(chunk.subarray(0, head.length - offset), offset);
    offset += chunk.byteLength;
  }
  return head;
}

/** Promotes an object out of quarantine into its permanent bucket. */
export async function moveObject(
  from: { bucket: BucketName; key: string },
  to: { bucket: BucketName; key: string },
): Promise<void> {
  const { error } = await storage()
    .from(from.bucket)
    .move(from.key, to.key, { destinationBucket: to.bucket });
  if (error) throw ApiError.internal(error);
}

export async function removeObject(bucket: BucketName, key: string): Promise<void> {
  const { error } = await storage().from(bucket).remove([key]);
  // A missing object is the desired end state, so a failure here is logged by
  // the caller rather than failing the operation it is cleaning up after.
  if (error) throw ApiError.internal(error);
}
