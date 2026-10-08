import "server-only";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createUserClient } from "@/lib/db/server";
import { emailConfigured } from "@/lib/email/client";
import { sendAccessLinkEmail, sendDocumentSharedNoticeEmail } from "@/lib/email/send";
import { logger } from "@/lib/observability/logger";
import * as accessTokenRepository from "@/lib/repositories/access-token.repository";
import {
  MAX_TOKEN_TTL_DAYS,
  accessLinkFor,
  expiryFromDays,
  mintAccessToken,
} from "@/lib/security/access-token";
import { checkRateLimit } from "@/lib/security/rate-limit";
import type { AccessTokenSummary } from "@/lib/types/access";
import type { IssueTokenBody, ResendTokenBody } from "@/lib/validators/access.validators";

/**
 * Owner-issued access links (ADR-014, FR-D011).
 *
 * The plaintext secret is created here, hashed for storage, mailed once and —
 * for a link the owner creates by hand — returned once. It is never persisted,
 * never logged and never placed in a job payload — which is also why a resend
 * mints a *new* secret instead of recovering the old one.
 *
 * `issue_access_token()` re-checks that every id in the scope is owned by the
 * caller and currently assigned to this beneficiary (422 `SCOPE_NOT_ASSIGNED`),
 * that videos in scope are deliverable immediately, and that the beneficiary is
 * not INACTIVE.
 */
export interface IssuedLink {
  token: AccessTokenSummary;
  /** Shown to the owner once. Not stored anywhere. */
  link: string;
  emailSent: boolean;
}

async function beneficiaryOf(
  db: Awaited<ReturnType<typeof createUserClient>>,
  userId: string,
  beneficiaryId: string,
) {
  const { data, error } = await db
    .from("beneficiaries")
    .select("id, name, email, status")
    .eq("id", beneficiaryId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound();
  return data;
}

export async function listTokens(
  user: AppUser,
  beneficiaryId: string,
): Promise<{ items: AccessTokenSummary[] }> {
  const db = await createUserClient();
  const beneficiary = await beneficiaryOf(db, user.id, beneficiaryId);
  return {
    items: await accessTokenRepository.listForBeneficiary(
      db,
      user.id,
      beneficiaryId,
      beneficiary.name,
    ),
  };
}

/** Security Centre: every live link across beneficiaries, newest first. */
export async function listLiveLinks(user: AppUser): Promise<{ items: AccessTokenSummary[] }> {
  const db = await createUserClient();
  return { items: await accessTokenRepository.listLive(db, user.id, new Date()) };
}

export async function issueToken(
  user: AppUser,
  beneficiaryId: string,
  body: IssueTokenBody,
  correlationId: string,
): Promise<IssuedLink> {
  assertAccountActive(user);
  const db = await createUserClient();
  const beneficiary = await beneficiaryOf(db, user.id, beneficiaryId);

  const minted = mintAccessToken();
  const expiresAt = expiryFromDays(body.ttlDays);

  const { data, error } = await db.rpc("issue_access_token", {
    p_beneficiary_id: beneficiaryId,
    p_scope: body.scope as never,
    p_token_hash: minted.hash,
    p_expires_at: expiresAt,
    p_corr: correlationId,
  });
  if (error) throw error;

  return deliver(db, user, {
    tokenId: data as string,
    beneficiaryId,
    beneficiaryName: beneficiary.name,
    beneficiaryEmail: beneficiary.email,
    plaintext: minted.plaintext,
    expiresAt,
    correlationId,
    action: "access.token_issued",
  });
}

export async function resendToken(
  user: AppUser,
  beneficiaryId: string,
  tokenId: string,
  body: ResendTokenBody,
  correlationId: string,
): Promise<IssuedLink> {
  assertAccountActive(user);
  const db = await createUserClient();
  const beneficiary = await beneficiaryOf(db, user.id, beneficiaryId);

  const existing = await accessTokenRepository.findById(db, user.id, tokenId);
  if (!existing || existing.beneficiaryId !== beneficiaryId) throw ApiError.notFound();

  const minted = mintAccessToken();
  const expiresAt = expiryFromDays(body.ttlDays);

  // resend_access_token() revokes the previous link as RESENT and mints exactly
  // one replacement, re-applying every issue-time invariant.
  const { data, error } = await db.rpc("resend_access_token", {
    p_token_id: tokenId,
    p_token_hash: minted.hash,
    p_expires_at: expiresAt,
    p_corr: correlationId,
  });
  if (error) throw error;

  return deliver(db, user, {
    tokenId: data as string,
    beneficiaryId,
    beneficiaryName: beneficiary.name,
    beneficiaryEmail: beneficiary.email,
    plaintext: minted.plaintext,
    expiresAt,
    correlationId,
    action: "access.token_resent",
  });
}

/**
 * What a share did about the beneficiary's link: minted and emailed a new one,
 * found the one live link that already covers it, or neither.
 */
export type ShareLinkOutcome = "new" | "existing" | "none";

/**
 * The link a document share sends by itself (migrations 0007, 0011).
 *
 * The link follows the beneficiary's shares, so it covers every document shared
 * with them now or later, and an unshare ends access through it at once. A
 * beneficiary holds at most ONE live share link: when one exists the database
 * refuses a second (SHARE_LINK_ALREADY_LIVE) and the existing link is reused —
 * nothing is minted, and the email that goes out names the new share without
 * carrying any link. Mail to a third party draws on the same `sensitive` budget
 * as an invitation or a manual link. Never throws: the share that called this is
 * already recorded and is kept whatever happens here.
 */
export async function issueDocumentShareLink(
  user: AppUser,
  beneficiaryId: string,
  correlationId: string,
): Promise<{ emailSent: boolean; link: ShareLinkOutcome }> {
  let emailSent = false;
  let link: ShareLinkOutcome = "none";
  try {
    // No mail, no link: a secret nobody receives is not worth minting.
    if (!emailConfigured()) return { emailSent, link };
    const budget = await checkRateLimit({ policy: "sensitive", subject: user.id });
    if (!budget.allowed) {
      logger.warn({ beneficiaryId, correlationId }, "document share link not sent: rate limited");
      return { emailSent, link };
    }

    const db = await createUserClient();
    const beneficiary = await beneficiaryOf(db, user.id, beneficiaryId);
    const minted = mintAccessToken();
    const expiresAt = expiryFromDays(MAX_TOKEN_TTL_DAYS);

    const { data, error } = await db.rpc("issue_document_share_token", {
      p_beneficiary_id: beneficiaryId,
      p_token_hash: minted.hash,
      p_expires_at: expiresAt,
      p_corr: correlationId,
    });
    if (error?.code === "LV409" && error.message.includes("SHARE_LINK_ALREADY_LIVE")) {
      link = "existing";
      emailSent = await noticeOfShare(user, beneficiary, correlationId);
      await audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: "access.share_link_reused",
        resourceType: "beneficiary",
        resourceId: beneficiaryId,
        outcome: "SUCCESS",
        metadata: { noticeSent: emailSent },
        correlationId,
      });
      return { emailSent, link };
    }
    if (error) throw error;
    link = "new";

    const delivery: Delivery = {
      tokenId: data as string,
      beneficiaryId,
      beneficiaryName: beneficiary.name,
      beneficiaryEmail: beneficiary.email,
      plaintext: minted.plaintext,
      expiresAt,
      correlationId,
      action: "access.token_issued",
    };
    // Recorded before the audit write, so a failure there cannot turn a
    // delivered email into "not sent".
    emailSent = await emailLink(user, delivery, accessLinkFor(minted.plaintext));
    await auditDelivery(user, delivery, emailSent);
  } catch (cause) {
    // Never the recipient's address, never the link.
    logger.error({ err: cause, beneficiaryId, correlationId }, "document share link failed");
  }
  return { emailSent, link };
}

