import "server-only";

import { randomInt } from "node:crypto";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import { createServiceClient } from "@/lib/db/server";
import { sendEmergencyCodeEmail, sendEmergencyDesignationEmail } from "@/lib/email/send";
import { logger } from "@/lib/observability/logger";
import { hashAccessToken } from "@/lib/security/access-token";

/**
 * The emergency contact's side of the flow (FR-J002–J004).
 *
 * Nothing here has a session. Three rules shape it:
 *
 *  • **The answer is always the same.** Whether the configuration exists,
 *    whether the email matches, whether a request was created — the response
 *    is identical, so this endpoint cannot be used to discover who someone's
 *    emergency contacts are.
 *  • **The code is never stored.** Only its SHA-256 hash reaches the database,
 *    exactly as with access tokens.
 *  • **Verification alone grants nothing.** It only puts the request in front
 *    of the owner, who decides — or whose timeout rule decides for them.
 */
export interface EmergencySubmission {
  submitted: true;
}

function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Creates a request and emails the code.
 *
 * `ea_request_access()` returns null when the configuration is gone or the
 * email does not belong to the designated beneficiary; the caller cannot tell
 * the difference from the outside, and neither can the response.
 */
export async function requestAccess(
  configId: string,
  email: string,
  correlationId: string,
): Promise<EmergencySubmission> {
  const db = createServiceClient();
  const code = sixDigitCode();

  const { data: requestId, error } = await db.rpc("ea_request_access", {
    p_config_id: configId,
    p_requester_email: email,
    p_otp_hash: hashAccessToken(code),
  });
  if (error) throw error;
  if (!requestId) return { submitted: true };

  const { data: config, error: configError } = await db
    .from("emergency_access_configs")
    .select("user_id, users!inner(name)")
    .eq("id", configId)
    .maybeSingle();
  if (configError) throw configError;
  const ownerName =
    (config?.users as unknown as { name: string } | null)?.name ?? "A LegacyVault user";

  try {
    await sendEmergencyCodeEmail({
      to: email,
      ownerName,
      code,
      requestId: requestId as string,
      // One code per request; a retried submission is a new request, not a resend.
      idempotencyKey: `ea-code:${requestId}`,
    });
  } catch (cause) {
    // The code cannot be recovered, so a failed send must not leave a request
    // nobody can complete.
    logger.error({ err: cause, correlationId }, "emergency code email failed");
    await db.rpc("ea_transition", {
      p_request_id: requestId as string,
      p_to: "EXPIRED",
      p_metadata: { reason: "code_delivery_failed" } as never,
    });
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "We could not send your code. Please try again.",
    );
  }

  await audit.log({
    actorId: null,
    action: "ea.code_sent",
    resourceType: "emergency_access_request",
    resourceId: requestId as string,
    outcome: "SUCCESS",
    metadata: { configId },
    correlationId,
  });
  return { submitted: true };
}

export interface VerificationResult {
  status: "VERIFYING" | "VERIFIED" | "FAILED" | "EXPIRED";
}

/** Checks a code. Wrong codes are counted in the database, not here. */
export async function verify(
  requestId: string,
  code: string,
  correlationId: string,
): Promise<VerificationResult> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("ea_verify_otp", {
    p_request_id: requestId,
    p_otp_hash: hashAccessToken(code),
  });
  if (error) {
    // An unknown request id answers exactly like a wrong code.
    if (error.code === "LV422") return { status: "FAILED" };
    throw error;
  }

  const status = data as VerificationResult["status"];
  await audit.log({
    actorId: null,
    action: status === "VERIFIED" ? "ea.otp_verified" : "ea.otp_rejected",
    resourceType: "emergency_access_request",
    resourceId: requestId,
    outcome: status === "VERIFIED" ? "SUCCESS" : "DENIED",
    correlationId,
  });
  return { status };
}

export interface RequestStatus {
  status: string;
  /** Present once a decision exists, so the page can stop polling. */
  decidedAt: string | null;
}

