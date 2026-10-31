import type { Database } from "@/lib/types/database";

/**
 * Legacy-plan view models shared by the server and the browser.
 *
 * Mirrors `legacy_plans` / `legacy_plan_versions` in 0001_init.sql. The
 * lifecycle is the database's: a single DRAFT per user, `save_plan_step()`
 * writes sections under an optimistic `lockVersion`, `finalize_legacy_plan()`
 * snapshots and locks the plan, and `create_plan_draft()` opens the next one.
 */
export type LegacyPlanStatus = Database["public"]["Enums"]["legacy_plan_status"];

/** Section keys — data-model.md § 9, and the `c_sections` array in 0003. */
export const PLAN_SECTION_KEYS = [
  "personal-details",
  "family-information",
  "beneficiaries",
  "financial-assets",
  "physical-assets",
  "digital-assets",
  "witness-details",
  "special-wishes",
  "document-attachments",
] as const;
export type PlanSectionKey = (typeof PLAN_SECTION_KEYS)[number];
export const ACTIVE_PLAN_SECTION_KEYS = [
  "personal-details",
  "family-information",
  "beneficiaries",
  "special-wishes",
  "document-attachments",
] as const satisfies readonly PlanSectionKey[];

export type PlanStepsData = Partial<Record<PlanSectionKey, Record<string, unknown>>>;

export interface LegacyPlan {
  id: string;
  status: LegacyPlanStatus;
  version: number;
  currentStep: number;
  stepsData: PlanStepsData;
  /** What the database recorded per section when each step was saved. */
  completionStatus: Partial<Record<PlanSectionKey, boolean>>;
  lockVersion: number;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanVersionSummary {
  id: string;
  planId: string;
  versionNumber: number;
  finalizedAt: string;
  acknowledgedIncomplete: boolean;
  incompleteSections: PlanSectionKey[];
  createdAt: string;
}

export interface PlanVersionDetail extends PlanVersionSummary {
  snapshotData: Record<string, unknown>;
  completeness: Record<string, unknown>;
}

export interface SectionCompleteness {
  key: PlanSectionKey;
  title: string;
  required: boolean;
  complete: boolean;
  /** The owner chose "Skip for now" and has not completed it since. */
  skipped?: boolean;
  summary: string;
}

export interface PlanCompleteness {
  sections: Record<PlanSectionKey, SectionCompleteness>;
  incompleteSections: PlanSectionKey[];
  percent: number;
}

/** `POST /legacy-plans/:id/review` — completeness plus the cross-entity checks. */
export interface PlanReview extends PlanCompleteness {
  planId: string;
  status: LegacyPlanStatus;
  version: number;
  lockVersion: number;
  /** Assets in the plan with no beneficiary assignment (advisory, not blocking). */
  unassignedAssetCount: number;
  /** Section that can never be acknowledged away (`PERSONAL_DETAILS_REQUIRED`). */
  personalDetailsComplete: boolean;
  canFinalize: boolean;
}

export interface SavePlanStepResult {
  lockVersion: number;
  step: PlanSectionKey;
  complete: boolean;
}

export interface LegacyPlanOverview {
  current: LegacyPlan | null;
  plans: LegacyPlan[];
  versions: PlanVersionSummary[];
}
