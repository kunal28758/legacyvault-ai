import "server-only";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createUserClient } from "@/lib/db/server";
import * as videoRepository from "@/lib/repositories/video.repository";
import { createSignedDownloadUrl, type BucketName } from "@/lib/storage/storage";
import type { SignedAccess } from "@/lib/types/document";
import type { VideoListResult, VideoMessage } from "@/lib/types/video";
import type { VideoUpdateBody } from "@/lib/validators/video.validators";

/**
 * Video legacy messages (FR-K001–K006).
 *
 * `deliveryCondition` decides which kind of access link may ever play a video.
 * It is re-checked by `lv_validate_scope()` whenever a token is minted, so
 * changing it here immediately narrows or widens what future links can carry —
 * and can never widen what an already-issued link is allowed to reach.
 */
export async function listVideos(
  user: AppUser,
  query: { deliveryCondition?: string; q?: string; page: number; limit: number },
): Promise<VideoListResult> {
  const db = await createUserClient();
  const { rows, total } = await videoRepository.list(db, user.id, {
    deliveryCondition: query.deliveryCondition,
    search: query.q,
    page: query.page,
    limit: query.limit,
  });

  const assignments = await videoRepository.assignmentsFor(
    db,
    user.id,
    rows.map((row) => row.id),
  );

  return {
    items: rows.map((row) => videoRepository.toVideo(row, assignments.get(row.id) ?? [])),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getVideo(user: AppUser, id: string): Promise<VideoMessage> {
  const db = await createUserClient();
  const row = await videoRepository.findById(db, user.id, id);
  if (!row) throw ApiError.notFound();

  const assignments = await videoRepository.assignmentsFor(db, user.id, [id]);
  return videoRepository.toVideo(row, assignments.get(id) ?? []);
}

export async function updateVideo(
  user: AppUser,
  id: string,
  body: VideoUpdateBody,
  correlationId: string,
): Promise<VideoMessage> {
  assertAccountActive(user);
  const db = await createUserClient();

  const before = await videoRepository.findById(db, user.id, id);
  if (!before) throw ApiError.notFound();

  const patch: Parameters<typeof videoRepository.update>[3] = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.deliveryCondition !== undefined) patch.delivery_condition = body.deliveryCondition;

  await videoRepository.update(db, user.id, id, patch);
  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "video.updated",
    resourceType: "video_message",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: {
      changed: Object.keys(patch),
      ...(body.deliveryCondition ? { previousDeliveryCondition: before.delivery_condition } : {}),
    },
    correlationId,
  });

  return getVideo(user, id);
}

export async function deleteVideo(
  user: AppUser,
  id: string,
  correlationId: string,
): Promise<{ id: string }> {
  assertAccountActive(user);
  const db = await createUserClient();

  // delete_video(): assignments removed, row soft-deleted, object-removal queued.
  const { error } = await db.rpc("delete_video", { p_video_id: id, p_corr: correlationId });
  if (error) throw error;
  return { id };
}

/** A short-lived signed link so the owner can review their own recording. */
export async function accessVideo(
  user: AppUser,
  id: string,
  correlationId: string,
): Promise<SignedAccess> {
  const db = await createUserClient();
  const row = await videoRepository.findById(db, user.id, id);
  if (!row) throw ApiError.notFound();

  const signed = await createSignedDownloadUrl(row.storage_bucket as BucketName, row.storage_key);
  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "video.accessed",
    resourceType: "video_message",
    resourceId: id,
    outcome: "SUCCESS",
    correlationId,
  });

  return { url: signed.url, expiresAt: signed.expiresAt, name: row.title, mimeType: row.mime_type };
}

export async function assignVideo(
  user: AppUser,
  id: string,
  beneficiaryId: string,
  correlationId: string,
): Promise<VideoMessage> {
  assertAccountActive(user);
  const db = await createUserClient();

  const video = await videoRepository.findById(db, user.id, id);
  if (!video) throw ApiError.notFound();

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

  // Videos carry no allocation percentage.
  const { error } = await db.rpc("assign_beneficiary", {
    p_beneficiary_id: beneficiaryId,
    p_resource_type: "VIDEO_MESSAGE",
    p_resource_id: id,
    p_corr: correlationId,
  });
  if (error) throw error;
  return getVideo(user, id);
}

export async function unassignVideo(
  user: AppUser,
  id: string,
  assignmentId: string,
  correlationId: string,
): Promise<VideoMessage> {
  assertAccountActive(user);
  const db = await createUserClient();

  const assignments = await videoRepository.assignmentsFor(db, user.id, [id]);
  if (!(assignments.get(id) ?? []).some((assignment) => assignment.id === assignmentId)) {
    throw ApiError.notFound();
  }

  const { error } = await db.rpc("unassign_beneficiary", {
    p_assignment_id: assignmentId,
    p_corr: correlationId,
  });
  if (error) throw error;
  return getVideo(user, id);
}
