import { daysUntil, EXPIRY_WINDOW_DAYS } from "@/lib/types/document-profile";
import {
  readLifeEvents,
  type LifeEventEvidence,
  type StoredLifeEvent,
} from "@/lib/legacy-plan/life-events";
import { computeCompleteness } from "@/lib/legacy-plan/completeness";
import type { AssetWithAssignments } from "@/lib/types/asset";
import type { BeneficiaryWithRoles } from "@/lib/types/beneficiary";
import type { DeadManSwitch, DmsStatus } from "@/lib/types/dms";
import type { DocumentSummary } from "@/lib/types/document";
import type { EmergencyAccessOverview } from "@/lib/types/emergency-access";
import type { LegacyPlanOverview } from "@/lib/types/legacy-plan";

/**
 * One read-only picture of the owner's legacy, built from the data the app
 * already loads (profile, plan, beneficiaries, assets, documents, switch,
 * emergency access). The Action Centre, Legacy Readiness, the dashboard, the
 * command palette and the Copilot all read this, so they always agree.
 *
 * Pure: no fetching, no clock reads — `now` is passed in — so it is testable
 * and deterministic.
 */
export interface DocumentDate {
  id: string;
  name: string;
  date: string;
  /** Whole days from today; negative once passed. */
  days: number;
}

export interface LegacySnapshot {
  now: number;
  security: { mfaEnabled: boolean; emailVerified: boolean; recoveryEmail: boolean };
  plan: {
    exists: boolean;
    status: "NONE" | "DRAFT" | "FINALIZED";
    /** A finalized version exists (even if a newer draft is being edited). */
    finalized: boolean;
    percent: number;
    incompleteSections: string[];
    updatedAt: string | null;
  };
  beneficiaries: {
    total: number;
    active: number;
    pending: number;
    withAssignments: number;
    createdAt: string[];
  };
  assets: {
    total: number;
    assigned: number;
    digital: number;
    digitalAssigned: number;
    createdAt: string[];
  };
  documents: {
    total: number;
    shared: number;
    categorized: number;
    byCategory: Record<string, number>;
    expired: DocumentDate[];
    expiringSoon: DocumentDate[];
    reviewDue: DocumentDate[];
  };
  dms: {
    status: DmsStatus;
    nextCheckInAt: string | null;
    trustedContacts: number;
    /** Items a release would include today (deleted ones are not counted). */
    releaseScopeSize: number;
    /** Configured items that no longer exist and would be skipped. */
    unavailableScopeItems: number;
    /** The check-in interval leaves a warning window before the grace period. */
    warningWindowValid: boolean;
    /** Release links still open (not revoked, not expired). */
    liveReleaseLinks: number;
    /** At the release point but held: no warning to the owner confirmed delivered. */
    releaseHeld: boolean;
  };
  emergency: { contacts: number; openRequests: { id: string; expiresAt: string }[] };
  lifeEvents: StoredLifeEvent[];
}

export interface LegacySnapshotInput {
  now: number;
  profile: {
    mfaEnabled: boolean;
    emailVerified: boolean;
    alternateEmail: string | null;
    preferences: Record<string, unknown>;
  };
  planOverview: LegacyPlanOverview | null;
  beneficiaries: BeneficiaryWithRoles[];
  assets: AssetWithAssignments[];
  documents: DocumentSummary[];
  /** Total from the API (the list itself may be a page). */
  documentTotal: number;
  /** API totals for the asset and beneficiary lists, to tell a page from the whole set. */
  assetTotal?: number;
  beneficiaryTotal?: number;
  dms: DeadManSwitch | null;
  emergency: EmergencyAccessOverview | null;
}

/**
 * What the snapshot proves about life-event steps. Timestamps are compared as
 * instants: the database writes "+00:00" offsets, the browser writes "Z".
 */
export function lifeEventEvidence(s: LegacySnapshot): LifeEventEvidence {
  const since = (values: string[], iso: string) =>
    values.filter((at) => Date.parse(at) >= Date.parse(iso)).length;
  return {
    beneficiariesSince: (iso) => since(s.beneficiaries.createdAt, iso),
    assetsSince: (iso) => since(s.assets.createdAt, iso),
    documentsInCategory: (category) => s.documents.byCategory[category] ?? 0,
    planTouchedSince: (iso) =>
      Boolean(s.plan.updatedAt && Date.parse(s.plan.updatedAt) >= Date.parse(iso)),
  };
}

export { EXPIRY_WINDOW_DAYS };
/** Review reminders surface this many days ahead. */
export const REVIEW_WINDOW_DAYS = 14;

