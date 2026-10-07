import {
  sortActions,
  type ActionPriority,
  type ActionSource,
  type LegacyAction,
} from "@/lib/client/action-centre";
import {
  assetKey,
  beneficiaryKey,
  buildLegacyGraph,
  completeness,
  documentKey,
  readWillReferences,
  SWITCH,
  USER,
  WILL,
  type GraphNode,
  type LegacyGraph,
  type NodeKind,
} from "@/lib/client/legacy-graph";
import {
  EXPIRY_WINDOW_DAYS,
  REVIEW_WINDOW_DAYS,
  type LegacySnapshot,
  type LegacySnapshotInput,
} from "@/lib/client/legacy-snapshot";
import { ASSET_KIND_META } from "@/lib/assets/meta";
import type { AssetKind, AssetWithAssignments } from "@/lib/types/asset";
import { ASSET_STATUS_LABELS, isHeld } from "@/lib/types/asset-profile";
import { daysUntil, DOCUMENT_CATEGORY_LABELS } from "@/lib/types/document-profile";
import type { DocumentCategory } from "@/lib/types/document-profile";

/**
 * The Legacy Intelligence Engine: deterministic rules over the owner's real
 * records (via the relationship graph) that produce explainable findings.
 *
 *   real data → graph → rule → finding → recommendation → Action Centre
 *
 * Every finding names the rule that raised it and the records it is about.
 * Nothing here is AI, nothing is estimated, and nothing is a legal conclusion:
 * wording is "potential inconsistency" and "review recommended", never
 * "invalid". Rules only run on data that has fully loaded, and a rule that
 * would need records beyond the loaded page stays silent rather than guess.
 */
export type FindingType = "MISSING" | "EXPIRING" | "STALE" | "CONFLICT" | "ORPHAN";

export const FINDING_TYPES: FindingType[] = ["CONFLICT", "MISSING", "EXPIRING", "STALE", "ORPHAN"];

export const FINDING_TYPE_LABELS: Record<FindingType, string> = {
  CONFLICT: "Potential conflicts",
  MISSING: "Missing information",
  EXPIRING: "Expiring & due",
  STALE: "Not reviewed recently",
  ORPHAN: "Unlinked records",
};

/** Records not confirmed or changed for this long count as stale. */
export const STALE_AFTER_DAYS = 365;

export interface SourceRecord {
  kind: NodeKind;
  id: string;
  label: string;
  href: string;
}

export interface Finding {
  /** Stable for the same rule and records: `${ruleId}:${record ids}`. */
  id: string;
  type: FindingType;
  severity: ActionPriority;
  title: string;
  explanation: string;
  sourceRecords: SourceRecord[];
  recommendedAction: string;
  destination: string;
  ruleId: RuleId;
  /** When this evaluation detected it (findings are derived, not stored). */
  createdAt: string;
  status: "open" | "dismissed";
  /** Heuristic findings the owner may set aside (e.g. two genuinely distinct assets). */
  dismissible: boolean;
  /** An existing Action Centre action that already covers this finding. */
  coveredBy?: string;
  /** For dated findings: when it is due. */
  deadline?: string;
}

export type RuleId =
  | "ASSET-BEN-001"
  | "ASSET-DOC-001"
  | "ASSET-INSTR-001"
  | "DOC-CAT-001"
  | "EA-CONTACT-001"
  | "WILL-001"
  | "BEN-RES-001"
  | "DOC-EXP-001"
  | "ASSET-EXP-001"
  | "ASSET-REVIEW-001"
  | "DOC-REVIEW-001"
  | "ASSET-STALE-001"
  | "WILL-STALE-001"
  | "DOC-ASSET-001"
  | "RULE-001"
  | "RULE-002"
  | "RULE-003"
  | "RULE-004"
  | "RULE-005"
  | "RULE-006"
  | "RULE-007"
  | "RULE-008"
  | "RULE-009"
  | "RULE-010";

