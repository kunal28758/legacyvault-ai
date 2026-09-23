import "server-only";

import { ApiError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createUserClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";
import * as emergencyRepository from "@/lib/repositories/emergency-access.repository";
import { resendDesignation } from "@/lib/services/emergency-public.service";
import type { EmergencyAccessOverview, EmergencyContact } from "@/lib/types/emergency-access";
import type {
  EaContactCreateBody,
  EaContactUpdateBody,
} from "@/lib/validators/emergency-access.validators";

/**
 * Emergency access, owner side (FR-J001–J010).
 *
 * The public request flow — request, OTP, timeout — runs through service-role
 * functions on unauthenticated endpoints. Everything here is the owner acting
 * on their own configuration, and every write is a guarded `ea_*` function that
 * re-checks ownership and the request's current state.
 */
export async function getOverview(user: AppUser): Promise<EmergencyAccessOverview> {
  const db = await createUserClient();
  const contacts = await emergencyRepository.listContacts(db, user.id);
  const requests = await emergencyRepository.listRequests(db, user.id, contacts);
  return { contacts, requests };
}

export async function configureContact(
  user: AppUser,
  body: EaContactCreateBody,
  correlationId: string,
): Promise<EmergencyContact> {
  assertAccountActive(user);
  const db = await createUserClient();

  const { data, error } = await db.rpc("ea_configure_contact", {
    p_beneficiary_id: body.beneficiaryId,
    p_access_scope: body.accessScope as never,
    p_on_timeout: body.onTimeout,
    p_timeout_hours: body.timeoutHours ?? undefined,
    p_request_expiry_hours: body.requestExpiryHours,
    p_access_duration_hours: body.accessDurationHours,
    p_corr: correlationId,
  });
  if (error) throw error;

  // Designation is only real once the person has been told where to ask.
  // A mail failure must not undo the configuration, so it is logged and the
  // owner can resend from the page.
  try {
    await resendDesignation(user.id, data as string, correlationId);
  } catch (cause) {
    logger.error({ err: cause, correlationId }, "designation email failed");
  }

  const contacts = await emergencyRepository.listContacts(db, user.id);
  const created = contacts.find((contact) => contact.id === (data as string));
  if (!created) throw ApiError.internal(new Error("contact missing after configure"));
  return created;
}

export async function updateContact(
  user: AppUser,
  configId: string,
  body: EaContactUpdateBody,
  correlationId: string,
): Promise<EmergencyContact> {
  assertAccountActive(user);
  const db = await createUserClient();

  const existing = await emergencyRepository.findConfig(db, user.id, configId);
  if (!existing) throw ApiError.notFound();

  const { error } = await db.rpc("ea_update_contact", {
    p_config_id: configId,
    p_access_scope: (body.accessScope ?? undefined) as never,
    p_on_timeout: body.onTimeout ?? undefined,
    p_timeout_hours: body.timeoutHours ?? undefined,
    p_request_expiry_hours: body.requestExpiryHours ?? undefined,
    p_access_duration_hours: body.accessDurationHours ?? undefined,
    p_corr: correlationId,
  });
  if (error) throw error;

  const contacts = await emergencyRepository.listContacts(db, user.id);
  const updated = contacts.find((contact) => contact.id === configId);
  if (!updated) throw ApiError.internal(new Error("contact missing after update"));
  return updated;
}

export async function removeContact(
  user: AppUser,
  configId: string,
  correlationId: string,
): Promise<{ id: string }> {
  assertAccountActive(user);
  const db = await createUserClient();

  const existing = await emergencyRepository.findConfig(db, user.id, configId);
  if (!existing) throw ApiError.notFound();

  const { error } = await db.rpc("ea_remove_contact", {
    p_config_id: configId,
    p_corr: correlationId,
  });
  if (error) throw error;
  return { id: configId };
}

export async function decideRequest(
  user: AppUser,
  requestId: string,
  decision: "APPROVE" | "DENY",
  correlationId: string,
): Promise<EmergencyAccessOverview> {
  assertAccountActive(user);
  const db = await createUserClient();

  // Approving queues the delivery job; the token itself is minted there, never
  // here, so no plaintext link passes through this request.
  const { error } = await db.rpc("ea_decide_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_corr: correlationId,
  });
  if (error) throw error;
  return getOverview(user);
}

export async function revokeRequest(
  user: AppUser,
  requestId: string,
  correlationId: string,
): Promise<EmergencyAccessOverview> {
  assertAccountActive(user);
  const db = await createUserClient();

  const { error } = await db.rpc("ea_revoke", { p_request_id: requestId, p_corr: correlationId });
  if (error) throw error;
  return getOverview(user);
}
