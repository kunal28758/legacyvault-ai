import "server-only";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createUserClient } from "@/lib/db/server";
import * as assetRepository from "@/lib/repositories/asset.repository";
import { decryptStoredEnvelope, encrypt } from "@/lib/security/encryption";
import type {
  Asset,
  AssetAssignment,
  AssetAssignmentsResult,
  AssetKind,
  AssetListResult,
  AssetWithAssignments,
  RevealedSensitiveFields,
} from "@/lib/types/asset";
import type {
  AssetAssignBody,
  AssetCreateBody,
  AssetListQuery,
  AssetUpdateBody,
} from "@/lib/validators/asset.validators";

/**
 * Asset service for the three classes (tasks T079–T090).
 *
 * Write classes, from 0002_rls_and_privileges.sql § 5 and 0003_functions.sql:
 *  • creation is Class B — `create_asset()` is the only insert path, and it is
 *    also the only place an encryption envelope may be written on insert;
 *  • plain-column edits are Class A through the user client, so RLS and the
 *    `*_audit_class_a` trigger both apply;
 *  • the ENCRYPTED columns (`account_number`, `policy_number`, `credentials`,
 *    `recovery_info`) are written only by `set_encrypted_fields()`;
 *  • deletion is Class B — `delete_asset()` removes assignments and document
 *    attachments and soft-deletes the row in one transaction;
 *  • assignment is Class B — `assign_beneficiary()` locks the resource row,
 *    refuses INACTIVE beneficiaries and enforces Σ allocation ≤ 100.
 *
 * Plaintext never leaves this module except through `revealSensitiveFields()`,
 * which the route gates behind Clerk re-verification and which audits the read.
 */

/* ── Reads ────────────────────────────────────────────────────────────────── */

export async function listAssets(
  user: AppUser,
  kind: AssetKind,
  query: AssetListQuery,
): Promise<AssetListResult> {
  const db = await createUserClient();
  const [{ rows, total }, assignments] = await Promise.all([
    assetRepository.list(db, user.id, kind, {
      category: query.category,
      search: query.q,
      page: query.page,
      limit: query.limit,
    }),
    assetRepository.listAssignmentsByKind(db, user.id, kind),
  ]);

  const names = await assetRepository.beneficiaryNames(
    db,
    user.id,
    assignments.map((a) => a.beneficiaryId),
  );

  return {
    items: rows.map((asset) => withAssignments(asset, assignments, names)),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getAsset(
  user: AppUser,
  kind: AssetKind,
  id: string,
): Promise<AssetWithAssignments> {
  const db = await createUserClient();
  const asset = await assetRepository.findById(db, user.id, kind, id);
  if (!asset) throw ApiError.notFound();

  const assignments = await assetRepository.listAssignmentsByKind(db, user.id, kind, id);
  const names = await assetRepository.beneficiaryNames(
    db,
    user.id,
    assignments.map((a) => a.beneficiaryId),
  );
  return withAssignments(asset, assignments, names);
}

export async function listAssignments(
  user: AppUser,
  kind: AssetKind,
  id: string,
): Promise<AssetAssignmentsResult> {
  const detail = await getAsset(user, kind, id);
  return {
    items: detail.assignments,
    allocatedPercentage: detail.allocatedPercentage,
    remainingPercentage: detail.remainingPercentage,
  };
}

/* ── Class B creation ─────────────────────────────────────────────────────── */

const ENCRYPTED_KEYS_BY_KIND: Record<AssetKind, readonly string[]> = {
  FINANCIAL_ASSET: ["accountNumber", "policyNumber"],
  PHYSICAL_ASSET: [],
  DIGITAL_ASSET: ["credentials", "recoveryInfo"],
};

export async function createAsset(
  user: AppUser,
  kind: AssetKind,
  input: AssetCreateBody,
  correlationId: string,
): Promise<Asset> {
  assertAccountActive(user);
  const db = await createUserClient();

  const { plain, encrypted } = splitInput(kind, input as Record<string, unknown>);

  // create_asset() re-validates the key allow-list, the currency pattern and
  // every envelope shape inside the transaction (`lv_envelope_text`).
  const { data, error } = await db.rpc("create_asset", {
    p_resource_type: kind,
    p_plain: plain as never,
    p_encrypted: encrypted as never,
    p_corr: correlationId,
  });
  if (error) throw error;

  const created = await assetRepository.findById(db, user.id, kind, data as string);
  if (!created) throw ApiError.internal(new Error("asset disappeared after creation"));
  return created;
}

/* ── Class A update + guarded encrypted write ─────────────────────────────── */

export async function updateAsset(
  user: AppUser,
  kind: AssetKind,
  id: string,
  input: AssetUpdateBody,
  correlationId: string,
): Promise<Asset> {
  assertAccountActive(user);
  const db = await createUserClient();

  const before = await assetRepository.findById(db, user.id, kind, id);
  if (!before) throw ApiError.notFound();

  const { plain, encrypted } = splitInput(kind, input as Record<string, unknown>);
  const patch = toColumnPatch(kind, plain);

  let updated = before;
  if (Object.keys(patch).length > 0) {
    updated = await assetRepository.update(db, user.id, kind, id, patch);
  }

  // Sensitive values are replaced only when the caller actually sent one; an
  // absent key leaves the stored envelope untouched (the form sends nothing to
  // keep the current value, which is why it can display a blank input).
  const encryptedKeys = Object.keys(encrypted);
  if (encryptedKeys.length > 0) {
    const { error } = await db.rpc("set_encrypted_fields", {
      p_resource_type: kind,
      p_resource_id: id,
      p_fields: encrypted as never,
      p_corr: correlationId,
    });
    if (error) throw error;
    updated = (await assetRepository.findById(db, user.id, kind, id)) ?? updated;
  }

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "asset.updated",
    resourceType: kind,
    resourceId: id,
    outcome: "SUCCESS",
    // Never the values: `changedEncrypted` names the fields only.
    metadata: {
      changed: Object.keys(patch),
      changedEncrypted: encryptedKeys,
    },
    correlationId,
  });

  return updated;
}