interface RuleDefinition {
  type: FindingType;
  /** What the rule checks, in one line (shown on findings and in the docs). */
  name: string;
  dismissible: boolean;
  source: ActionSource;
  cta: string;
  /** Where to see every finding of this rule. */
  listHref: string;
  /** Title for several findings at once. */
  summary: (count: number) => string;
  /** Why it matters, for the aggregated action. */
  why: string;
  /** Dated findings become one action each, so each keeps its own deadline. */
  perFinding?: boolean;
  /** An existing action id this rule's recommendation takes over. */
  replaces?: string;
  /** Title for the replaced action once nothing is left. */
  doneTitle?: string;
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const RULES: Record<RuleId, RuleDefinition> = {
  "ASSET-BEN-001": {
    type: "MISSING",
    name: "Asset has no beneficiary",
    dismissible: false,
    source: "Assets",
    cta: "Review assignments",
    listHref: "/assets?rule=ASSET-BEN-001",
    summary: (c) => `${n(c, "asset")} ${c === 1 ? "has" : "have"} no beneficiary`,
    why: "Assign each asset so it is clear who should receive it.",
    replaces: "assets-unassigned",
    doneTitle: "Every asset has a beneficiary",
  },
  "ASSET-DOC-001": {
    type: "MISSING",
    name: "Asset has no supporting document",
    dismissible: true,
    source: "Assets",
    cta: "Link documents",
    listHref: "/assets?rule=ASSET-DOC-001",
    summary: (c) => `${n(c, "asset")} ${c === 1 ? "has" : "have"} no supporting document`,
    why: "A statement, deed or policy linked to the asset helps your family find and claim it.",
  },
  "ASSET-INSTR-001": {
    type: "MISSING",
    name: "Asset has no instructions",
    dismissible: true,
    source: "Assets",
    cta: "Add instructions",
    listHref: "/assets?rule=ASSET-INSTR-001",
    summary: (c) => `${n(c, "asset")} ${c === 1 ? "has" : "have"} no instructions`,
    why: "Say what should happen to each asset and where its access details are kept — never the secret itself.",
  },
  "DOC-CAT-001": {
    type: "MISSING",
    name: "Document has no category",
    dismissible: false,
    source: "Vault",
    cta: "Categorize",
    listHref: "/documents",
    summary: (c) => `${n(c, "document")} ${c === 1 ? "has" : "have"} no category`,
    why: "Categories let LegacyVault tell you what is missing and what is about to lapse.",
  },
  "EA-CONTACT-001": {
    type: "MISSING",
    name: "No emergency contact",
    dismissible: false,
    source: "Emergency",
    cta: "Designate",
    listHref: "/emergency-access",
    summary: () => "No emergency contact designated",
    why: "No one can request access to your legacy if something happens suddenly.",
  },
  "WILL-001": {
    type: "MISSING",
    name: "Will not started or incomplete",
    dismissible: false,
    source: "Will",
    cta: "Continue will",
    listHref: "/legacy-plan/wizard",
    summary: () => "Your Will is incomplete",
    why: "Your Will ties assets to the people who should receive them.",
  },
  "BEN-RES-001": {
    type: "ORPHAN",
    name: "Beneficiary has nothing assigned",
    dismissible: true,
    source: "Beneficiaries",
    cta: "Review",
    listHref: "/intelligence?rule=BEN-RES-001",
    summary: (c) =>
      `${n(c, "beneficiary", "beneficiaries")} ${c === 1 ? "has" : "have"} nothing assigned`,
    why: "Assign something to each person, or review whether they still need access.",
  },
  "DOC-EXP-001": {
    type: "EXPIRING",
    name: "Document expired or expiring",
    dismissible: false,
    source: "Vault",
    cta: "Open",
    listHref: "/intelligence?type=EXPIRING",
    summary: (c) => `${n(c, "document")} expired or expiring`,
    why: "Upload the renewed version so your vault stays current.",
    perFinding: true,
  },
  "ASSET-EXP-001": {
    type: "EXPIRING",
    name: "Asset expiry date approaching or passed",
    dismissible: false,
    source: "Assets",
    cta: "Open asset",
    listHref: "/intelligence?type=EXPIRING",
    summary: (c) => `${n(c, "asset")} expiring`,
    why: "Renew it or update its record.",
    perFinding: true,
  },
  "ASSET-REVIEW-001": {
    type: "EXPIRING",
    name: "Asset review date approaching or passed",
    dismissible: false,
    source: "Assets",
    cta: "Review",
    listHref: "/intelligence?type=EXPIRING",
    summary: (c) => `${n(c, "asset")} due for review`,
    why: "You set a reminder to review it.",
    perFinding: true,
  },
  "DOC-REVIEW-001": {
    type: "EXPIRING",
    name: "Document review date approaching or passed",
    dismissible: false,
    source: "Vault",
    cta: "Open",
    listHref: "/intelligence?type=EXPIRING",
    summary: (c) => `${n(c, "document")} due for review`,
    why: "You set a reminder to review it.",
    perFinding: true,
  },
  "ASSET-STALE-001": {
    type: "STALE",
    name: `Asset not reviewed in ${STALE_AFTER_DAYS} days`,
    dismissible: false,
    source: "Assets",
    cta: "Review assets",
    listHref: "/assets?rule=ASSET-STALE-001",
    summary: (c) => `${n(c, "asset")} not reviewed in over a year`,
    why: "Confirm values, beneficiaries and instructions are still current.",
  },
  "WILL-STALE-001": {
    type: "STALE",
    name: `Will not reviewed in ${STALE_AFTER_DAYS} days`,
    dismissible: true,
    source: "Will",
    cta: "Review will",
    listHref: "/legacy-plan",
    summary: () => "Your Will has not been reviewed in over a year",
    why: "Review it after major life changes and at least once a year.",
  },
  "DOC-ASSET-001": {
    type: "ORPHAN",
    name: "Asset-type document not linked to an asset",
    dismissible: true,
    source: "Vault",
    cta: "Link documents",
    listHref: "/intelligence?rule=DOC-ASSET-001",
    summary: (c) => `${n(c, "document")} not linked to an asset`,
    why: "Link property, insurance, financial and business documents to the asset they support.",
  },
  "RULE-001": {
    type: "CONFLICT",
    name: "Potentially conflicting beneficiary assignments for the same asset",
    dismissible: true,
    source: "Assets",
    cta: "Review allocations",
    listHref: "/intelligence?rule=RULE-001",
    summary: (c) => `${n(c, "asset")} with unclear allocations`,
    why: "Make each asset's split explicit so it adds up.",
  },
  "RULE-002": {
    type: "CONFLICT",
    name: "Asset has no corresponding Will reference where one is expected",
    dismissible: true,
    source: "Will",
    cta: "Review will",
    listHref: "/intelligence?rule=RULE-002",
    summary: (c) => `${n(c, "asset")} not referenced in your Will`,
    why: "Your Will and your vault may disagree about what you own.",
  },
  "RULE-003": {
    type: "CONFLICT",
    name: "A record references an asset or document that no longer exists",
    dismissible: false,
    source: "Vault",
    cta: "Update references",
    listHref: "/intelligence?rule=RULE-003",
    summary: (c) => `${n(c, "reference")} to deleted records`,
    why: "Something still points at a record you removed.",
  },
  "RULE-004": {
    type: "CONFLICT",
    name: "Potential duplicate assets",
    dismissible: true,
    source: "Assets",
    cta: "Review duplicates",
    listHref: "/assets?rule=RULE-004",
    summary: (c) => `${n(c, "potential duplicate asset", "potential duplicate assets")}`,
    why: "Duplicate records split allocations and confuse your family.",
  },
  "RULE-005": {
    type: "CONFLICT",
    name: "Expired document is still a supporting document",
    dismissible: false,
    source: "Assets",
    cta: "Replace document",
    listHref: "/intelligence?rule=RULE-005",
    summary: (c) => `${n(c, "expired document")} still supporting assets`,
    why: "An expired document may no longer prove the asset.",
  },
  "RULE-006": {
    type: "CONFLICT",
    name: "An instruction references a beneficiary who is no longer active",
    dismissible: false,
    source: "Beneficiaries",
    cta: "Review",
    listHref: "/intelligence?rule=RULE-006",
    summary: (c) => `${n(c, "reference")} to inactive or removed beneficiaries`,
    why: "Someone named in your instructions can no longer receive anything.",
  },
  "RULE-007": {
    type: "CONFLICT",
    name: "Will beneficiaries differ from vault assignments",
    dismissible: true,
    source: "Will",
    cta: "Review will",
    listHref: "/intelligence?rule=RULE-007",
    summary: (c) =>
      `${n(c, "beneficiary", "beneficiaries")} assigned assets but not named in your Will`,
    why: "Your Will and your vault may disagree about who receives what.",
  },
  "RULE-008": {
    type: "CONFLICT",
    name: "Potential duplicate document",
    dismissible: true,
    source: "Vault",
    cta: "Review duplicates",
    listHref: "/intelligence?rule=RULE-008",
    summary: (c) => `${n(c, "potential duplicate document", "potential duplicate documents")}`,
    why: "Keep one current copy so nobody relies on an old one.",
  },
  "RULE-009": {
    type: "CONFLICT",
    name: "Asset has contradictory instructions",
    dismissible: false,
    source: "Assets",
    cta: "Review",
    listHref: "/intelligence?rule=RULE-009",
    summary: (c) => `${n(c, "asset")} with contradictory records`,
    why: "An asset you no longer hold is still being passed on.",
  },
  "RULE-010": {
    type: "CONFLICT",
    name: "Beneficiary in one subsystem but missing from another",
    dismissible: true,
    source: "Beneficiaries",
    cta: "Review",
    listHref: "/intelligence?rule=RULE-010",
    summary: (c) =>
      `${n(c, "beneficiary", "beneficiaries")} named in your Will with nothing assigned`,
    why: "Your Will names them, but nothing in the vault is assigned to them.",
  },
};

export const RULE_IDS = Object.keys(RULES) as RuleId[];

const SEVERITY_RANK: Record<ActionPriority, number> = {
  CRITICAL: 0,
  IMPORTANT: 1,
  UPCOMING: 2,
  RECOMMENDED: 3,
};

/** Document categories that normally belong to an asset, and what to call that asset. */
const ASSET_DOCUMENT_CATEGORIES: Partial<Record<DocumentCategory, string>> = {
  PROPERTY: "property",
  INSURANCE: "insurance policy",
  FINANCIAL: "financial asset",
  BUSINESS: "business asset",
};

const normalize = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Reads the owner's dismissed finding ids from preferences (no zod in the browser). */
export function readDismissedFindings(preferences: Record<string, unknown> | undefined): string[] {
  const value = preferences?.dismissedFindings;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** Counts readiness uses; see docs/product/LEGACY_INTELLIGENCE.md. */
export interface IntelligenceCoverage {
  /** Assets the owner still holds. */
  heldAssets: number;
  /** Held assets with at least one beneficiary. */
  assignedAssets: number;
  /** Held financial and physical assets — the ones a document normally supports. */
  documentableAssets: number;
  /** Of those, how many have a supporting document (or the gap was dismissed). */
  supportedAssets: number;
  /** Supporting-document coverage can only be judged with every document loaded. */
  documentsComplete: boolean;
  /** Open conflicts that have the Will as a source record. */
  willConflicts: number;
}

export interface LegacyIntelligence {
  graph: LegacyGraph;
  coverage: IntelligenceCoverage;
  findings: Finding[];
  /** Open findings, most severe first. */
  open: Finding[];
  dismissed: Finding[];
  recommendations: LegacyAction[];
}

/**
 * Runs every rule. `snapshot` supplies the Will completeness and dates the
 * Action Centre already computes, so the two never disagree.
 */
export function analyzeLegacy(
  input: LegacySnapshotInput,
  snapshot: LegacySnapshot,
): LegacyIntelligence {
  const graph = buildLegacyGraph(input);
  const complete = completeness(input);
  const now = input.now;
  const createdAt = new Date(now).toISOString();
  const dismissedIds = new Set(readDismissedFindings(input.profile.preferences));
  const findings: Finding[] = [];

  const source = (key: string): SourceRecord | null => {
    const node = graph.nodes.get(key);
    return node ? { kind: node.kind, id: node.id, label: node.label, href: node.href } : null;
  };
  const sources = (...keys: string[]) =>
    keys.map(source).filter((record): record is SourceRecord => record !== null);
  const add = (
    ruleId: RuleId,
    records: SourceRecord[],
    fields: Pick<
      Finding,
      "severity" | "title" | "explanation" | "recommendedAction" | "destination"
    > &
      Partial<Pick<Finding, "coveredBy" | "deadline">>,
    key = records
      .map((record) => record.id)
      .sort()
      .join(","),
  ) => {
    const rule = RULES[ruleId];
    const id = `${ruleId}:${key || "account"}`;
    if (findings.some((finding) => finding.id === id)) return;
    findings.push({
      id,
      ruleId,
      type: rule.type,
      sourceRecords: records,
      createdAt,
      dismissible: rule.dismissible,
      status: rule.dismissible && dismissedIds.has(id) ? "dismissed" : "open",
      ...fields,
    });
  };

  const assets = input.assets;
  const held = assets.filter(({ asset }) => isHeld(asset.profile));
  const beneficiaryById = new Map(input.beneficiaries.map((person) => [person.id, person]));
  const documentById = new Map(input.documents.map((document) => [document.id, document]));
  const plan = input.planOverview?.current ?? null;
  const will = plan ? readWillReferences(plan.stepsData as Record<string, unknown>) : null;
  const assetLabel = (item: AssetWithAssignments) => item.asset.name;
  const assetNoun = (kind: AssetKind) => ASSET_KIND_META[kind].label.toLowerCase();

  /* ── MISSING ───────────────────────────────────────────────────────────── */
  for (const item of held) {
    const key = assetKey(item.asset.id);
    const href = graph.nodes.get(key)?.href ?? "/assets";
    // The asset's own assignment list, not graph edges: an edge to a beneficiary
    // beyond the loaded page is dropped, which must not read as "unassigned".
    if (item.assignments.length === 0) {
      add("ASSET-BEN-001", sources(key), {
        severity: "IMPORTANT",
        title: `${assetLabel(item)} has no beneficiary`,
        explanation:
          "Nobody is assigned to receive this asset, so it is not clear who should inherit it.",
        recommendedAction: "Assign a beneficiary",
        destination: href,
      });
    }
    if (
      complete.documents &&
      item.asset.kind !== "DIGITAL_ASSET" &&
      graph.in(key, "documents").length === 0
    ) {
      add("ASSET-DOC-001", sources(key), {
        severity: "RECOMMENDED",
        title: `${assetLabel(item)} has no supporting document`,
        explanation:
          "No document in your vault is linked to this asset. A statement, deed or policy helps your family find and claim it.",
        recommendedAction: "Link a supporting document",
        destination: href,
      });
    }
    if (!item.asset.profile?.instructions) {
      add("ASSET-INSTR-001", sources(key), {
        severity: "RECOMMENDED",
        title: `${assetLabel(item)} has no instructions`,
        explanation:
          "Instructions tell your family what should happen to this asset and where its access details are kept.",
        recommendedAction: "Add instructions",
        destination: href,
      });
    }
  }

  const uncategorized = input.documents.filter((document) => !document.profile?.category);
  if (uncategorized.length) {
    add(
      "DOC-CAT-001",
      sources(...uncategorized.map((document) => documentKey(document.id))),
      {
        severity: "RECOMMENDED",
        title: RULES["DOC-CAT-001"].summary(uncategorized.length),
        explanation:
          "Uncategorized documents cannot be checked for gaps, expiry or the asset they support.",
        recommendedAction: "Categorize documents",
        destination: "/documents",
        coveredBy: "documents-categorize",
      },
      "account",
    );
  }

  if (snapshot.emergency.contacts === 0) {
    add(
      "EA-CONTACT-001",
      sources(USER),
      {
        severity: "RECOMMENDED",
        title: "No emergency contact designated",
        explanation: "No one can request access to your legacy if something happens suddenly.",
        recommendedAction: "Designate an emergency contact",
        destination: "/emergency-access",
        coveredBy: "emergency-contact",
      },
      "account",
    );
  }

  // Same condition as the Action Centre's "will" action, so the two agree.
  if (
    (!snapshot.plan.exists && !snapshot.plan.finalized) ||
    (snapshot.plan.status === "DRAFT" && snapshot.plan.percent < 100)
  ) {
    add(
      "WILL-001",
      plan ? sources(WILL) : sources(USER),
      {
        severity: "IMPORTANT",
        title: plan ? "Your Will is incomplete" : "You have not started your Will",
        explanation: plan
          ? `${snapshot.plan.percent}% of sections are complete. Still to do: ${snapshot.plan.incompleteSections.slice(0, 3).join(", ")}.`
          : "Without a Will in LegacyVault, nothing connects your assets to the people who should receive them.",
        recommendedAction: plan ? "Continue your Will" : "Start your Will",
        destination: "/legacy-plan/wizard",
        coveredBy: "will",
      },
      "account",
    );
  }

  const willNamed = new Set(will?.beneficiaryIds ?? []);
  for (const person of input.beneficiaries) {
    if (person.status === "INACTIVE") continue;
    const roles = person.roles;
    if (
      roles.assignmentCount === 0 &&
      !roles.isTrustedContact &&
      !roles.isEmergencyContact &&
      !willNamed.has(person.id)
    ) {
      add("BEN-RES-001", sources(beneficiaryKey(person.id)), {
        severity: "RECOMMENDED",
        title: `${person.name} has nothing assigned`,
        explanation:
          "No asset or document is assigned to or shared with this beneficiary, and they are not a trusted or emergency contact.",
        recommendedAction:
          "Assign an asset or share a document, or review whether they still need access",
        destination: "/assets",
        coveredBy: snapshot.beneficiaries.withAssignments === 0 ? "beneficiary-assign" : undefined,
      });
    }
  }

  /* ── EXPIRING ──────────────────────────────────────────────────────────── */
  const supports = (documentId: string) =>
    graph
      .out(documentKey(documentId), "documents")
      .map((edge) => graph.nodes.get(edge.to)?.label)
      .filter(Boolean) as string[];
  for (const doc of [...snapshot.documents.expired, ...snapshot.documents.expiringSoon]) {
    const expired = doc.days < 0;
    const linked = supports(doc.id);
    add("DOC-EXP-001", sources(documentKey(doc.id), ...linkedAssetKeys(graph, doc.id)), {
      severity: expired ? "IMPORTANT" : "UPCOMING",
      title: expired
        ? `${doc.name} has expired`
        : `${doc.name} expires ${doc.days === 0 ? "today" : `in ${n(doc.days, "day")}`}`,
      explanation:
        (expired ? `It expired on ${doc.date}.` : `It expires on ${doc.date}.`) +
        (linked.length ? ` It supports ${linked.join(", ")}.` : "") +
        " Upload an updated document after renewal.",
      recommendedAction: "Upload an updated document after renewal",
      destination: `/documents?q=${encodeURIComponent(doc.name)}`,
      deadline: doc.date,
      coveredBy: expired ? "documents-expired" : `document-expiring-${doc.id}`,
    });
  }
  for (const doc of snapshot.documents.reviewDue) {
    add("DOC-REVIEW-001", sources(documentKey(doc.id)), {
      severity: "UPCOMING",
      title: `Review ${doc.name}`,
      explanation:
        doc.days < 0
          ? `You planned to review it on ${doc.date}.`
          : "You set a reminder to review it.",
      recommendedAction: "Review the document",
      destination: `/documents?q=${encodeURIComponent(doc.name)}`,
      deadline: doc.date,
      coveredBy: `document-review-${doc.id}`,
    });
  }
  for (const item of held) {
    const key = assetKey(item.asset.id);
    const href = graph.nodes.get(key)?.href ?? "/assets";
    const { expiresOn, reviewOn } = item.asset.profile ?? {};
    if (expiresOn) {
      const days = daysUntil(expiresOn, now);
      if (days <= EXPIRY_WINDOW_DAYS) {
        add("ASSET-EXP-001", sources(key), {
          severity: days < 0 ? "IMPORTANT" : "UPCOMING",
          title:
            days < 0
              ? `${assetLabel(item)} passed its expiry date`
              : `${assetLabel(item)} expires ${days === 0 ? "today" : `in ${n(days, "day")}`}`,
          explanation:
            days < 0
              ? `Its expiry date (${expiresOn}) has passed. If it was renewed, update the date; if it lapsed, update its status.`
              : `Its expiry date is ${expiresOn}. Renew it, then update the record.`,
          recommendedAction: "Renew it or update its record",
          destination: href,
          deadline: expiresOn,
        });
      }
    }
    if (reviewOn) {
      const days = daysUntil(reviewOn, now);
      if (days <= REVIEW_WINDOW_DAYS) {
        add("ASSET-REVIEW-001", sources(key), {
          severity: "UPCOMING",
          title: `Review ${assetLabel(item)}`,
          explanation:
            days < 0
              ? `You planned to review it on ${reviewOn}.`
              : `You set a reminder to review it on ${reviewOn}.`,
          recommendedAction: "Review the asset and mark it reviewed",
          destination: href,
          deadline: reviewOn,
        });
      }
    }
  }

  /* ── STALE ─────────────────────────────────────────────────────────────── */
  const staleBefore = now - STALE_AFTER_DAYS * 86_400_000;
  for (const item of held) {
    const reviewed = item.asset.profile?.lastReviewedOn;
    const last = Math.max(
      Date.parse(item.asset.updatedAt),
      reviewed ? Date.parse(`${reviewed}T00:00:00`) : 0,
    );
    if (last < staleBefore) {
      const key = assetKey(item.asset.id);
      add("ASSET-STALE-001", sources(key), {
        severity: "RECOMMENDED",
        title: `${assetLabel(item)} has not been reviewed in over a year`,
        explanation: `It was last changed or confirmed more than ${STALE_AFTER_DAYS} days ago. Values, beneficiaries and instructions may have changed.`,
        recommendedAction: "Confirm it is still current",
        destination: graph.nodes.get(key)?.href ?? "/assets",
      });
    }
  }
  if (plan?.status === "FINALIZED") {
    const touched = Date.parse(plan.finalizedAt ?? plan.updatedAt);
    if (touched < staleBefore) {
      add("WILL-STALE-001", sources(WILL), {
        severity: "RECOMMENDED",
        title: "Your Will has not been reviewed in over a year",
        explanation: `It was finalized more than ${STALE_AFTER_DAYS} days ago. Review it after major life changes and at least once a year.`,
        recommendedAction: "Review your Will",
        destination: "/legacy-plan",
      });
    }
  }

  /* ── ORPHAN ────────────────────────────────────────────────────────────── */
  for (const document of input.documents) {
    const category = document.profile?.category;
    const noun = category ? ASSET_DOCUMENT_CATEGORIES[category] : undefined;
    if (!category || !noun) continue;
    const key = documentKey(document.id);
    // The document's own attachments, not graph edges: a link to an asset beyond
    // the loaded page still counts as linked.
    if (document.attachments?.length || graph.out(key, "referenced_by").length) continue;
    add("DOC-ASSET-001", sources(key), {
      severity: "RECOMMENDED",
      title: `${DOCUMENT_CATEGORY_LABELS[category]} document has no linked asset`,
      explanation: `“${document.name}” is categorized as a ${DOCUMENT_CATEGORY_LABELS[category].toLowerCase()} document but is not linked to an asset.`,
      recommendedAction: `Link this document to an existing ${noun} or create a ${noun} asset`,
      destination: `/intelligence?rule=DOC-ASSET-001`,
    });
  }

  /* ── CONFLICT: RULE-001 … RULE-010 ─────────────────────────────────────── */
  for (const item of held) {
    if (item.assignments.length === 0) continue;
    const key = assetKey(item.asset.id);
    const people = item.assignments.map((a) => beneficiaryKey(a.beneficiaryId));
    const withShare = item.assignments.filter((a) => a.allocationPercentage != null);
    const total = withShare.reduce((sum, a) => sum + (a.allocationPercentage ?? 0), 0);
    const href = graph.nodes.get(key)?.href ?? "/assets";
    if (
      item.assignments.length > 1 &&
      withShare.length > 0 &&
      withShare.length < item.assignments.length
    ) {
      add("RULE-001", sources(key, ...people), {
        severity: "IMPORTANT",
        title: `Unclear allocation for ${assetLabel(item)}`,
        explanation:
          "Some beneficiaries of this asset have a percentage and others do not, so the split is ambiguous. Potential inconsistency detected — review recommended.",
        recommendedAction: "Give every beneficiary of this asset a percentage",
        destination: href,
      });
    } else if (withShare.length === item.assignments.length && total > 0 && total < 100) {
      add("RULE-001", sources(key, ...people), {
        severity: "RECOMMENDED",
        title: `${assetLabel(item)} is only ${total}% allocated`,
        explanation: `${100 - total}% of this asset has no recipient recorded. If that is intentional, you can dismiss this; otherwise review the allocations.`,
        recommendedAction: "Review the allocations",
        destination: href,
      });
    }
  }

  if (plan && will) {
    const finalizedAt = plan.status === "FINALIZED" ? plan.finalizedAt : null;
    for (const item of held) {
      const section = will.assets[item.asset.kind];
      if (!section.touched || section.ids.includes(item.asset.id)) continue;
      const key = assetKey(item.asset.id);
      const after = finalizedAt && Date.parse(item.asset.createdAt) > Date.parse(finalizedAt);
      add("RULE-002", sources(key, WILL), {
        severity: section.none ? "IMPORTANT" : "RECOMMENDED",
        title: section.none
          ? `Your Will says you have no ${assetNoun(item.asset.kind)} assets, but ${assetLabel(item)} is recorded`
          : `${assetLabel(item)} is not referenced in your Will`,
        explanation:
          (section.none
            ? `The Will's ${assetNoun(item.asset.kind)} assets section is marked “none”, but your vault records this asset.`
            : `Your Will lists ${assetNoun(item.asset.kind)} assets but not this one.`) +
          (after ? " It was added after your Will was finalized." : "") +
          " Potential inconsistency detected — review recommended. If it is intentionally left out, you can dismiss this.",
        recommendedAction: "Review the assets section of your Will",
        destination: "/legacy-plan/wizard",
      });
    }
  }

  for (const ref of graph.dangling) {
    const [fromKind, fromId] = ref.from.split(":");
    const [toKind, toId] = ref.to.split(":");
    if (fromKind === "beneficiary" || toKind === "beneficiary") continue; // RULE-006
    const missingIsFrom = !graph.nodes.has(ref.from);
    const missingKind = missingIsFrom ? fromKind : toKind;
    const missingId = missingIsFrom ? fromId : toId;
    const holder = missingIsFrom ? ref.to : ref.from;
    const holderNode = graph.nodes.get(holder);
    if (!holderNode) continue;
    const what = missingKind === "asset" ? "an asset" : "a document";
    const missing: SourceRecord = {
      kind: missingKind as NodeKind,
      id: missingId,
      label: missingKind === "asset" ? "Deleted asset" : "Deleted document",
      href: "",
    };
    const where =
      holder === WILL
        ? {
            title: `Your Will references ${what} that no longer exists`,
            fix: "Update the Will",
            href: "/legacy-plan/wizard",
          }
        : holder === SWITCH
          ? {
              title: `Your Dead Man’s Switch release includes ${what} that no longer exists`,
              fix: "Update the release scope",
              href: "/dead-man-switch",
            }
          : holderNode.kind === "emergency"
            ? {
                title: `${holderNode.label} includes ${what} that no longer exists`,
                fix: "Update the access scope",
                href: "/emergency-access",
              }
            : {
                title: `${holderNode.label} is linked to ${what} that no longer exists`,
                fix: "Remove the link",
                href: holderNode.href,
              };
    add("RULE-003", [...sources(holder), missing], {
      severity: "IMPORTANT",
      title: where.title,
      explanation:
        "A record still points at something you deleted, so it no longer matches your vault. Review recommended.",
      recommendedAction: where.fix,
      destination: where.href,
    });
  }

  const duplicateGroups = new Map<string, AssetWithAssignments[]>();
  for (const item of held) {
    const name = normalize(item.asset.name);
    if (name.length >= 2) {
      const group = `${item.asset.kind}|${item.asset.category}|${name}`;
      duplicateGroups.set(group, [...(duplicateGroups.get(group) ?? []), item]);
    }
    if (item.asset.kind === "DIGITAL_ASSET" && item.asset.platform && item.asset.username) {
      const group = `account|${normalize(item.asset.platform)}|${normalize(item.asset.username)}`;
      duplicateGroups.set(group, [...(duplicateGroups.get(group) ?? []), item]);
    }
  }
  const reported = new Set<string>();
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    const key = group
      .map((item) => item.asset.id)
      .sort()
      .join(",");
    if (reported.has(key)) continue;
    reported.add(key);
    add("RULE-004", sources(...group.map((item) => assetKey(item.asset.id))), {
      severity: "RECOMMENDED",
      title: `Potential duplicate: ${group[0].asset.name}`,
      explanation: `${group.length} ${assetNoun(group[0].asset.kind)} assets have the same name and category${group[0].asset.kind === "DIGITAL_ASSET" ? " or account" : ""}. If they are the same asset, keep one so allocations stay clear; if they are different, you can dismiss this.`,
      recommendedAction: "Check whether they are the same asset",
      destination: "/assets?rule=RULE-004",
    });
  }

  for (const item of held) {
    const key = assetKey(item.asset.id);
    for (const edge of graph.in(key, "documents")) {
      const document = documentById.get(graph.nodes.get(edge.from)?.id ?? "");
      const expiresOn = document?.profile?.expiresOn;
      if (!document || !expiresOn || daysUntil(expiresOn, now) >= 0) continue;
      add("RULE-005", sources(key, edge.from), {
        severity: "IMPORTANT",
        title: `Expired document still supports ${assetLabel(item)}`,
        explanation: `“${document.name}” expired on ${expiresOn} but is still linked as a supporting document of this asset. Upload the renewed version, then unlink the expired one.`,
        recommendedAction: "Replace the expired document",
        destination: graph.nodes.get(key)?.href ?? "/assets",
      });
    }
  }

  const inactive = (beneficiaryId: string) => {
    const person = beneficiaryById.get(beneficiaryId);
    return person ? person.status === "INACTIVE" : complete.beneficiaries;
  };
  const describeHolder = (key: string) => {
    if (key === WILL) return { what: "Your Will names", href: "/legacy-plan/wizard" };
    if (key === SWITCH)
      return { what: "Your Dead Man’s Switch releases to", href: "/dead-man-switch" };
    if (key.startsWith("emergency:"))
      return { what: "Emergency access is set up for", href: "/emergency-access" };
    const node = graph.nodes.get(key);
    return { what: `${node?.label ?? "An asset"} is assigned to`, href: node?.href ?? "/assets" };
  };
  const beneficiaryRefs = [
    ...graph.edges
      .filter(
        (edge) =>
          edge.to.startsWith("beneficiary:") && ["assigned_to", "released_to"].includes(edge.type),
      )
      .map((edge) => ({ holder: edge.from, person: edge.to, nominee: false })),
    ...graph.edges
      .filter((edge) => edge.type === "referenced_by" && edge.from.startsWith("beneficiary:"))
      .map((edge) => ({ holder: edge.to, person: edge.from, nominee: false })),
    ...graph.edges
      .filter((edge) => edge.type === "nominee_of")
      .map((edge) => ({
        holder: edge.to,
        person: edge.from,
        nominee: true,
      })),
    ...graph.dangling
      .filter((ref) => ref.from.startsWith("beneficiary:") || ref.to.startsWith("beneficiary:"))
      .map((ref) => {
        const personIsFrom = ref.from.startsWith("beneficiary:");
        return {
          holder: personIsFrom ? ref.to : ref.from,
          person: personIsFrom ? ref.from : ref.to,
          nominee: ref.type === "nominee_of",
        };
      }),
  ];
  for (const { holder, person, nominee } of beneficiaryRefs) {
    const beneficiaryId = person.slice("beneficiary:".length);
    if (!inactive(beneficiaryId)) continue;
    const exists = graph.nodes.has(person);
    const name = graph.nodes.get(person)?.label ?? "";
    const { what, href } = nominee
      ? {
          what: `${graph.nodes.get(holder)?.label ?? "An asset"} names as nominee`,
          href: graph.nodes.get(holder)?.href ?? "/assets",
        }
      : describeHolder(holder);
    add(
      "RULE-006",
      [
        ...sources(holder),
        ...(exists
          ? sources(person)
          : [
              {
                kind: "beneficiary" as const,
                id: beneficiaryId,
                label: "Removed beneficiary",
                href: "",
              },
            ]),
      ],
      {
        severity: "IMPORTANT",
        title: exists
          ? `${what} ${name}, who is no longer active`
          : `${what} a beneficiary who has been removed`,
        explanation:
          "This instruction refers to someone without an active beneficiary record, so it may not work as intended. Review recommended.",
        recommendedAction: "Update who this instruction refers to",
        destination: href,
      },
    );
  }

  if (will && will.beneficiaryIds.length) {
    for (const person of input.beneficiaries) {
      if (person.status === "INACTIVE" || willNamed.has(person.id)) continue;
      const assigned = graph.in(beneficiaryKey(person.id), "assigned_to").filter((edge) => {
        const asset = assets.find(({ asset }) => assetKey(asset.id) === edge.from);
        return asset && isHeld(asset.asset.profile);
      });
      if (!assigned.length) continue;
      add("RULE-007", sources(beneficiaryKey(person.id), WILL), {
        severity: "IMPORTANT",
        title: `${person.name} receives assets but is not named in your Will`,
        explanation: `Your vault assigns ${n(assigned.length, "asset")} to ${person.name}, but your Will's beneficiaries section does not include them. Potential inconsistency detected — review recommended. Consider confirming with a qualified professional where appropriate.`,
        recommendedAction: "Review the beneficiaries section of your Will",
        destination: "/legacy-plan/wizard",
      });
    }
  }

  const documentGroups = new Map<string, string[]>();
  for (const document of input.documents) {
    const base = normalize(document.name.replace(/\.[^.]+$/, ""));
    if (!base) continue;
    const group = `${base}|${document.sizeBytes}|${document.mimeType}`;
    documentGroups.set(group, [...(documentGroups.get(group) ?? []), document.id]);
  }
  for (const group of documentGroups.values()) {
    if (group.length < 2) continue;
    const first = documentById.get(group[0]);
    add("RULE-008", sources(...group.map(documentKey)), {
      severity: "RECOMMENDED",
      title: `Potential duplicate document: ${first?.name ?? "document"}`,
      explanation: `${group.length} documents have the same name, type and size. That suggests copies but does not prove it — their contents are not compared. If they are copies, keep the current one; if they are different, you can dismiss this.`,
      recommendedAction: "Check whether they are copies",
      destination: `/documents?q=${encodeURIComponent(first?.name ?? "")}`,
    });
  }

  for (const item of assets) {
    if (isHeld(item.asset.profile)) continue;
    const key = assetKey(item.asset.id);
    const status = ASSET_STATUS_LABELS[item.asset.profile?.status ?? "ACTIVE"].toLowerCase();
    const still: string[] = [];
    const assigned = item.assignments.length;
    if (assigned) still.push(`assigned to ${n(assigned, "beneficiary", "beneficiaries")}`);
    const inWill = graph.out(key, "referenced_by").length > 0;
    if (inWill) still.push("referenced in your Will");
    if (graph.out(key, "protected_by").length) still.push("included in a release scope");
    if (!still.length) continue;
    add("RULE-009", inWill ? sources(key, WILL) : sources(key), {
      severity: "IMPORTANT",
      title: `${assetLabel(item)} is marked ${status} but is still ${still[0]}`,
      explanation: `Your records disagree: this asset is marked as ${status}, but it is still ${still.join(" and ")}. Update the records so they agree.`,
      recommendedAction: "Remove it from assignments and plans, or correct its status",
      destination: graph.nodes.get(key)?.href ?? "/assets",
    });
  }

  for (const person of input.beneficiaries) {
    if (person.status === "INACTIVE" || !willNamed.has(person.id)) continue;
    if (person.roles.assignmentCount > 0) continue;
    add("RULE-010", sources(beneficiaryKey(person.id), WILL), {
      severity: "RECOMMENDED",
      title: `${person.name} is named in your Will but has nothing assigned in the vault`,
      explanation:
        "Your Will includes this person, but no asset or document in your vault is assigned to or shared with them. If that is intentional, you can dismiss this.",
      recommendedAction: "Assign an asset or share a document with them",
      destination: "/assets",
    });
  }

  const sorted = findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      FINDING_TYPES.indexOf(a.type) - FINDING_TYPES.indexOf(b.type) ||
      a.title.localeCompare(b.title),
  );
  const open = sorted.filter((finding) => finding.status === "open");
  const openFor = (ruleId: RuleId) => open.filter((finding) => finding.ruleId === ruleId).length;
  const documentable = held.filter(({ asset }) => asset.kind !== "DIGITAL_ASSET").length;
  return {
    graph,
    coverage: {
      heldAssets: held.length,
      assignedAssets: held.length - openFor("ASSET-BEN-001"),
      documentableAssets: documentable,
      supportedAssets: documentable - openFor("ASSET-DOC-001"),
      documentsComplete: complete.documents,
      willConflicts: open.filter(
        (finding) =>
          finding.type === "CONFLICT" &&
          finding.sourceRecords.some((record) => record.kind === "will"),
      ).length,
    },
    findings: sorted,
    open,
    dismissed: sorted.filter((finding) => finding.status === "dismissed"),
    recommendations: recommend(open),
  };
}

