import "server-only";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createServiceClient, createUserClient } from "@/lib/db/server";
import { emailConfigured } from "@/lib/email/client";
import { sendBeneficiaryInvitationEmail } from "@/lib/email/send";
import { logger } from "@/lib/observability/logger";
import * as beneficiaryRepository from "@/lib/repositories/beneficiary.repository";
import type {
  Beneficiary,
  BeneficiaryDetail,
  BeneficiaryListResult,
  BeneficiaryRoles,
  BeneficiaryWithRoles,
} from "@/lib/types/beneficiary";
import {
  beneficiaryCreateBodySchema,
  type BeneficiaryCreateBody,
  type BeneficiaryListQuery,
  type BeneficiaryUpdateBody,
} from "@/lib/validators/beneficiary.validators";

/**
 * Beneficiary service (tasks T071–T076, api-contracts.md § Beneficiaries).
 *
 * Write classes, from 0002_rls_and_privileges.sql and 0003_functions.sql:
 *  • Class A — create and contact-field updates are direct writes on the column
 *    allow-list, through the user-scoped client so RLS applies as well, and the
 *    `beneficiaries_audit_class_a` trigger records them inside the same
 *    transaction;
 *  • Class B — status changes, removal and unassignment carry invariants
 *    (token revocation, cascade, allocation sums) and therefore run in the
 *    guarded `SECURITY DEFINER` functions, which audit themselves;
 *  • Class C — `invited_at` records what the system did rather than what the
 *    owner typed, has no `authenticated` grant, and is written with the service
 *    client only after ownership was proven through the user client.
 *
 * Authorization is performed here, in the application, for every operation.
 * RLS and the guarded functions are the second and third barriers, not the
 * first (constitution VIII).
 */

/* ── Reads ────────────────────────────────────────────────────────────────── */

export async function listBeneficiaries(
  user: AppUser,
  query: BeneficiaryListQuery,
): Promise<BeneficiaryListResult> {
  const db = await createUserClient();
  const [{ rows, total }, assignments, trustedIds, emergencyIds] = await Promise.all([
    beneficiaryRepository.list(db, user.id, {
      status: query.status,
      search: query.q,
      page: query.page,
      limit: query.limit,
    }),
    beneficiaryRepository.listAssignments(db, user.id),
    beneficiaryRepository.listTrustedContactIds(db, user.id),
    beneficiaryRepository.listEmergencyContactIds(db, user.id),
  ]);

  const trusted = new Set(trustedIds);
  const emergency = new Set(emergencyIds);

  return {
    items: rows.map((row) => withRoles(row, assignments, trusted, emergency)),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getBeneficiary(user: AppUser, id: string): Promise<BeneficiaryDetail> {
  const db = await createUserClient();
  const beneficiary = await beneficiaryRepository.findById(db, user.id, id);
  if (!beneficiary) throw ApiError.notFound();

  const [assignments, trustedIds, emergencyIds] = await Promise.all([
    beneficiaryRepository.listAssignments(db, user.id, id),
    beneficiaryRepository.listTrustedContactIds(db, user.id),
    beneficiaryRepository.listEmergencyContactIds(db, user.id),
  ]);

  return {
    ...withRoles(beneficiary, assignments, new Set(trustedIds), new Set(emergencyIds)),
    assignments,
  };
}

/* ── Class A writes ───────────────────────────────────────────────────────── */

export async function createBeneficiary(
  user: AppUser,
  input: BeneficiaryCreateBody,
  correlationId: string,
): Promise<BeneficiaryWithRoles> {
  assertAccountActive(user);
  const db = await createUserClient();

  // The partial unique index enforces this too; checking first turns a raw
  // constraint violation into a message the form can attach to the field.
  const existing = await beneficiaryRepository.findByEmail(db, user.id, input.email);
  if (existing) {
    throw ApiError.conflict("DUPLICATE", "A beneficiary with this email already exists.");
  }

  const created = await beneficiaryRepository.insert(db, user.id, {
    name: input.name,
    relationship: input.relationship,
    email: input.email,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
  });

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "beneficiary.created",
    resourceType: "beneficiary",
    resourceId: created.id,
    outcome: "SUCCESS",
    metadata: { relationship: created.relationship, status: created.status },
    correlationId,
  });

  return { ...created, roles: emptyRoles() };
}

export async function updateBeneficiary(
  user: AppUser,
  id: string,
  input: BeneficiaryUpdateBody,
  correlationId: string,
): Promise<Beneficiary> {
  assertAccountActive(user);
  const db = await createUserClient();

  const before = await beneficiaryRepository.findById(db, user.id, id);
  if (!before) throw ApiError.notFound();

  const patch: beneficiaryRepository.BeneficiaryPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.relationship !== undefined) patch.relationship = input.relationship;
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = emptyToNull(input.phone);
  if (input.notes !== undefined) patch.notes = emptyToNull(input.notes);

  if (Object.keys(patch).length === 0) return before;

  if (patch.email && patch.email !== before.email) {
    const clash = await beneficiaryRepository.findByEmail(db, user.id, patch.email);
    if (clash && clash.id !== id) {
      throw ApiError.conflict("DUPLICATE", "Another beneficiary already uses this email.");
    }
  }

  const updated = await beneficiaryRepository.update(db, user.id, id, patch);

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "beneficiary.updated",
    resourceType: "beneficiary",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: {
      ...audit.diff(
        before as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      ),
      // FR-D008: identity changes on a legal record are explicitly confirmed.
      confirmed: input.confirmed === true,
    },
    correlationId,
  });

  return updated;
}

/* ── Class B writes (guarded functions) ───────────────────────────────────── */

