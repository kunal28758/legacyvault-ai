/**
 * Life events: things that happened in the owner's life that usually mean the
 * legacy should be reviewed. The owner records an event; the catalogue turns it
 * into recommended steps. Nothing is ever inferred or invented — an event exists
 * only because the owner recorded it, and is stored in their own preferences
 * (`users.preferences.lifeEvents`, the owner's existing writable column).
 *
 * To add an event type: add it to LIFE_EVENT_TYPES and give it a catalogue
 * entry. Steps reference stable ids so recorded progress survives copy edits.
 */
export const LIFE_EVENT_TYPES = [
  "MARRIAGE",
  "CHILD",
  "PROPERTY",
  "INSURANCE",
  "BUSINESS",
  "RETIREMENT",
  "FINANCIAL_CHANGE",
] as const;

export type LifeEventType = (typeof LIFE_EVENT_TYPES)[number];

/** A step whose completion can be read from real application state carries a `check`. */
export type LifeEventCheck = "beneficiary" | "willReviewed" | "documentCategory" | "asset";

export interface LifeEventStep {
  id: string;
  title: string;
  detail: string;
  href: string;
  /** When set, the step is complete once the state satisfies it. */
  check?: { kind: LifeEventCheck; category?: string };
}

export interface LifeEventDefinition {
  label: string;
  description: string;
  steps: LifeEventStep[];
}

const REVIEW_WILL: LifeEventStep = {
  id: "review-will",
  title: "Review your will",
  detail: "Check that your plan still reflects who should receive what.",
  href: "/legacy-plan",
  check: { kind: "willReviewed" },
};

export const LIFE_EVENT_CATALOGUE: Record<LifeEventType, LifeEventDefinition> = {
  MARRIAGE: {
    label: "Marriage",
    description: "A new spouse often changes beneficiaries and guardianship wishes.",
    steps: [
      {
        id: "add-spouse",
        title: "Add your spouse as a beneficiary",
        detail: "So they can receive what you assign to them.",
        href: "/beneficiaries?new=1",
        check: { kind: "beneficiary" },
      },
      REVIEW_WILL,
      {
        id: "store-certificate",
        title: "Store your marriage certificate",
        detail: "Upload it and set its category to Identity.",
        href: "/documents?upload=1",
        check: { kind: "documentCategory", category: "IDENTITY" },
      },
    ],
  },
  CHILD: {
    label: "New child",
    description: "A child usually means new beneficiaries and guardianship wishes.",
    steps: [
      {
        id: "add-child",
        title: "Add your child as a beneficiary",
        detail: "Recipients never need an account.",
        href: "/beneficiaries?new=1",
        check: { kind: "beneficiary" },
      },
      REVIEW_WILL,
      {
        id: "guardianship",
        title: "Record guardianship wishes",
        detail: "Use Special Wishes in your will to say who should care for them.",
        href: "/legacy-plan/wizard",
      },
    ],
  },
  PROPERTY: {
    label: "New property",
    description: "Record the property, its paperwork and who should receive it.",
    steps: [
      {
        id: "upload-deed",
        title: "Upload the property documents",
        detail: "Sale deed, title or lease — set the category to Property.",
        href: "/documents?upload=1",
        check: { kind: "documentCategory", category: "PROPERTY" },
      },
      {
        id: "record-asset",
        title: "Record the property as an asset",
        detail: "Then assign it to a beneficiary.",
        href: "/assets/physical?new=1",
        check: { kind: "asset" },
      },
      REVIEW_WILL,
      {
        id: "insurance",
        title: "Store the insurance policy",
        detail: "Set its category to Insurance so expiry can be tracked.",
        href: "/documents?upload=1",
        check: { kind: "documentCategory", category: "INSURANCE" },
      },
    ],
  },
  INSURANCE: {
    label: "New insurance policy",
    description: "Make sure the policy can be found and its expiry is tracked.",
    steps: [
      {
        id: "upload-policy",
        title: "Upload the policy",
        detail: "Set the category to Insurance and add its expiry date.",
        href: "/documents?upload=1",
        check: { kind: "documentCategory", category: "INSURANCE" },
      },
      {
        id: "share-policy",
        title: "Share it with the nominee",
        detail: "Documents shared with a beneficiary reach them only through scoped links.",
        href: "/documents",
      },
    ],
  },
  BUSINESS: {
    label: "New business",
    description: "Business interests need paperwork and a plan for who takes over.",
    steps: [
      {
        id: "upload-business",
        title: "Upload incorporation or partnership documents",
        detail: "Set the category to Business.",
        href: "/documents?upload=1",
        check: { kind: "documentCategory", category: "BUSINESS" },
      },
      {
        id: "record-business",
        title: "Record your stake as an asset",
        detail: "Then decide who should receive it.",
        href: "/assets/financial?new=1",
        check: { kind: "asset" },
      },
      REVIEW_WILL,
    ],
  },
  RETIREMENT: {
    label: "Retirement",
    description: "Pensions and savings often change hands at retirement.",
    steps: [
      {
        id: "record-pension",
        title: "Record pension and retirement accounts",
        detail: "Add them as financial assets.",
        href: "/assets/financial?new=1",
        check: { kind: "asset" },
      },
      REVIEW_WILL,
    ],
  },
  FINANCIAL_CHANGE: {
    label: "Major financial change",
    description: "An inheritance, sale or new investment changes what your plan covers.",
    steps: [
      {
        id: "update-assets",
        title: "Update your assets",
        detail: "Record what was added and remove what is gone.",
        href: "/assets",
        check: { kind: "asset" },
      },
      REVIEW_WILL,
    ],
  },
};

