import "server-only";

import { ApiError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createUserClient, type TypedSupabaseClient } from "@/lib/db/server";
import { computeCompleteness, type CompletenessContext } from "@/lib/legacy-plan/completeness";
import * as assetRepository from "@/lib/repositories/asset.repository";
import * as planRepository from "@/lib/repositories/legacy-plan.repository";
import type { AssetKind } from "@/lib/types/asset";
import { ACTIVE_PLAN_SECTION_KEYS } from "@/lib/types/legacy-plan";
import type {
  LegacyPlan,
  LegacyPlanOverview,
  PlanReview,
  PlanSectionKey,
  PlanVersionDetail,
  PlanVersionSummary,
  SavePlanStepResult,
} from "@/lib/types/legacy-plan";
import {
  fieldErrors,
  sectionDraftSchemas,
  type FinalizePlanBody,
  type SavePlanStepBody,
} from "@/lib/validators/legacy-plan.validators";

/**
 * Legacy-plan service (tasks T057–T070, api-contracts.md § Legacy Plans).
 *
 * The lifecycle is the database's and is not re-implemented here:
 *  • `create_legacy_plan()` — 409 `DRAFT_EXISTS` when one is already open
 *    (a partial unique index backs the same rule);
 *  • `save_plan_step()` — validates the section key, refuses a plan that is not
 *    DRAFT, compares `lockVersion` under a row lock, merges the section and
 *    records its completeness;
 *  • `finalize_legacy_plan()` — requires Personal Details, requires an explicit
 *    acknowledgement for anything else incomplete, writes an immutable snapshot
 *    and flips the plan to FINALIZED;
 *  • `create_plan_draft()` — only from a FINALIZED plan, and only when no draft
 *    is open.
 *
 * A finalized plan is therefore immutable at the database, not merely disabled
 * in React: `legacy_plans` has no UPDATE grant for `authenticated` at all, so
 * there is no statement this service could issue to change one.
 */

/* ── Reads ────────────────────────────────────────────────────────────────── */

export async function getOverview(user: AppUser): Promise<LegacyPlanOverview> {
  const db = await createUserClient();
  const [plans, versions] = await Promise.all([
    planRepository.list(db, user.id),
    planRepository.listVersions(db, user.id),
  ]);
  const current = plans.find((plan) => plan.status === "DRAFT") ?? plans[0] ?? null;
  return { current, plans, versions };
}

export async function getPlan(user: AppUser, id: string): Promise<LegacyPlan> {
  const db = await createUserClient();
  const plan = await planRepository.findById(db, user.id, id);
  if (!plan) throw ApiError.notFound();
  return plan;
}

export async function listVersions(
  user: AppUser,
  planId: string,
): Promise<{ items: PlanVersionSummary[] }> {
  const db = await createUserClient();
  const plan = await planRepository.findById(db, user.id, planId);
  if (!plan) throw ApiError.notFound();
  return { items: await planRepository.listVersions(db, user.id, planId) };
}

export async function getVersion(
  user: AppUser,
  planId: string,
  versionId: string,
): Promise<PlanVersionDetail> {
  const db = await createUserClient();
  const version = await planRepository.findVersion(db, user.id, planId, versionId);
  if (!version) throw ApiError.notFound();
  return version;
}

/* ── Lifecycle ────────────────────────────────────────────────────────────── */

export async function createPlan(user: AppUser, correlationId: string): Promise<LegacyPlan> {
  assertAccountActive(user);
  const db = await createUserClient();

  const { data, error } = await db.rpc("create_legacy_plan", { p_corr: correlationId });
  if (error) throw error;

  const plan = await planRepository.findById(db, user.id, data as string);
  if (!plan) throw ApiError.internal(new Error("plan disappeared after creation"));
  return plan;
}

/**
 * Returns the caller's open draft, creating one on first use.
 *
 * The wizard calls this on mount, so the `DRAFT_EXISTS` race between two tabs
 * resolves by re-reading rather than surfacing a 409 the user cannot act on.
 */
export async function getOrCreateDraft(user: AppUser, correlationId: string): Promise<LegacyPlan> {
  const db = await createUserClient();
  const existing = await planRepository.findDraft(db, user.id);
  if (existing) return existing;

  assertAccountActive(user);
  try {
    return await createPlan(user, correlationId);
  } catch (caught) {
    const conflict = await planRepository.findDraft(db, user.id);
    if (conflict) return conflict;
    throw caught;
  }
}

