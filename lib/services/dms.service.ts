import "server-only";

import { ApiError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createUserClient } from "@/lib/db/server";
import * as dmsRepository from "@/lib/repositories/dms.repository";
import * as notificationRepository from "@/lib/repositories/notification.repository";
import type { DeadManSwitch } from "@/lib/types/dms";
import type { DmsConfigureBody } from "@/lib/validators/dms.validators";

/**
 * Dead Man's Switch (FR-I001–I012).
 *
 * The service never computes a state. Every transition is a guarded function
 * that validates the move, writes the event row and audits itself, so the
 * switch cannot be advanced or recovered from the browser — only asked to.
 */
export async function getSwitch(user: AppUser): Promise<DeadManSwitch | null> {
  const db = await createUserClient();
  const row = await dmsRepository.findForUser(db, user.id);
  if (!row) return null;

  const [contacts, events, unavailable, issued, warnings] = await Promise.all([
    dmsRepository.listContacts(db, user.id, row.id),
    dmsRepository.listEvents(db, row.id),
    dmsRepository.countUnavailable(db, user.id, dmsRepository.asScope(row.release_scope)),
    dmsRepository.listReleaseAccess(db, row.id),
    // Only once warnings exist: nothing is fetched for a switch on schedule.
    row.status === "ACTIVE" || row.status === "INACTIVE" || row.status === "PAUSED"
      ? Promise.resolve([])
      : notificationRepository.listReleaseWarnings(
          db,
          user.id,
          row.id,
          row.last_check_in_at ?? row.created_at,
        ),
  ]);
  const names = new Map(
    contacts.map((contact) => [contact.beneficiaryId, contact.beneficiaryName]),
  );
  const releaseAccess = issued.map((link) => ({
    ...link,
    beneficiaryName: names.get(link.beneficiaryId) ?? "Former contact",
  }));
  const latest = warnings[0];
  return dmsRepository.toDeadManSwitch(
    row,
    contacts,
    events,
    releaseAccess,
    unavailable,
    latest
      ? { type: latest.type, status: latest.delivery_status, createdAt: latest.created_at }
      : null,
  );
}

export async function configure(
  user: AppUser,
  body: DmsConfigureBody,
  correlationId: string,
): Promise<DeadManSwitch> {
  assertAccountActive(user);
  const db = await createUserClient();

  // dms_configure() re-checks every range, that each contact is an eligible
  // beneficiary, and that the release scope only names resources the caller owns.
  const { error } = await db.rpc("dms_configure", {
    p_config: {
      inactivityPeriodDays: body.inactivityPeriodDays,
      checkInFrequencyDays: body.checkInFrequencyDays,
      escalationDelayHours: body.escalationDelayHours,
      escalationRules: body.escalationRules,
    } as never,
    p_contact_beneficiary_ids: body.contactBeneficiaryIds,
    p_release_scope: body.releaseScope as never,
    p_corr: correlationId,
  });
  if (error) throw error;

  const result = await getSwitch(user);
  if (!result) throw ApiError.internal(new Error("switch missing after configure"));
  return result;
}

async function call(
  user: AppUser,
  fn: "dms_check_in" | "dms_pause" | "dms_resume" | "dms_disable" | "dms_cancel_escalation",
  correlationId: string,
): Promise<DeadManSwitch | null> {
  assertAccountActive(user);
  const db = await createUserClient();
  const { error } = await db.rpc(fn, { p_corr: correlationId });
  if (error) throw error;
  return getSwitch(user);
}

/** FR-I003: the route additionally requires MFA re-verification. */
export const checkIn = (user: AppUser, correlationId: string) =>
  call(user, "dms_check_in", correlationId);
export const pause = (user: AppUser, correlationId: string) =>
  call(user, "dms_pause", correlationId);
export const resume = (user: AppUser, correlationId: string) =>
  call(user, "dms_resume", correlationId);
export const disable = (user: AppUser, correlationId: string) =>
  call(user, "dms_disable", correlationId);
/** Recovery at any escalation stage, including after release (FR-I007). */
export const cancelEscalation = (user: AppUser, correlationId: string) =>
  call(user, "dms_cancel_escalation", correlationId);
