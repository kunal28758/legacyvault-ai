import "server-only";

import { logger } from "@/lib/observability/logger";
import { removeObject, type BucketName } from "@/lib/storage/storage";
import { payloadOf, type JobHandler } from "@/lib/jobs/types";

/**
 * Deletes the storage object behind a soft-deleted document or video.
 *
 * Queued by `delete_document()` / `delete_video()` so the row disappears from
 * the user's view immediately and the bytes follow. An object that is already
 * gone is the desired end state, so that is not an error.
 */
export const storageRemoveObjectHandler: JobHandler = async (job, db) => {
  const payload = payloadOf(job);
  const bucket = typeof payload.bucket === "string" ? (payload.bucket as BucketName) : null;
  const documentId = typeof payload.documentId === "string" ? payload.documentId : null;
  const videoId = typeof payload.videoId === "string" ? payload.videoId : null;
  if (!bucket) throw new Error("storage removal is missing a bucket");

  // The row is soft-deleted, so the service client reads it to find the key.
  let storageKey: string | null = null;
  if (documentId) {
    const { data, error } = await db
      .from("documents")
      .select("storage_key")
      .eq("id", documentId)
      .maybeSingle();
    if (error) throw error;
    storageKey = data?.storage_key ?? null;

    if (storageKey) {
      // Every version of the document is removed with it.
      const { data: versions, error: versionError } = await db
        .from("document_versions")
        .select("storage_key")
        .eq("document_id", documentId);
      if (versionError) throw versionError;
      for (const version of versions ?? []) {
        if (version.storage_key === storageKey) continue;
        await removeObject(bucket, version.storage_key).catch((cause: unknown) =>
          logger.warn({ err: cause, jobId: job.id }, "version object already gone"),
        );
      }
    }
  } else if (videoId) {
    const { data, error } = await db
      .from("video_messages")
      .select("storage_key")
      .eq("id", videoId)
      .maybeSingle();
    if (error) throw error;
    storageKey = data?.storage_key ?? null;
  }

  if (!storageKey) {
    logger.warn({ jobId: job.id }, "storage removal found no key; nothing to delete");
    return;
  }

  await removeObject(bucket, storageKey).catch((cause: unknown) =>
    logger.warn({ err: cause, jobId: job.id }, "object already gone"),
  );
};