export async function savePlanStep(
  user: AppUser,
  planId: string,
  step: PlanSectionKey,
  body: SavePlanStepBody,
  correlationId: string,
): Promise<SavePlanStepResult> {
  assertAccountActive(user);
  const db = await createUserClient();

  const plan = await planRepository.findById(db, user.id, planId);
  if (!plan) throw ApiError.notFound();
  // The guarded function refuses this too; failing here keeps the message clear.
  if (plan.status !== "DRAFT") {
    throw ApiError.conflict("CONFLICT", "This plan is finalized and can no longer be edited.");
  }

  // The draft's shape is validated here (types, lengths, id formats; unknown
  // keys dropped). Completeness is a separate question, answered below.
  const parsed = sectionDraftSchemas[step].safeParse(body.data);
  if (!parsed.success) {
    const fields: Record<string, string[]> = {};
    for (const [key, message] of Object.entries(fieldErrors(parsed.error))) {
      fields[`data.${key}`] = [message];
    }
    throw ApiError.validation(
      fields,
      "Some of this section could not be saved. Check the highlighted fields.",
    );
  }
  const sectionData = parsed.data as Record<string, unknown>;

  // Completeness is decided server-side against the real records, then handed
  // to save_plan_step() as `isComplete`. A client cannot claim a section is
  // complete when the records it references do not exist.
  const complete = await isSectionComplete(db, user, step, sectionData);

  const { data, error } = await db.rpc("save_plan_step", {
    p_plan_id: planId,
    p_step: step,
    p_data: { ...sectionData, isComplete: complete } as never,
    p_expected_lock_version: body.lockVersion,
    p_corr: correlationId,
  });
  if (error) throw error;

  const result = (data ?? {}) as { lockVersion?: number; complete?: boolean };
  return {
    lockVersion: result.lockVersion ?? body.lockVersion + 1,
    step,
    complete: result.complete ?? complete,
  };
}

export async function reviewPlan(user: AppUser, planId: string): Promise<PlanReview> {
  const db = await createUserClient();
  const plan = await planRepository.findById(db, user.id, planId);
  if (!plan) throw ApiError.notFound();

  const context = await completenessContext(db, user, plan.stepsData);
  const completeness = computeCompleteness(context);

  // Cross-entity advisory check (FR-D005): assets with nobody assigned.
  const assignments = await db
    .from("beneficiary_assignments")
    .select("resource_id")
    .eq("user_id", user.id);
  if (assignments.error) throw assignments.error;
  const assigned = new Set((assignments.data ?? []).map((row) => row.resource_id));
  const unassignedAssetCount = context.assets.filter((asset) => !assigned.has(asset.id)).length;

  const personalDetailsComplete = completeness.sections["personal-details"].complete;
  return {
    ...completeness,
    planId,
    status: plan.status,
    version: plan.version,
    lockVersion: plan.lockVersion,
    unassignedAssetCount,
    personalDetailsComplete,
    canFinalize: plan.status === "DRAFT" && personalDetailsComplete,
  };
}

export async function finalizePlan(
  user: AppUser,
  planId: string,
  body: FinalizePlanBody,
  correlationId: string,
): Promise<{ planId: string; versionId: string; plan: LegacyPlan }> {
  assertAccountActive(user);
  const db = await createUserClient();

  const plan = await planRepository.findById(db, user.id, planId);
  if (!plan) throw ApiError.notFound();

  // Optimistic concurrency, before anything is written: finalization snapshots
  // the plan permanently, so a caller holding a stale view must not be able to
  // freeze content it never saw. The refresh below advances `lockVersion`, so
  // this comparison has to happen first — `finalize_legacy_plan()` would
  // otherwise only ever see the server's own, always-matching value.
  if (plan.lockVersion !== body.lockVersion) {
    throw new ApiError(
      409,
      "LOCK_CONFLICT",
      "This was changed somewhere else. Reload and try again.",
      {
        details: { lockVersion: plan.lockVersion },
      },
    );
  }

  // Sections are re-evaluated and re-saved next, so the snapshot's
  // `completion_status` reflects the records as they are right now rather than
  // whatever the browser last sent.
  const lockVersion = await refreshCompletionStatus(db, user, plan, correlationId);

  const { data, error } = await db.rpc("finalize_legacy_plan", {
    p_plan_id: planId,
    p_expected_lock_version: lockVersion,
    p_acknowledge_incomplete: body.acknowledgeIncomplete ?? false,
    p_corr: correlationId,
  });
  if (error) throw error;

  const finalized = await planRepository.findById(db, user.id, planId);
  if (!finalized) throw ApiError.internal(new Error("plan disappeared after finalization"));

  return { planId, versionId: data as string, plan: finalized };
}

