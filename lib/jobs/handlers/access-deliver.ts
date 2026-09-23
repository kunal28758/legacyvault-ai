import "server-only";

import { logger } from "@/lib/observability/logger";
import { sendAccessLinkEmail } from "@/lib/email/send";
import { accessLinkFor, expiryFromHours, mintAccessToken } from "@/lib/security/access-token";
import { payloadOf, requireString, type JobHandler } from "@/lib/jobs/types";

/**
 * Mints and delivers a system-granted access link (ADR-014 § 6).
 *
 * The plaintext exists only inside this function: it is hashed for storage,
 * placed in one email, and then goes out of scope. It is never written to the
 * job payload, the audit log or any column.
 *
 * Retry safety: if a live token already exists for this grant but was never
 * delivered, it is *reissued* — the old one is revoked as
 * `UNDELIVERED_REPLACED` and a fresh secret is minted — because the previous
 * plaintext is unrecoverable by design. If one was already delivered, the job
 * has nothing left to do.
 */
const DMS_RELEASE_TTL_HOURS = 30 * 24;

export const accessDeliverHandler: JobHandler = async (job, db) => {
  const payload = payloadOf(job);
  const grantType = requireString(payload, "grantType") as
    "DMS_RELEASE" | "EMERGENCY_ACCESS" | "DIRECT_SHARE";
  const beneficiaryId = requireString(payload, "beneficiaryId");

  if (grantType === "DIRECT_SHARE") {
    // Owner-issued links are minted and mailed by the API, which is the only
    // place the plaintext may exist; there is nothing for the queue to do.
    return;
  }

  const { data: beneficiary, error: beneficiaryError } = await db
    .from("beneficiaries")
    .select("id, name, email, status, user_id, deleted_at")
    .eq("id", beneficiaryId)
    .maybeSingle();
  if (beneficiaryError) throw beneficiaryError;
  if (!beneficiary || beneficiary.deleted_at || beneficiary.status === "INACTIVE") {
    logger.warn({ jobId: job.id }, "access delivery skipped: beneficiary is not eligible");
    return;
  }

  const { data: owner, error: ownerError } = await db
    .from("users")
    .select("name, email")
    .eq("id", beneficiary.user_id)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner) throw new Error("owner not found for access delivery");

  const switchId = typeof payload.switchId === "string" ? payload.switchId : null;
  const requestId = typeof payload.requestId === "string" ? payload.requestId : null;

  // Scope and expiry come from the configuration, never from the payload.
  let scope: unknown;
  let expiresAt: string;
  if (grantType === "DMS_RELEASE") {
    if (!switchId) throw new Error("DMS delivery is missing switchId");
    const { data: dms, error } = await db
      .from("dead_man_switches")
      .select("release_scope")
      .eq("id", switchId)
      .maybeSingle();
    if (error) throw error;
    if (!dms) throw new Error("switch not found for access delivery");
    scope = dms.release_scope;
    expiresAt = expiryFromHours(DMS_RELEASE_TTL_HOURS);
  } else {
    if (!requestId) throw new Error("emergency delivery is missing requestId");
    const { data: request, error } = await db
      .from("emergency_access_requests")
      .select("config_id")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw error;
    if (!request) throw new Error("request not found for access delivery");

    const { data: config, error: configError } = await db
      .from("emergency_access_configs")
      .select("access_scope, access_duration_hours")
      .eq("id", request.config_id)
      .maybeSingle();
    if (configError) throw configError;
    if (!config) throw new Error("config not found for access delivery");
    scope = config.access_scope;
    expiresAt = expiryFromHours(config.access_duration_hours);
  }

  // Is there already a live token for this grant?
  let query = db
    .from("access_tokens")
    .select("id, delivered_at")
    .eq("beneficiary_id", beneficiaryId)
    .eq("grant_type", grantType)
    .is("revoked_at", null);
  query =
    grantType === "DMS_RELEASE"
      ? query.eq("dead_man_switch_id", switchId!)
      : query.eq("emergency_request_id", requestId!);
  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError) throw existingError;

  if (existing?.delivered_at) {
    logger.info({ jobId: job.id }, "access link already delivered");
    return;
  }

  const minted = mintAccessToken();
  let tokenId: string;

  if (existing) {
    // The previous secret cannot be recovered, so it is replaced rather than resent.
    const { data, error } = await db.rpc("system_reissue_access_token", {
      p_previous_token_id: existing.id,
      p_token_hash: minted.hash,
      p_expires_at: expiresAt,
      p_reason: "UNDELIVERED_REPLACED",
    });
    if (error) throw error;
    tokenId = data as string;
  } else {
    const { data, error } = await db.rpc("system_issue_access_token", {
      p_beneficiary_id: beneficiaryId,
      p_grant_type: grantType,
      p_scope: scope as never,
      p_token_hash: minted.hash,
      p_expires_at: expiresAt,
      ...(grantType === "DMS_RELEASE" ? { p_dms_id: switchId! } : { p_request_id: requestId! }),
    });
    if (error) throw error;
    tokenId = data as string;
  }

  const sent = await sendAccessLinkEmail({
    to: beneficiary.email,
    beneficiaryName: beneficiary.name,
    ownerName: owner.name,
    link: accessLinkFor(minted.plaintext),
    expiresAt,
    grantType,
    // Per token, so a retry that already sent is deduplicated by the provider.
    idempotencyKey: `access-link:${tokenId}`,
  });

  const { error: deliveredError } = await db.rpc("system_mark_token_delivered", {
    p_token_id: tokenId,
    p_provider_message_id: sent.providerMessageId,
  });
  if (deliveredError) throw deliveredError;

  if (grantType === "EMERGENCY_ACCESS" && requestId) {
    // Moves the request to ACTIVE; already-active is not an error worth retrying.
    const { error } = await db.rpc("ea_transition", {
      p_request_id: requestId,
      p_to: "ACTIVE",
      p_metadata: { tokenId } as never,
    });
    if (error && error.code !== "LV409") throw error;
  }
};
