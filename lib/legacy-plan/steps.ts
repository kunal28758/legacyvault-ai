import type { PlanSectionKey } from "@/lib/types/legacy-plan";

/**
 * The eleven wizard steps (FR-C001).
 *
 * Steps 1–9 map one-to-one onto the section keys the database stores; steps 10
 * and 11 are review and confirmation, which hold no data of their own. Lifted
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
    key: "financial-assets",
    title: "Financial Assets",
    description: "Accounts, insurance, investments",
  },
  {
    step: 5,
    key: "physical-assets",
    title: "Physical Assets",
    description: "Property, vehicles, valuables",
  },
  {
    step: 6,
    key: "digital-assets",
    title: "Digital Assets",
    description: "Accounts, domains, wallets",
  },
  {
    step: 7,
    key: "witness-details",
    title: "Witness Details",
    description: "People who witness the plan",
  },
  {
    step: 8,
    key: "special-wishes",
    title: "Special Wishes",
    description: "Instructions and messages",
  },
  {
    step: 9,
    key: "document-attachments",
    title: "Document Attachments",
    description: "Supporting vault documents",
  },
  { step: 10, key: "review", title: "Review", description: "Check everything before finalizing" },
  { step: 11, key: "confirmation", title: "Confirmation", description: "Finalized plan summary" },
];

export const TOTAL_PLAN_STEPS = 11;

export function stepForSection(key: PlanSectionKey): number {
  return PLAN_STEPS.find((step) => step.key === key)?.step ?? 1;
}