/**
 * The public status of a request.
 *
 * Only the state — never the scope, the owner's name or anything about the
 * vault. The requester already knows the request id; this tells them whether
 * to keep waiting.
 */
export async function requestStatus(requestId: string): Promise<RequestStatus> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("emergency_access_requests")
    .select("status, decided_at")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound("That request no longer exists.");
  return { status: data.status, decidedAt: data.decided_at };
}

/**
 * Re-sends the designation email (owner action).
 *
 * The message contains no secret — only where to ask — so it can be sent again
 * freely, and the timestamp lets the owner see that it went.
 */
export async function resendDesignation(
  ownerUserId: string,
  configId: string,
  correlationId: string,
): Promise<{ sentAt: string }> {
  const db = createServiceClient();
  const { data: config, error } = await db
    .from("emergency_access_configs")
    .select(
      "id, user_id, beneficiary_id, beneficiaries!inner(name, email, status, deleted_at), users!inner(name)",
    )
    .eq("id", configId)
    .eq("user_id", ownerUserId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!config) throw ApiError.notFound();

  const beneficiary = config.beneficiaries as unknown as {
    name: string;
    email: string;
    status: string;
    deleted_at: string | null;
  };
  if (beneficiary.deleted_at || beneficiary.status === "INACTIVE") {
    throw new ApiError(
      422,
      "BENEFICIARY_INACTIVE",
      "This contact is inactive — reactivate them first.",
    );
  }
  const owner = config.users as unknown as { name: string };
  const sentAt = new Date().toISOString();

  await sendEmergencyDesignationEmail({
    to: beneficiary.email,
    beneficiaryName: beneficiary.name,
    ownerName: owner.name,
    configId,
    // A resend is a new message, not a duplicate of the previous one.
    idempotencyKey: `ea-designation:${configId}:${sentAt}`,
  });

  const { error: updateError } = await db
    .from("emergency_access_configs")
    .update({ last_designation_sent_at: sentAt })
    .eq("id", configId);
  if (updateError) throw updateError;

  await audit.log({
    actorId: ownerUserId,
    action: "ea.designation_sent",
    resourceType: "emergency_access_config",
    resourceId: configId,
    outcome: "SUCCESS",
    correlationId,
  });
  return { sentAt };
}

/**
 * Queues another delivery run for an approved request (ADR-014 § 6).
 *
 * The previous secret is unrecoverable, so the job revokes the undelivered
 * token and mints exactly one replacement — never two live links.
 */
export async function resendAccess(
  ownerUserId: string,
  requestId: string,
  correlationId: string,
): Promise<{ queued: boolean }> {
  const db = createServiceClient();
  const { data: request, error } = await db
    .from("emergency_access_requests")
    .select("id, status, config_id, emergency_access_configs!inner(user_id, beneficiary_id)")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  const config = request?.emergency_access_configs as unknown as {
    user_id: string;
    beneficiary_id: string;
  } | null;
  if (!request || !config || config.user_id !== ownerUserId) throw ApiError.notFound();
  if (!["APPROVED", "AUTO_GRANTED", "ACTIVE"].includes(request.status)) {
    throw new ApiError(409, "INVALID_TRANSITION", "This request has no access to resend.");
  }

  const { data: jobId, error: enqueueError } = await db.rpc("lv_enqueue_access_delivery", {
    p_grant: "EMERGENCY_ACCESS",
    p_source: requestId,
    p_beneficiary: config.beneficiary_id,
    p_payload: { requestId, configId: request.config_id } as never,
    p_resend: true,
  });
  if (enqueueError) throw enqueueError;

  await audit.log({
    actorId: ownerUserId,
    action: "ea.access_resent",
    resourceType: "emergency_access_request",
    resourceId: requestId,
    outcome: "SUCCESS",
    metadata: { jobId },
    correlationId,
  });
  return { queued: jobId !== null };
}