/** One event as stored in preferences (validated on write by lib/validators/life-event.validators). */
export interface StoredLifeEvent {
  id: string;
  type: LifeEventType;
  /** YYYY-MM-DD, when the owner gave one. */
  occurredOn: string | null;
  /** ISO timestamp of when it was recorded. */
  recordedAt: string;
  /** Step ids the owner marked done by hand. */
  done: string[];
}

const isStoredLifeEvent = (value: unknown): value is StoredLifeEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    (LIFE_EVENT_TYPES as readonly string[]).includes(event.type as string) &&
    (event.occurredOn === null || typeof event.occurredOn === "string") &&
    typeof event.recordedAt === "string" &&
    Array.isArray(event.done) &&
    event.done.every((step) => typeof step === "string")
  );
};

/**
 * Stored events, or none if the stored value is missing or malformed. A plain
 * guard (no schema library) so the browser bundle stays small; the server
 * validates every write with the zod schema.
 */
export function readLifeEvents(preferences: unknown): StoredLifeEvent[] {
  if (!preferences || typeof preferences !== "object") return [];
  const events = (preferences as Record<string, unknown>).lifeEvents;
  return Array.isArray(events) && events.every(isStoredLifeEvent) ? events : [];
}

/** What the state can tell us about a step; steps without a check rely on the owner. */
export interface LifeEventEvidence {
  /** Beneficiaries created after the event was recorded. */
  beneficiariesSince: (iso: string) => number;
  /** Assets recorded after the event was recorded. */
  assetsSince: (iso: string) => number;
  /** Documents with this category. */
  documentsInCategory: (category: string) => number;
  /** The plan was saved or finalized after the event was recorded. */
  planTouchedSince: (iso: string) => boolean;
}

export interface LifeEventStepState extends LifeEventStep {
  complete: boolean;
  /** How completion was established, so the UI can say so. */
  completedBy: "state" | "owner" | null;
}

export function lifeEventSteps(
  event: StoredLifeEvent,
  evidence: LifeEventEvidence,
): LifeEventStepState[] {
  return LIFE_EVENT_CATALOGUE[event.type].steps.map((step) => {
    let fromState = false;
    switch (step.check?.kind) {
      case "beneficiary":
        fromState = evidence.beneficiariesSince(event.recordedAt) > 0;
        break;
      case "asset":
        fromState = evidence.assetsSince(event.recordedAt) > 0;
        break;
      case "documentCategory":
        fromState = evidence.documentsInCategory(step.check.category ?? "") > 0;
        break;
      case "willReviewed":
        fromState = evidence.planTouchedSince(event.recordedAt);
        break;
    }
    const byOwner = event.done.includes(step.id);
    return {
      ...step,
      complete: fromState || byOwner,
      completedBy: fromState ? "state" : byOwner ? "owner" : null,
    };
  });
}
