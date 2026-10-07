import type { IntelligenceCoverage } from "@/lib/client/intelligence";
import type { LegacySnapshot } from "@/lib/client/legacy-snapshot";

/**
 * Legacy Readiness: how prepared the legacy is, in six explainable categories.
 *
 * Deterministic and transparent — every point comes from a named criterion
 * that reads real state, and the UI shows each criterion with what it is worth.
 * It measures preparation inside LegacyVault, never legal completeness.
 *
 * With Legacy Intelligence coverage, three criteria join existing categories —
 * each only where it applies, so an account without assets or a Will is not
 * scored on them. Category weights are unchanged.
 */
export type ReadinessCategoryId =
  "documents" | "will" | "beneficiaries" | "emergency" | "digital" | "security";

export interface ReadinessCriterion {
  id: string;
  label: string;
  /** Points available. */
  points: number;
  /** Points earned (may be partial). */
  earned: number;
  met: boolean;
  /** Where to fix it. */
  href: string;
}

export interface ReadinessCategory {
  id: ReadinessCategoryId;
  label: string;
  /** Share of the overall score, out of 100. */
  weight: number;
  /** 0–100 within the category. */
  score: number;
  criteria: ReadinessCriterion[];
  href: string;
}

export interface ReadinessBreakdown {
  score: number;
  categories: ReadinessCategory[];
  /** Unmet criteria, largest weighted impact first. */
  missing: (ReadinessCriterion & { category: string; impact: number })[];
}

function criterion(
  id: string,
  label: string,
  points: number,
  fraction: number,
  href: string,
): ReadinessCriterion {
  const clamped = Math.max(0, Math.min(1, fraction));
  return { id, label, points, earned: Math.round(points * clamped), met: clamped >= 1, href };
}

function category(
  id: ReadinessCategoryId,
  label: string,
  weight: number,
  href: string,
  criteria: ReadinessCriterion[],
): ReadinessCategory {
  const total = criteria.reduce((sum, c) => sum + c.points, 0);
  const earned = criteria.reduce((sum, c) => sum + c.earned, 0);
  return {
    id,
    label,
    weight,
    href,
    criteria,
    score: total ? Math.round((earned / total) * 100) : 0,
  };
}

