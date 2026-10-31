import type { PlanSectionKey } from "@/lib/types/legacy-plan";

/**
 * The seven wizard steps (FR-C001).
 *
 * Steps 1–5 map one-to-one onto the active section keys; steps 6 and 7 are
 * review and confirmation, which hold no data of their own. Lifted
 * out of the demo layer so the plan UI no longer imports it.
 */
export const PLAN_STEPS: {
  step: number;
  key: PlanSectionKey | "review" | "confirmation";
  title: string;
  description: string;
}[] = [
  {
    step: 1,
    key: "personal-details",
    title: "Personal Details",
    description: "Who this plan belongs to",
  },
  {
    step: 2,
    key: "family-information",
    title: "Family Information",
    description: "Spouse, children, dependents",
  },
  { step: 3, key: "beneficiaries", title: "Beneficiaries", description: "People who inherit" },
  {
    step: 4,
    key: "special-wishes",
    title: "Special Wishes",
    description: "Instructions and messages",
  },
  {
    step: 5,
    key: "document-attachments",
    title: "Document Attachments",
    description: "Supporting vault documents",
  },
  { step: 6, key: "review", title: "Review", description: "Check everything before finalizing" },
  { step: 7, key: "confirmation", title: "Confirmation", description: "Finalized plan summary" },
];

export const TOTAL_PLAN_STEPS = 7;

/** Maps a persisted pre-7-step cursor without changing any saved section data. */
export function normalizeWizardStep(step: number): number {
  if (step <= 3) return Math.max(step, 1);
  if (step <= 7) return 4;
  if (step === 8) return 4;
  if (step === 9) return 5;
  if (step === 10) return 6;
  return 7;
}

export function stepForSection(key: PlanSectionKey): number {
  return PLAN_STEPS.find((step) => step.key === key)?.step ?? 1;
}