export async function setBeneficiaryStatus(
  user: AppUser,
  id: string,
  status: "ACTIVE" | "INACTIVE",
  correlationId: string,
): Promise<Beneficiary> {
  assertAccountActive(user);
  const db = await createUserClient();

  // set_beneficiary_status() also revokes every live access token when the
  // beneficiary goes INACTIVE, and audits both inside its own transaction.
  const { error } = await db.rpc("set_beneficiary_status", {
    p_beneficiary_id: id,
    p_status: status,
    p_corr: correlationId,
  });
  if (error) throw error;

  const after = await beneficiaryRepository.findById(db, user.id, id);
  if (!after) throw ApiError.notFound();
  return after;
}

export async function removeBeneficiary(
  user: AppUser,
  id: string,
  correlationId: string,
): Promise<{ id: string }> {
  assertAccountActive(user);
  const db = await createUserClient();

  // remove_beneficiary() is a single transaction: assignments deleted, tokens
  // revoked, DMS contact link removed, emergency config deactivated, row soft
  // deleted, audited. Nothing here may do any part of that separately.
  const { error } = await db.rpc("remove_beneficiary", {
    p_beneficiary_id: id,
    p_corr: correlationId,
  });
  if (error) throw error;

  return { id };
}

export async function unassignBeneficiary(
  user: AppUser,
  beneficiaryId: string,
  assignmentId: string,
  correlationId: string,
): Promise<{ id: string }> {
  assertAccountActive(user);
  const db = await createUserClient();

  // Authorization of record: the assignment must be this caller's and must
  // belong to the beneficiary named in the path, so a valid assignment id
  // cannot be removed through somebody else's beneficiary.
  const assignment = await beneficiaryRepository.findAssignmentById(db, user.id, assignmentId);
  if (!assignment || assignment.beneficiaryId !== beneficiaryId) throw ApiError.notFound();

  const { error } = await db.rpc("unassign_beneficiary", {
    p_assignment_id: assignmentId,
    p_corr: correlationId,
  });
  if (error) throw error;

  return { id: assignmentId };
}

/* ── Class C write (system field) ─────────────────────────────────────────── */

export interface InviteResult {
  beneficiary: Beneficiary;
  /** True only when the provider accepted the invitation email. */
  emailSent: boolean;
}

export async function inviteBeneficiary(
  user: AppUser,
  id: string,
  correlationId: string,
): Promise<InviteResult> {
  assertAccountActive(user);
  const db = await createUserClient();

  const beneficiary = await beneficiaryRepository.findById(db, user.id, id);
  if (!beneficiary) throw ApiError.notFound();
  if (beneficiary.status === "INACTIVE") {
    throw ApiError.invariant(
      "BENEFICIARY_INACTIVE",
      "Reactivate this beneficiary before inviting them again.",
    );
  }
  // Every write path validates the address, but the column only guarantees
  // lower case, so the stored value is re-checked before anything is recorded.
  if (!beneficiaryCreateBodySchema.shape.email.safeParse(beneficiary.email).success) {
    throw ApiError.validation(
      { email: ["Add a valid email address before sending an invitation."] },
      "This beneficiary has no valid email address.",
    );
  }

  // Ownership is proven above through the user client; the service client is
  // used only because `invited_at` carries no `authenticated` grant.
  const invitedAt = new Date().toISOString();
  const updated = await beneficiaryRepository.markInvited(
    createServiceClient(),
    user.id,
    id,
    invitedAt,
  );

  const emailSent = await sendInvitation(user, updated, invitedAt, correlationId);

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "beneficiary.invited",
    resourceType: "beneficiary",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { previousInvitedAt: beneficiary.invitedAt, emailSent },
    correlationId,
  });

  return { beneficiary: updated, emailSent };
}

/**
 * Sends the invitation and reports honestly whether it went out.
 *
 * A mail failure does not undo the recorded invitation — the owner can resend —
 * but it is never reported as sent. The key is the invitation itself: a retry
 * of this send is deduplicated, a deliberate resend is a new message.
 */
async function sendInvitation(
  user: AppUser,
  beneficiary: Beneficiary,
  invitedAt: string,
  correlationId: string,
): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    await sendBeneficiaryInvitationEmail({
      to: beneficiary.email,
      beneficiaryName: beneficiary.name,
      ownerName: user.name,
      idempotencyKey: `beneficiary-invite:${beneficiary.id}:${invitedAt}`,
    });
    return true;
  } catch (cause) {
    // Never the recipient's address, never the message.
    logger.error(
      { err: cause, beneficiaryId: beneficiary.id, correlationId },
      "beneficiary invitation email failed",
    );
    return false;
  }
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emptyRoles(): BeneficiaryRoles {
  return {
    assignmentCount: 0,
    isTrustedContact: false,
    isEmergencyContact: false,
    averageAllocation: 0,
  };
}

function withRoles(
  beneficiary: Beneficiary,
  assignments: readonly { beneficiaryId: string; allocationPercentage: number | null }[],
  trusted: ReadonlySet<string>,
  emergency: ReadonlySet<string>,
): BeneficiaryWithRoles {
  const mine = assignments.filter((a) => a.beneficiaryId === beneficiary.id);
  const allocated = mine.reduce((sum, a) => sum + (a.allocationPercentage ?? 0), 0);
  return {
    ...beneficiary,
    roles: {
      assignmentCount: mine.length,
      isTrustedContact: trusted.has(beneficiary.id),
      isEmergencyContact: emergency.has(beneficiary.id),
      averageAllocation: mine.length ? Math.round(allocated / mine.length) : 0,
    },
  };
}