export function readiness(s: LegacySnapshot, coverage?: IntelligenceCoverage): ReadinessBreakdown {
  const docs = s.documents;
  const ben = s.beneficiaries;
  const armed = !["INACTIVE", "PAUSED"].includes(s.dms.status);
  const when = (applies: boolean | undefined, make: () => ReadinessCriterion) =>
    applies ? [make()] : [];

  const categories: ReadinessCategory[] = [
    category("documents", "Documents", 20, "/documents", [
      criterion(
        "docs-stored",
        "Important documents stored in the vault",
        40,
        docs.total > 0 ? 1 : 0,
        "/documents?upload=1",
      ),
      criterion(
        "docs-categorized",
        "Documents categorized",
        30,
        docs.total ? docs.categorized / docs.total : 0,
        "/documents",
      ),
      criterion(
        "docs-will",
        "Will & estate document stored",
        15,
        (docs.byCategory.WILL_ESTATE ?? 0) > 0 ? 1 : 0,
        "/documents?upload=1",
      ),
      criterion(
        "docs-current",
        "No expired documents",
        15,
        docs.total > 0 && docs.expired.length === 0 ? 1 : 0,
        "/documents",
      ),
      ...when(coverage && coverage.documentsComplete && coverage.documentableAssets > 0, () =>
        criterion(
          "docs-assets",
          "Assets you hold have a supporting document",
          20,
          coverage!.supportedAssets / coverage!.documentableAssets,
          "/assets?rule=ASSET-DOC-001",
        ),
      ),
    ]),
    category("will", "Will", 25, "/legacy-plan", [
      criterion(
        "will-started",
        "Will started",
        20,
        s.plan.exists || s.plan.finalized ? 1 : 0,
        "/legacy-plan/wizard",
      ),
      criterion(
        "will-sections",
        "All will sections complete",
        50,
        s.plan.finalized && s.plan.status !== "DRAFT" ? 1 : s.plan.percent / 100,
        "/legacy-plan/wizard",
      ),
      criterion("will-finalized", "Will finalized", 30, s.plan.finalized ? 1 : 0, "/legacy-plan"),
      ...when(coverage && (s.plan.exists || s.plan.finalized), () =>
        criterion(
          "will-consistent",
          "No unresolved conflicts between your Will and vault",
          20,
          coverage!.willConflicts === 0 ? 1 : 0,
          "/intelligence?type=CONFLICT",
        ),
      ),
    ]),
    category("beneficiaries", "Beneficiaries", 20, "/beneficiaries", [
      criterion(
        "ben-added",
        "At least one beneficiary",
        40,
        ben.total > 0 ? 1 : 0,
        "/beneficiaries?new=1",
      ),
      criterion(
        "ben-accepted",
        "Invitations accepted",
        30,
        ben.active + ben.pending ? ben.active / (ben.active + ben.pending) : 0,
        "/beneficiaries",
      ),
      criterion(
        "ben-assigned",
        "Assets or documents assigned",
        30,
        ben.withAssignments > 0 || docs.shared > 0 ? 1 : 0,
        "/assets",
      ),
      ...when(coverage && coverage.heldAssets > 0, () =>
        criterion(
          "ben-asset-coverage",
          "Every asset you hold has a beneficiary",
          30,
          coverage!.assignedAssets / coverage!.heldAssets,
          "/assets?rule=ASSET-BEN-001",
        ),
      ),
    ]),
    category("emergency", "Emergency access", 15, "/emergency-access", [
      criterion(
        "ea-contact",
        "Emergency contact designated",
        35,
        s.emergency.contacts > 0 ? 1 : 0,
        "/emergency-access",
      ),
      criterion("dms-armed", "Dead Man’s Switch monitoring", 35, armed ? 1 : 0, "/dead-man-switch"),
      criterion(
        "dms-ready",
        "Switch has trusted contacts and a release scope",
        30,
        (s.dms.trustedContacts > 0 ? 0.5 : 0) + (s.dms.releaseScopeSize > 0 ? 0.5 : 0),
        "/dead-man-switch",
      ),
    ]),
    category("digital", "Digital assets", 10, "/assets/digital", [
      criterion(
        "digital-recorded",
        "Online accounts recorded",
        50,
        s.assets.digital > 0 ? 1 : 0,
        "/assets/digital?new=1",
      ),
      criterion(
        "digital-assigned",
        "Every online account has a beneficiary",
        50,
        s.assets.digital ? s.assets.digitalAssigned / s.assets.digital : 0,
        "/assets/digital",
      ),
    ]),
    category("security", "Security", 10, "/security-center", [
      criterion(
        "sec-mfa",
        "Two-factor authentication on",
        50,
        s.security.mfaEnabled ? 1 : 0,
        "/settings?tab=security",
      ),
      criterion("sec-email", "Email verified", 25, s.security.emailVerified ? 1 : 0, "/settings"),
      criterion(
        "sec-recovery",
        "Recovery email on file",
        25,
        s.security.recoveryEmail ? 1 : 0,
        "/settings",
      ),
    ]),
  ];

  const score = Math.round(categories.reduce((sum, c) => sum + (c.score * c.weight) / 100, 0));
  const missing = categories
    .flatMap((c) =>
      c.criteria
        .filter((item) => !item.met)
        .map((item) => ({
          ...item,
          category: c.label,
          impact: ((item.points - item.earned) * c.weight) / 100,
        })),
    )
    .sort((a, b) => b.impact - a.impact);

  return { score: Math.min(100, score), categories, missing };
}