function linkedAssetKeys(graph: LegacyGraph, documentId: string): string[] {
  return graph.out(documentKey(documentId), "documents").map((edge) => edge.to);
}

/**
 * Turns open findings into Action Centre actions: one per rule (or one per
 * finding for dated rules). Findings an existing action already covers produce
 * nothing, so the same gap is never listed twice.
 */
export function recommend(open: Finding[]): LegacyAction[] {
  const byRule = new Map<RuleId, Finding[]>();
  for (const finding of open) {
    if (finding.coveredBy) continue;
    byRule.set(finding.ruleId, [...(byRule.get(finding.ruleId) ?? []), finding]);
  }
  const actions: LegacyAction[] = [];
  for (const [ruleId, list] of byRule) {
    const rule = RULES[ruleId];
    const priority = list
      .map((finding) => finding.severity)
      .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0];
    if (rule.perFinding) {
      for (const finding of list) {
        actions.push({
          id: `intel-${finding.id}`,
          title: finding.title,
          explanation: finding.explanation,
          priority: finding.severity,
          source: rule.source,
          cta: rule.cta,
          href: finding.destination,
          deadline: finding.deadline,
          completed: false,
          ruleId,
        });
      }
      continue;
    }
    const single = list.length === 1 ? list[0] : null;
    actions.push({
      id: rule.replaces ?? `intel-${ruleId}`,
      title: single ? single.title : rule.summary(list.length),
      explanation: single ? single.explanation : rule.why,
      priority,
      source: rule.source,
      cta: single ? single.recommendedAction : rule.cta,
      href: single ? single.destination : rule.listHref,
      completed: false,
      ruleId,
    });
  }
  return actions;
}