export async function createNewDraft(
  user: AppUser,
  fromPlanId: string,
  correlationId: string,
): Promise<LegacyPlan> {
  assertAccountActive(user);
  const db = await createUserClient();

  const { data, error } = await db.rpc("create_plan_draft", {
    p_from_plan_id: fromPlanId,
    p_corr: correlationId,
  });
  if (error) throw error;

  const draft = await planRepository.findById(db, user.id, data as string);
  if (!draft) throw ApiError.internal(new Error("draft disappeared after creation"));
  return draft;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Which records each section's completeness rule actually cross-checks. */
const SECTION_REQUIREMENTS: Record<
  PlanSectionKey,
  { beneficiaries?: true; assetKind?: AssetKind; documents?: true }
> = {
  "personal-details": {},
  "family-information": {},
  beneficiaries: { beneficiaries: true },
  "financial-assets": { assetKind: "FINANCIAL_ASSET" },
  "physical-assets": { assetKind: "PHYSICAL_ASSET" },
  "digital-assets": { assetKind: "DIGITAL_ASSET" },
  "witness-details": {},
  "special-wishes": {},
  "document-attachments": { documents: true },
};

/**
 * Completeness of the one section being saved.
 *
 * Auto-save is the hottest write path in the application, so it reads only the
 * records that section's rule refers to — most sections refer to none, and
 * loading the whole inventory on every keystroke burst would be five queries
 * for an answer that cannot depend on them.
 */
async function isSectionComplete(
  db: TypedSupabaseClient,
  user: AppUser,
  step: PlanSectionKey,
  data: Record<string, unknown>,
): Promise<boolean> {
  const needs = SECTION_REQUIREMENTS[step];

  const [beneficiaries, assetIds, documents] = await Promise.all([
    needs.beneficiaries
      ? db.from("beneficiaries").select("id, status").eq("user_id", user.id).is("deleted_at", null)
      : null,
    needs.assetKind ? assetRepository.listIds(db, user.id, needs.assetKind) : null,
    needs.documents
      ? db.from("documents").select("id").eq("user_id", user.id).is("deleted_at", null)
      : null,
  ]);
  if (beneficiaries?.error) throw beneficiaries.error;
  if (documents?.error) throw documents.error;

  // Only this section's entry is supplied, and only this section's verdict is
  // read: every rule in `computeCompleteness` looks at its own key alone.
  return computeCompleteness({
    stepsData: { [step]: data },
    beneficiaries: beneficiaries?.data ?? [],
    assets: (assetIds ?? []).map((id) => ({ id, kind: needs.assetKind! })),
    documents: documents?.data ?? [],
  }).sections[step].complete;
}

/**
 * The records the completeness rules cross-check against: a section that
 * points at a deleted beneficiary, asset or document is incomplete again.
 */
async function completenessContext(
  db: TypedSupabaseClient,
  user: AppUser,
  stepsData: LegacyPlan["stepsData"],
): Promise<CompletenessContext> {
  const [beneficiaries, financial, physical, digital, documents] = await Promise.all([
    db.from("beneficiaries").select("id, status").eq("user_id", user.id).is("deleted_at", null),
    assetRepository.listIds(db, user.id, "FINANCIAL_ASSET"),
    assetRepository.listIds(db, user.id, "PHYSICAL_ASSET"),
    assetRepository.listIds(db, user.id, "DIGITAL_ASSET"),
    db.from("documents").select("id").eq("user_id", user.id).is("deleted_at", null),
  ]);
  if (beneficiaries.error) throw beneficiaries.error;
  if (documents.error) throw documents.error;

  return {
    stepsData,
    beneficiaries: beneficiaries.data ?? [],
    assets: [
      ...financial.map((id) => ({ id, kind: "FINANCIAL_ASSET" as const })),
      ...physical.map((id) => ({ id, kind: "PHYSICAL_ASSET" as const })),
      ...digital.map((id) => ({ id, kind: "DIGITAL_ASSET" as const })),
    ],
    documents: documents.data ?? [],
  };
}

/**
 * Re-saves every section whose recorded completeness no longer matches the
 * records, returning the lock version to finalize against.
 *
 * Without this a section could stay marked complete after the asset it points
 * at was deleted, and the snapshot would record a completeness that was never
 * true. Each correction is one `save_plan_step()` call, so it is audited.
 */
async function refreshCompletionStatus(
  db: TypedSupabaseClient,
  user: AppUser,
  plan: LegacyPlan,
  correlationId: string,
): Promise<number> {
  if (plan.status !== "DRAFT") return plan.lockVersion;

  const context = await completenessContext(db, user, plan.stepsData);
  const completeness = computeCompleteness(context);
  let lockVersion = plan.lockVersion;

  for (const key of ACTIVE_PLAN_SECTION_KEYS) {
    const section = completeness.sections[key];
    const recorded = plan.completionStatus[key] ?? false;
    const saved = plan.stepsData[key];
    // Only sections the user has actually touched are corrected; an untouched
    // section is already recorded as incomplete.
    if (!saved || recorded === section.complete) continue;

    const { data, error } = await db.rpc("save_plan_step", {
      p_plan_id: plan.id,
      p_step: key,
      p_data: { ...saved, isComplete: section.complete } as never,
      p_expected_lock_version: lockVersion,
      p_corr: correlationId,
    });
    if (error) throw error;
    lockVersion = ((data ?? {}) as { lockVersion?: number }).lockVersion ?? lockVersion + 1;
  }

  return lockVersion;
}
