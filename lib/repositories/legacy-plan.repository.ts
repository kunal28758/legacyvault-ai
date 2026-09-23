import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type {
  LegacyPlan,
  PlanSectionKey,
  PlanStepsData,
  PlanVersionDetail,
  PlanVersionSummary,
} from "@/lib/types/legacy-plan";
import type { Database } from "@/lib/types/database";

/**
 * Legacy-plan data access (tasks T057–T070).
 *
 * `legacy_plans` is Class B end to end: there is no INSERT, UPDATE or DELETE
 * grant for `authenticated` at all (0002 § 6). Every mutation runs inside
 * `create_legacy_plan()`, `save_plan_step()`, `finalize_legacy_plan()` or
 * `create_plan_draft()`, which is what makes a finalized plan immutable in the
 * database rather than only in the UI. This repository therefore reads.
 */
export type LegacyPlanRow = Database["public"]["Tables"]["legacy_plans"]["Row"];
export type PlanVersionRow = Database["public"]["Tables"]["legacy_plan_versions"]["Row"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toLegacyPlan(row: LegacyPlanRow): LegacyPlan {
  const completion = asRecord(row.completion_status);
  return {
    id: row.id,
    status: row.status,
    version: row.version,
    currentStep: row.current_step,
    stepsData: asRecord(row.steps_data) as PlanStepsData,
    completionStatus: Object.fromEntries(
      Object.entries(completion).map(([key, value]) => [key, value === true]),
    ) as Partial<Record<PlanSectionKey, boolean>>,
    lockVersion: row.lock_version,
    finalizedAt: row.finalized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toVersionSummary(row: PlanVersionRow): PlanVersionSummary {
  return {
    id: row.id,
    versionNumber: row.version_number,
    finalizedAt: row.finalized_at,
    acknowledgedIncomplete: row.acknowledged_incomplete,
    incompleteSections: (row.incomplete_sections ?? []) as PlanSectionKey[],
    createdAt: row.created_at,
  };
}

/** The caller's single open draft, if one exists (unique index enforces "single"). */
export async function findDraft(
  db: TypedSupabaseClient,
  userId: string,
): Promise<LegacyPlan | null> {
  const { data, error } = await db
    .from("legacy_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "DRAFT")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? toLegacyPlan(data) : null;
}

export async function findById(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
): Promise<LegacyPlan | null> {
  const { data, error } = await db
    .from("legacy_plans")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? toLegacyPlan(data) : null;
}

/** Draft first, then finalized plans newest-first — the order the overview renders. */
export async function list(db: TypedSupabaseClient, userId: string): Promise<LegacyPlan[]> {
  const { data, error } = await db
    .from("legacy_plans")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toLegacyPlan);
}

/** The most recent plan of any status — what the overview falls back to. */
export async function findLatest(
  db: TypedSupabaseClient,
  userId: string,
): Promise<LegacyPlan | null> {
  const plans = await list(db, userId);
  return plans.find((plan) => plan.status === "DRAFT") ?? plans[0] ?? null;
}

export async function listVersions(
  db: TypedSupabaseClient,
  userId: string,
  planId?: string,
): Promise<PlanVersionSummary[]> {
  // RLS on `legacy_plan_versions` is an EXISTS against the owning plan, so the
  // plan ids are resolved first and the version query is scoped to them.
  const plans = await list(db, userId);
  const ids = planId
    ? plans.filter((plan) => plan.id === planId).map((p) => p.id)
    : plans.map((p) => p.id);
  if (ids.length === 0) return [];

  const { data, error } = await db
    .from("legacy_plan_versions")
    .select("*")
    .in("legacy_plan_id", ids)
    .order("version_number", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toVersionSummary);
}

export async function findVersion(
  db: TypedSupabaseClient,
  userId: string,
  planId: string,
  versionId: string,
): Promise<PlanVersionDetail | null> {
  const plan = await findById(db, userId, planId);
  if (!plan) return null;

  const { data, error } = await db
    .from("legacy_plan_versions")
    .select("*")
    .eq("id", versionId)
    .eq("legacy_plan_id", planId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    ...toVersionSummary(data),
    snapshotData: asRecord(data.snapshot_data),
    completeness: asRecord(data.completeness),
  };
}