/**
 * The Action Centre with intelligence merged in: a recommendation that
 * replaces an existing action keeps its id (and is marked complete once its
 * findings are gone); every other recommendation is added.
 */
export function mergeActions(
  actions: LegacyAction[],
  intelligence: LegacyIntelligence,
): LegacyAction[] {
  const merged = new Map(actions.map((action) => [action.id, action]));
  for (const recommendation of intelligence.recommendations) {
    merged.set(recommendation.id, recommendation);
  }
  for (const ruleId of RULE_IDS) {
    const rule = RULES[ruleId];
    if (!rule.replaces) continue;
    const existing = merged.get(rule.replaces);
    const stillOpen = intelligence.open.some((finding) => finding.ruleId === ruleId);
    if (existing && !stillOpen && !existing.completed) {
      merged.set(rule.replaces, {
        ...existing,
        title: rule.doneTitle ?? existing.title,
        completed: true,
      });
    }
  }
  return sortActions([...merged.values()]);
}

/** Findings that involve one record (asset detail, document card…). */
export function findingsFor(findings: Finding[], kind: NodeKind, id: string): Finding[] {
  return findings.filter((finding) =>
    finding.sourceRecords.some((record) => record.kind === kind && record.id === id),
  );
}

/** What the graph knows about one asset, for the detail page and cards. */
export function assetRelations(graph: LegacyGraph, assetId: string) {
  const key = assetKey(assetId);
  const node = (edgeKey: string) => graph.nodes.get(edgeKey) as GraphNode;
  return {
    documents: graph.in(key, "documents").map((edge) => ({
      node: node(edge.from),
      attachmentId: edge.attachmentId,
    })),
    beneficiaries: graph.out(key, "assigned_to").map((edge) => node(edge.to)),
    nominee: graph.in(key, "nominee_of").map((edge) => node(edge.from))[0] ?? null,
    inWill: graph.out(key, "referenced_by").length > 0,
    protectedBy: graph.out(key, "protected_by").map((edge) => node(edge.to)),
  };
}
