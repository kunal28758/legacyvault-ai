import {
  PLAN_SECTION_KEYS,
  ACTIVE_PLAN_SECTION_KEYS,
  type PlanCompleteness,
  type PlanSectionKey,
  type PlanStepsData,
  type SectionCompleteness,
} from "@/lib/types/legacy-plan";

/**
 * Section completeness for a legacy plan (FR-C005/C007).
 *
 * Deliberately pure and free of any client: the API computes it before writing
 * `isComplete` through `save_plan_step()`, the review endpoint returns it, and
 * the wizard renders the same numbers without a second implementation. The
 * rules are the ones the demo workspace used, now evaluated against the real
 * beneficiaries, assets and documents instead of browser state.
 *
 * A section referencing records (beneficiaries, assets, documents) is complete
 * only while those records still exist and are eligible — deleting an asset
 * that a saved step points at makes that step incomplete again, which is the
 * behaviour the review step depends on.
 */
export const PLAN_SECTION_TITLES: Record<PlanSectionKey, string> = {
  "personal-details": "Personal Details",
  "family-information": "Family Information",
  beneficiaries: "Beneficiaries",
  "financial-assets": "Financial Assets",
  "physical-assets": "Physical Assets",
  "digital-assets": "Digital Assets",
  "witness-details": "Witness Details",
  "special-wishes": "Special Wishes",
  "document-attachments": "Document Attachments",
};

export const SKIPPED_SUMMARY = "Skipped — you can complete this later.";

export interface CompletenessContext {
  stepsData: PlanStepsData;
  beneficiaries: { id: string; status: string }[];
  assets: { id: string; kind: "FINANCIAL_ASSET" | "PHYSICAL_ASSET" | "DIGITAL_ASSET" }[];
  documents: { id: string }[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function computeCompleteness(context: CompletenessContext): PlanCompleteness {
  const data = context.stepsData;
  const sections = {} as Record<PlanSectionKey, SectionCompleteness>;

  const personal = asRecord(data["personal-details"]);
  sections["personal-details"] = {
    key: "personal-details",
    title: PLAN_SECTION_TITLES["personal-details"],
    required: true,
    complete: ["legalName", "dateOfBirth", "addressLine", "city", "country"].every((key) =>
      hasText(personal[key]),
    ),
    summary: hasText(personal.legalName)
      ? String(personal.legalName)
      : "Legal name, date of birth and address",
  };

  const family = asRecord(data["family-information"]);
  const children = Array.isArray(family.children) ? family.children.length : 0;
  sections["family-information"] = {
    key: "family-information",
    title: PLAN_SECTION_TITLES["family-information"],
    required: false,
    complete: hasText(family.maritalStatus),
    summary: hasText(family.maritalStatus)
      ? `${String(family.maritalStatus)} · ${children} ${children === 1 ? "child" : "children"}`
      : "Marital status and dependents",
  };

  const beneficiaryIds = stringList(asRecord(data.beneficiaries).beneficiaryIds).filter((id) =>
    context.beneficiaries.some((b) => b.id === id && b.status !== "INACTIVE"),
  );
  sections.beneficiaries = {
    key: "beneficiaries",
    title: PLAN_SECTION_TITLES.beneficiaries,
    required: false,
    complete: beneficiaryIds.length > 0,
    summary: beneficiaryIds.length
      ? `${beneficiaryIds.length} selected`
      : "No beneficiaries selected",
  };

  const wishes = asRecord(data["special-wishes"]);
  const wishFields = ["instructions", "funeralWishes", "messages"].filter((key) =>
    hasText(wishes[key]),
  );
  sections["special-wishes"] = {
    key: "special-wishes",
    title: PLAN_SECTION_TITLES["special-wishes"],
    required: false,
    complete: wishFields.length > 0,
    summary: wishFields.length ? `${wishFields.length} of 3 areas written` : "Nothing written yet",
  };

  const attachments = asRecord(data["document-attachments"]);
  const documentIds = stringList(attachments.documentIds).filter((id) =>
    context.documents.some((d) => d.id === id),
  );
  sections["document-attachments"] = {
    key: "document-attachments",
    title: PLAN_SECTION_TITLES["document-attachments"],
    required: false,
    complete: attachments.none === true || documentIds.length > 0,
    summary:
      attachments.none === true
        ? "Marked as none"
        : documentIds.length
          ? `${documentIds.length} attached`
          : "No documents attached",
  };

  for (const key of ["financial-assets", "physical-assets", "digital-assets", "witness-details"] as const) {
    sections[key] = {
      key,
      title: PLAN_SECTION_TITLES[key],
      required: false,
      complete: true,
      summary: "Archived data retained",
    };
  }

  // "Skip for now" is recorded on the section and shown as such, but it never
  // counts as complete: a skipped section is still incomplete at finalization.
  for (const key of PLAN_SECTION_KEYS) {
    const skipped = asRecord(data[key]).skipped === true && !sections[key].complete;
    sections[key].skipped = skipped;
    if (skipped) sections[key].summary = SKIPPED_SUMMARY;
  }

  const incompleteSections = ACTIVE_PLAN_SECTION_KEYS.filter((key) => !sections[key].complete);
  const percent = Math.round(
    ((ACTIVE_PLAN_SECTION_KEYS.length - incompleteSections.length) / ACTIVE_PLAN_SECTION_KEYS.length) * 100,
  );
  return { sections, incompleteSections, percent };
}

/** Completeness of a single section — what `save_plan_step()` records as `isComplete`. */
export function isSectionComplete(key: PlanSectionKey, context: CompletenessContext): boolean {
  return computeCompleteness(context).sections[key].complete;
}