/* ── Class B deletion ─────────────────────────────────────────────────────── */

export async function deleteAsset(
  user: AppUser,
  kind: AssetKind,
  id: string,
  correlationId: string,
): Promise<{ id: string }> {
  assertAccountActive(user);
  const db = await createUserClient();

  // delete_asset() is one transaction: assignments removed, document
  // attachments removed, row soft-deleted, audit written.
  const { error } = await db.rpc("delete_asset", {
    p_resource_type: kind,
    p_asset_id: id,
    p_corr: correlationId,
  });
  if (error) throw error;
  return { id };
}

/* ── Class B assignment ───────────────────────────────────────────────────── */

export async function assignBeneficiary(
  user: AppUser,
  kind: AssetKind,
  id: string,
  body: AssetAssignBody,
  correlationId: string,
): Promise<AssetAssignmentsResult> {
  assertAccountActive(user);
  const db = await createUserClient();

  // Application-level authorization first, so a caller never learns from the
  // error whether somebody else's asset or beneficiary id exists.
  const asset = await assetRepository.findById(db, user.id, kind, id);
  if (!asset) throw ApiError.notFound();

  const { data: beneficiary, error: beneficiaryError } = await db
    .from("beneficiaries")
    .select("id, status")
    .eq("id", body.beneficiaryId)
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

  const { error } = await db.rpc("assign_beneficiary", {
    p_beneficiary_id: body.beneficiaryId,
    p_resource_type: kind,
    p_resource_id: id,
    p_allocation: body.allocationPercentage ?? undefined,
    p_corr: correlationId,
  });
  if (error) throw error;

  return listAssignments(user, kind, id);
}

export async function unassignBeneficiary(
  user: AppUser,
  kind: AssetKind,
  id: string,
  assignmentId: string,
  correlationId: string,
): Promise<AssetAssignmentsResult> {
  assertAccountActive(user);
  const db = await createUserClient();

  // The assignment must belong to this caller *and* to the asset in the path.
  const assignments = await assetRepository.listAssignmentsByKind(db, user.id, kind, id);
  if (!assignments.some((assignment) => assignment.id === assignmentId)) throw ApiError.notFound();

  const { error } = await db.rpc("unassign_beneficiary", {
    p_assignment_id: assignmentId,
    p_corr: correlationId,
  });
  if (error) throw error;

  return listAssignments(user, kind, id);
}