export function buildLegacySnapshot(input: LegacySnapshotInput): LegacySnapshot {
  const { now } = input;
  const current = input.planOverview?.current ?? null;
  const completeness = computeCompleteness({
    stepsData: current?.stepsData ?? {},
    beneficiaries: input.beneficiaries,
    assets: input.assets.map(({ asset }) => ({ id: asset.id, kind: asset.kind })),
    documents: input.documents.map((document) => ({ id: document.id })),
  });

  const byCategory: Record<string, number> = {};
  const expired: DocumentDate[] = [];
  const expiringSoon: DocumentDate[] = [];
  const reviewDue: DocumentDate[] = [];
  let categorized = 0;
  for (const document of input.documents) {
    const profile = document.profile;
    if (profile?.category) {
      categorized += 1;
      byCategory[profile.category] = (byCategory[profile.category] ?? 0) + 1;
    }
    if (profile?.expiresOn) {
      const days = daysUntil(profile.expiresOn, now);
      const entry = { id: document.id, name: document.name, date: profile.expiresOn, days };
      if (days < 0) expired.push(entry);
      else if (days <= EXPIRY_WINDOW_DAYS) expiringSoon.push(entry);
    }
    if (profile?.reviewOn) {
      const days = daysUntil(profile.reviewOn, now);
      if (days <= REVIEW_WINDOW_DAYS) {
        reviewDue.push({ id: document.id, name: document.name, date: profile.reviewOn, days });
      }
    }
  }
  const byDays = (a: DocumentDate, b: DocumentDate) => a.days - b.days;

  const digital = input.assets.filter(({ asset }) => asset.kind === "DIGITAL_ASSET");
  const scope = input.dms?.releaseScope;

  return {
    now,
    security: {
      mfaEnabled: input.profile.mfaEnabled,
      emailVerified: input.profile.emailVerified,
      recoveryEmail: Boolean(input.profile.alternateEmail),
    },
    plan: {
      exists: Boolean(current),
      status: current ? (current.status === "FINALIZED" ? "FINALIZED" : "DRAFT") : "NONE",
      finalized: current?.status === "FINALIZED" || (input.planOverview?.versions?.length ?? 0) > 0,
      percent: completeness.percent,
      incompleteSections: completeness.incompleteSections.map(
        (key) => completeness.sections[key].title,
      ),
      updatedAt: current?.updatedAt ?? null,
    },
    beneficiaries: {
      total: input.beneficiaries.length,
      active: input.beneficiaries.filter((b) => b.status === "ACTIVE").length,
      pending: input.beneficiaries.filter((b) => b.status === "PENDING").length,
      withAssignments: input.beneficiaries.filter((b) => b.roles.assignmentCount > 0).length,
      createdAt: input.beneficiaries.map((b) => b.createdAt),
    },
    assets: {
      total: input.assets.length,
      assigned: input.assets.filter((item) => item.assignments.length > 0).length,
      digital: digital.length,
      digitalAssigned: digital.filter((item) => item.assignments.length > 0).length,
      createdAt: input.assets.map(({ asset }) => asset.createdAt),
    },
    documents: {
      total: Math.max(input.documentTotal, input.documents.length),
      shared: input.documents.filter((document) => document.shareCount > 0).length,
      categorized,
      byCategory,
      expired: expired.sort(byDays),
      expiringSoon: expiringSoon.sort(byDays),
      reviewDue: reviewDue.sort(byDays),
    },
    dms: {
      status: input.dms?.status ?? "INACTIVE",
      nextCheckInAt: input.dms?.nextCheckInAt ?? null,
      trustedContacts: input.dms?.contacts.length ?? 0,
      releaseScopeSize: scope
        ? Math.max(
            0,
            scope.documents.length +
              scope.assets.length +
              scope.videos.length +
              scope.planSections.length -
              (input.dms?.unavailableScopeItems ?? 0),
          )
        : 0,
      unavailableScopeItems: input.dms?.unavailableScopeItems ?? 0,
      warningWindowValid: input.dms
        ? input.dms.checkInFrequencyDays < input.dms.inactivityPeriodDays
        : true,
      releaseHeld: Boolean(input.dms?.releaseHold),
      liveReleaseLinks: (input.dms?.releaseAccess ?? []).filter(
        (link) => !link.revokedAt && Date.parse(link.expiresAt) > now,
      ).length,
    },
    emergency: {
      contacts: input.emergency?.contacts.length ?? 0,
      openRequests: (input.emergency?.requests ?? [])
        .filter((request) => request.status === "VERIFIED")
        .map((request) => ({ id: request.id, expiresAt: request.requestExpiresAt })),
    },
    lifeEvents: readLifeEvents(input.profile.preferences),
  };
}