/** The link-free email for a later share. True only when the provider accepted it. */
async function noticeOfShare(
  user: AppUser,
  beneficiary: { id: string; name: string; email: string | null },
  correlationId: string,
): Promise<boolean> {
  if (!beneficiary.email) return false;
  try {
    await sendDocumentSharedNoticeEmail({
      to: beneficiary.email,
      beneficiaryName: beneficiary.name,
      ownerName: user.name,
      idempotencyKey: `share-notice:${beneficiary.id}:${correlationId}`,
    });
    return true;
  } catch (cause) {
    logger.error({ err: cause, beneficiaryId: beneficiary.id }, "share notice email failed");
    return false;
  }
}

export async function revokeToken(
  user: AppUser,
  beneficiaryId: string,
  tokenId: string,
  correlationId: string,
): Promise<{ items: AccessTokenSummary[] }> {
  assertAccountActive(user);
  const db = await createUserClient();

  const existing = await accessTokenRepository.findById(db, user.id, tokenId);
  if (!existing || existing.beneficiaryId !== beneficiaryId) throw ApiError.notFound();

  const { error } = await db.rpc("revoke_access_token", {
    p_token_id: tokenId,
    p_corr: correlationId,
  });
  if (error) throw error;
  return listTokens(user, beneficiaryId);
}

/**
 * Sends the link and reports honestly whether it went out.
 *
 * A mail failure does not undo the token — the owner still has the link on
 * screen and can send it themselves — but it is never reported as sent.
 */
interface Delivery {
  tokenId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  beneficiaryEmail: string;
  plaintext: string;
  expiresAt: string;
  correlationId: string;
  action: string;
}

async function deliver(
  db: Awaited<ReturnType<typeof createUserClient>>,
  user: AppUser,
  input: Delivery,
): Promise<IssuedLink> {
  const link = accessLinkFor(input.plaintext);
  const emailSent = await emailLink(user, input, link);
  await auditDelivery(user, input, emailSent);

  const token = await accessTokenRepository.findById(db, user.id, input.tokenId);
  if (!token) throw ApiError.internal(new Error("token missing after issue"));
  return { token: { ...token, beneficiaryName: input.beneficiaryName }, link, emailSent };
}

/** True only when the provider accepted the message. Never throws. */
async function emailLink(user: AppUser, input: Delivery, link: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    await sendAccessLinkEmail({
      to: input.beneficiaryEmail,
      beneficiaryName: input.beneficiaryName,
      ownerName: user.name,
      link,
      expiresAt: input.expiresAt,
      grantType: "DIRECT_SHARE",
      idempotencyKey: `access-link:${input.tokenId}`,
    });
    return true;
  } catch (cause) {
    // Never the link, never the recipient's address.
    logger.error({ err: cause, tokenId: input.tokenId }, "access link email failed");
    return false;
  }
}

async function auditDelivery(user: AppUser, input: Delivery, emailSent: boolean): Promise<void> {
  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: input.action,
    resourceType: "access_token",
    resourceId: input.tokenId,
    outcome: "SUCCESS",
    metadata: { beneficiaryId: input.beneficiaryId, emailSent, expiresAt: input.expiresAt },
    correlationId: input.correlationId,
  });
}