/* ── Re-verified decrypt ──────────────────────────────────────────────────── */

/**
 * Returns the plaintext of an asset's encrypted fields (FR-G004/G005).
 *
 * The route requires Clerk step-up verification before this runs. The read is
 * audited with the field names — never the values — and the result is returned
 * once, for display; nothing caches it.
 */
export async function revealSensitiveFields(
  user: AppUser,
  kind: AssetKind,
  id: string,
  correlationId: string,
): Promise<RevealedSensitiveFields> {
  const db = await createUserClient();
  const asset = await assetRepository.findById(db, user.id, kind, id);
  if (!asset) throw ApiError.notFound();
  if (ENCRYPTED_KEYS_BY_KIND[kind].length === 0) {
    throw ApiError.notFound("This asset class has no encrypted fields.");
  }

  const envelopes = await assetRepository.findEncrypted(db, user.id, kind, id);
  if (!envelopes) throw ApiError.notFound();

  const revealed: RevealedSensitiveFields = {};
  const fields: string[] = [];
  for (const [field, stored] of Object.entries(envelopes)) {
    if (!stored) {
      Object.assign(revealed, { [field]: null });
      continue;
    }
    Object.assign(revealed, { [field]: decryptStored(stored) });
    fields.push(field);
  }

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "asset.sensitive_revealed",
    resourceType: kind,
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { fields, values: "[encrypted]" },
    correlationId,
  });

  return revealed;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function decryptStored(stored: string): string {
  try {
    return decryptStoredEnvelope(stored);
  } catch (error) {
    // A value that is not an envelope is never handed back as plaintext.
    throw ApiError.internal(error);
  }
}

/**
 * Splits a validated body into the plain payload `create_asset()` expects and
 * the encrypted payload, encrypting each secret here so plaintext never reaches
 * the database, the query log or an audit row.
 */
function splitInput(
  kind: AssetKind,
  input: Record<string, unknown>,
): { plain: Record<string, unknown>; encrypted: Record<string, unknown> } {
  const secretKeys = ENCRYPTED_KEYS_BY_KIND[kind];
  const plain: Record<string, unknown> = {};
  const encrypted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (secretKeys.includes(key)) {
      if (value === undefined) continue;
      // An explicit null clears the field; the function maps JSON null to SQL NULL.
      encrypted[key] = value === null ? null : encrypt(String(value));
      continue;
    }
    if (value === undefined) continue;
    plain[key] = value;
  }

  return { plain, encrypted };
}

/** Maps the camelCase body onto the Class A column allow-list. */
function toColumnPatch(kind: AssetKind, plain: Record<string, unknown>): Record<string, unknown> {
  const shared: Record<string, string> = {
    name: "name",
    category: "category",
    estimatedValue: "estimated_value",
    currency: "currency",
    notes: "notes",
  };
  const byKind: Record<AssetKind, Record<string, string>> = {
    FINANCIAL_ASSET: { ...shared, institution: "institution" },
    PHYSICAL_ASSET: {
      ...shared,
      description: "description",
      location: "location",
      ownershipDetails: "ownership_details",
    },
    DIGITAL_ASSET: { ...shared, platform: "platform", username: "username" },
  };

  const mapping = byKind[kind];
  const patch: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(mapping)) {
    if (key in plain) patch[column] = plain[key];
  }
  return patch;
}

function withAssignments(
  asset: Asset,
  assignments: assetRepository.ResourceAssignmentRow[],
  names: Map<string, string>,
): AssetWithAssignments {
  const mine = assignments.filter((assignment) => assignment.resourceId === asset.id);
  const items: AssetAssignment[] = mine.map((assignment) => ({
    id: assignment.id,
    beneficiaryId: assignment.beneficiaryId,
    beneficiaryName: names.get(assignment.beneficiaryId) ?? "Beneficiary",
    allocationPercentage: assignment.allocationPercentage,
    createdAt: assignment.createdAt,
  }));
  const allocated = items.reduce((sum, item) => sum + (item.allocationPercentage ?? 0), 0);
  return {
    asset,
    assignments: items,
    allocatedPercentage: allocated,
    remainingPercentage: Math.max(0, 100 - allocated),
  };
}
