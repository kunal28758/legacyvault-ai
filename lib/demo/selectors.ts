import {
  PLAN_SECTION_KEYS,
  type AssetKind,
  type AssignmentResourceType,
  type DemoAsset,
  type DemoBeneficiary,
  type DemoWorkspace,
  type DmsStatus,
  type EaRequestStatus,
  type PlanSectionKey,
} from "@/lib/demo/types";

/* ── Plan ──────────────────────────────────────────────────────────────────── */

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

export interface SectionCompleteness {
  key: PlanSectionKey;
  title: string;
  complete: boolean;
  summary: string;
  required: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getPlanCompleteness(ws: DemoWorkspace): {
  sections: Record<PlanSectionKey, SectionCompleteness>;
  incompleteSections: PlanSectionKey[];
  percent: number;
} {
  const data = ws.plan?.stepsData ?? {};
  const sections = {} as Record<PlanSectionKey, SectionCompleteness>;

  const personal = asRecord(data["personal-details"]);
  sections["personal-details"] = {
    key: "personal-details",
    title: PLAN_SECTION_TITLES["personal-details"],
    required: true,
    complete: ["legalName", "dateOfBirth", "addressLine", "city", "country"].every((k) =>
      hasText(personal[k]),
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
    ws.beneficiaries.some((b) => b.id === id && b.status !== "INACTIVE"),
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

  const assetSection = (key: PlanSectionKey, kind: AssetKind) => {
    const section = asRecord(data[key]);
    const ids = stringList(section.assetIds).filter((id) =>
      ws.assets.some((a) => a.id === id && a.kind === kind),
    );
    const none = section.none === true;
    sections[key] = {
      key,
      title: PLAN_SECTION_TITLES[key],
      required: false,
      complete: none || ids.length > 0,
      summary: none
        ? "Marked as none"
        : ids.length
          ? `${ids.length} included`
          : "Nothing included yet",
    };
  };
  assetSection("financial-assets", "FINANCIAL_ASSET");
  assetSection("physical-assets", "PHYSICAL_ASSET");
  assetSection("digital-assets", "DIGITAL_ASSET");

  const witnesses = asRecord(data["witness-details"]);
  const witnessRows = Array.isArray(witnesses.witnesses)
    ? witnesses.witnesses.filter((w) => hasText(asRecord(w).name))
    : [];
  sections["witness-details"] = {
    key: "witness-details",
    title: PLAN_SECTION_TITLES["witness-details"],
    required: false,
    complete: witnessRows.length > 0 || witnesses.none === true,
    summary: witnessRows.length
      ? `${witnessRows.length} witness${witnessRows.length > 1 ? "es" : ""}`
      : "No witnesses recorded",
  };

  const wishes = asRecord(data["special-wishes"]);
  const wishFields = ["instructions", "funeralWishes", "messages"].filter((k) =>
    hasText(wishes[k]),
  );
  sections["special-wishes"] = {
    key: "special-wishes",
    title: PLAN_SECTION_TITLES["special-wishes"],
    required: false,
    complete: wishFields.length > 0,
    summary: wishFields.length ? `${wishFields.length} of 3 areas written` : "Nothing written yet",
  };

  const attachments = asRecord(data["document-attachments"]);
  const docIds = stringList(attachments.documentIds).filter((id) =>
    ws.documents.some((d) => d.id === id),
  );
  sections["document-attachments"] = {
    key: "document-attachments",
    title: PLAN_SECTION_TITLES["document-attachments"],
    required: false,
    complete: attachments.none === true || docIds.length > 0,
    summary:
      attachments.none === true
        ? "Marked as none"
        : docIds.length
          ? `${docIds.length} attached`
          : "No documents attached",
  };

  const incompleteSections = PLAN_SECTION_KEYS.filter((k) => !sections[k].complete);
  const percent = Math.round(
    ((PLAN_SECTION_KEYS.length - incompleteSections.length) / PLAN_SECTION_KEYS.length) * 100,
  );
  return { sections, incompleteSections, percent };
}

/* ── Assets & assignments ──────────────────────────────────────────────────── */

export const ASSET_KIND_META: Record<
  AssetKind,
  { label: string; plural: string; href: string; vizToken: "viz-1" | "viz-2" | "viz-3" }
> = {
  FINANCIAL_ASSET: {
    label: "Financial",
    plural: "Financial assets",
    href: "/assets/financial",
    vizToken: "viz-1",
  },
  PHYSICAL_ASSET: {
    label: "Physical",
    plural: "Physical assets",
    href: "/assets/physical",
    vizToken: "viz-2",
  },
  DIGITAL_ASSET: {
    label: "Digital",
    plural: "Digital assets",
    href: "/assets/digital",
    vizToken: "viz-3",
  },
};

export function assetsOfKind<K extends AssetKind>(
  ws: DemoWorkspace,
  kind: K,
): Extract<DemoAsset, { kind: K }>[] {
  return ws.assets.filter((a): a is Extract<DemoAsset, { kind: K }> => a.kind === kind);
}

export function assetTotal(assets: DemoAsset[]): number {
  return assets.reduce((sum, a) => sum + (a.estimatedValue ?? 0), 0);
}

export function assignmentsForResource(
  ws: DemoWorkspace,
  resourceType: AssignmentResourceType,
  resourceId: string,
) {
  return ws.assignments.filter(
    (a) => a.resourceType === resourceType && a.resourceId === resourceId,
  );
}

export function allocatedPercent(
  ws: DemoWorkspace,
  resourceType: AssignmentResourceType,
  resourceId: string,
): number {
  return assignmentsForResource(ws, resourceType, resourceId).reduce(
    (sum, a) => sum + (a.allocationPercentage ?? 0),
    0,
  );
}

export function unassignedAssets(ws: DemoWorkspace): DemoAsset[] {
  return ws.assets.filter((a) => assignmentsForResource(ws, a.kind, a.id).length === 0);
}

export function beneficiaryRoles(ws: DemoWorkspace, beneficiary: DemoBeneficiary) {
  const assignments = ws.assignments.filter((a) => a.beneficiaryId === beneficiary.id);
  return {
    assignmentCount: assignments.length,
    isTrustedContact: ws.dms.contactIds.includes(beneficiary.id),
    isEmergencyContact: ws.emergencyContacts.some(
      (c) => c.beneficiaryId === beneficiary.id && c.status === "ACTIVE",
    ),
    /** Informational aggregate (Clarifications 2026-09-18) — allocations are per resource. */
    averageAllocation: assignments.length
      ? Math.round(
          assignments.reduce((s, a) => s + (a.allocationPercentage ?? 0), 0) / assignments.length,
        )
      : 0,
  };
}

export function resourceName(
  ws: DemoWorkspace,
  resourceType: AssignmentResourceType,
  resourceId: string,
): string {
  if (resourceType === "DOCUMENT")
    return ws.documents.find((d) => d.id === resourceId)?.name ?? "Document";
  if (resourceType === "VIDEO_MESSAGE")
    return ws.videos.find((v) => v.id === resourceId)?.title ?? "Video message";
  return ws.assets.find((a) => a.id === resourceId)?.name ?? "Asset";
}

/* ── Dead Man's Switch ─────────────────────────────────────────────────────── */

export const DMS_STAGES: { status: DmsStatus; label: string; description: string }[] = [
  { status: "ACTIVE", label: "Active", description: "Monitoring — check-ins on schedule" },
  { status: "REMINDER_SENT", label: "Check-in due", description: "Reminder sent, waiting for you" },
  { status: "GRACE_PERIOD", label: "Grace period", description: "Extra time before escalation" },
  {
    status: "ESCALATING",
    label: "Escalating",
    description: "Secondary channels and trusted contacts",
  },
  { status: "RELEASING", label: "Release ready", description: "Final step before scoped release" },
  {
    status: "RELEASED",
    label: "Released",
    description: "Selected resources delivered to contacts",
  },
];

export function dmsView(status: DmsStatus): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  stageIndex: number;
} {
  switch (status) {
    case "INACTIVE":
      return { label: "Disabled", tone: "neutral", stageIndex: -1 };
    case "PAUSED":
      return { label: "Paused", tone: "info", stageIndex: -1 };
    case "ACTIVE":
      return { label: "Active", tone: "success", stageIndex: 0 };
    case "REMINDER_SENT":
      return { label: "Check-in due", tone: "warning", stageIndex: 1 };
    case "GRACE_PERIOD":
      return { label: "Grace period", tone: "warning", stageIndex: 2 };
    case "ESCALATING":
      return { label: "Escalating", tone: "danger", stageIndex: 3 };
    case "RELEASING":
      return { label: "Release ready", tone: "danger", stageIndex: 4 };
    case "RELEASED":
      return { label: "Released", tone: "danger", stageIndex: 5 };
  }
}

/* ── Emergency access ──────────────────────────────────────────────────────── */

export function eaRequestView(status: EaRequestStatus): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
} {
  switch (status) {
    case "PENDING":
    case "VERIFYING":
      return { label: "Verifying identity", tone: "info" };
    case "VERIFIED":
      return { label: "Awaiting your decision", tone: "warning" };
    case "APPROVED":
    case "AUTO_GRANTED":
      return { label: "Approved — delivering link", tone: "success" };
    case "ACTIVE":
      return { label: "Access active", tone: "success" };
    case "DENIED":
      return { label: "Denied", tone: "danger" };
    case "REVOKED":
      return { label: "Revoked", tone: "danger" };
    case "EXPIRED":
      return { label: "Expired", tone: "neutral" };
    case "FAILED":
      return { label: "Verification failed", tone: "danger" };
  }
}

/* ── Security & readiness ──────────────────────────────────────────────────── */

export interface SecurityCheck {
  id: string;
  title: string;
  status: "good" | "attention" | "risk";
  detail: string;
  href?: string;
  action?: string;
}

export function securityChecks(ws: DemoWorkspace): SecurityCheck[] {
  const encryptedAssets = ws.assets.filter(
    (a) =>
      (a.kind === "FINANCIAL_ASSET" && (a.accountNumberHint || a.policyNumberHint)) ||
      (a.kind === "DIGITAL_ASSET" && (a.hasCredentials || a.hasRecoveryInfo)),
  ).length;
  const pendingScans = ws.documents.filter((d) => d.scanStatus !== "CLEAN").length;
  const openRequests = ws.emergencyRequests.filter((r) => r.status === "VERIFIED").length;
  const dms = dmsView(ws.dms.status);

  return [
    {
      id: "auth",
      title: "Authentication",
      status: ws.security.mfaEnabled ? "good" : "attention",
      detail: ws.security.mfaEnabled
        ? "Email verified · two-factor authentication on"
        : "Email verified · two-factor authentication is off",
      href: "/settings?tab=security",
      action: ws.security.mfaEnabled ? undefined : "Enable 2FA",
    },
    {
      id: "encryption",
      title: "Sensitive fields",
      status: "good",
      detail: `${encryptedAssets} asset${encryptedAssets === 1 ? "" : "s"} with encrypted fields · revealed only after re-verification`,
    },
    {
      id: "documents",
      title: "Document protection",
      status: pendingScans === 0 ? "good" : "attention",
      detail:
        pendingScans === 0
          ? `${ws.documents.length} documents in private storage · all scanned clean`
          : `${pendingScans} document${pendingScans === 1 ? "" : "s"} awaiting malware scan`,
      href: "/documents",
    },
    {
      id: "dms",
      title: "Dead Man's Switch",
      status: dms.tone === "success" ? "good" : dms.tone === "danger" ? "risk" : "attention",
      detail: `${dms.label} · ${ws.dms.contactIds.length} trusted contact${ws.dms.contactIds.length === 1 ? "" : "s"}`,
      href: "/dead-man-switch",
    },
    {
      id: "ea",
      title: "Emergency access",
      status: openRequests > 0 ? "attention" : ws.emergencyContacts.length ? "good" : "attention",
      detail:
        openRequests > 0
          ? `${openRequests} request${openRequests === 1 ? "" : "s"} waiting for your decision`
          : ws.emergencyContacts.length
            ? `${ws.emergencyContacts.length} emergency contact${ws.emergencyContacts.length === 1 ? "" : "s"} configured`
            : "No emergency contact configured",
      href: "/emergency-access",
      action: openRequests > 0 ? "Review" : undefined,
    },
    {
      id: "sessions",
      title: "Active sessions",
      status: ws.security.sessions.length > 2 ? "attention" : "good",
      detail: `${ws.security.sessions.length} device${ws.security.sessions.length === 1 ? "" : "s"} signed in`,
      href: "/settings?tab=security",
    },
  ];
}

export function securityScore(ws: DemoWorkspace): number {
  const checks = securityChecks(ws);
  const points = checks.reduce(
    (sum, c) => sum + (c.status === "good" ? 1 : c.status === "attention" ? 0.5 : 0),
    0,
  );
  return Math.round((points / checks.length) * 100);
}

export interface ReadinessBreakdown {
  score: number;
  items: {
    id: string;
    label: string;
    weight: number;
    earned: number;
    hint: string;
    href: string;
  }[];
}

export function readiness(ws: DemoWorkspace): ReadinessBreakdown {
  const plan = getPlanCompleteness(ws);
  const activeBeneficiaries = ws.beneficiaries.filter((b) => b.status !== "INACTIVE").length;
  const assigned = ws.assets.length - unassignedAssets(ws).length;
  const coverage = ws.assets.length ? assigned / ws.assets.length : 0;
  const items: ReadinessBreakdown["items"] = [
    {
      id: "plan",
      label: ws.plan?.status === "FINALIZED" ? "Legacy plan finalized" : "Legacy plan",
      weight: 35,
      earned: ws.plan?.status === "FINALIZED" ? 35 : Math.round((plan.percent / 100) * 30),
      hint:
        ws.plan?.status === "FINALIZED"
          ? `v${ws.plan.version} finalized`
          : `${plan.percent}% of sections complete`,
      href: "/legacy-plan",
    },
    {
      id: "beneficiaries",
      label: "Beneficiaries",
      weight: 15,
      earned: Math.min(15, activeBeneficiaries * 5),
      hint: `${activeBeneficiaries} active or pending`,
      href: "/beneficiaries",
    },
    {
      id: "assets",
      label: "Assets assigned",
      weight: 15,
      earned: Math.round(coverage * 15),
      hint: `${assigned} of ${ws.assets.length} assets have a beneficiary`,
      href: "/assets",
    },
    {
      id: "documents",
      label: "Documents in the vault",
      weight: 10,
      earned: Math.min(10, ws.documents.length * 2.5),
      hint: `${ws.documents.length} documents`,
      href: "/documents",
    },
    {
      id: "dms",
      label: "Dead Man's Switch",
      weight: 10,
      earned: ws.dms.status === "INACTIVE" ? 0 : ws.dms.status === "PAUSED" ? 5 : 10,
      hint: dmsView(ws.dms.status).label,
      href: "/dead-man-switch",
    },
    {
      id: "ea",
      label: "Emergency access",
      weight: 5,
      earned: ws.emergencyContacts.length ? 5 : 0,
      hint: ws.emergencyContacts.length ? "Contact configured" : "Not configured",
      href: "/emergency-access",
    },
    {
      id: "security",
      label: "Account security",
      weight: 10,
      earned: ws.security.mfaEnabled ? 10 : 4,
      hint: ws.security.mfaEnabled ? "2FA enabled" : "2FA not enabled",
      href: "/security-center",
    },
  ];
  const score = Math.min(100, Math.round(items.reduce((s, i) => s + i.earned, 0)));
  return { score, items };
}

export function unreadNotifications(ws: DemoWorkspace): number {
  return ws.notifications.filter((n) => !n.readAt).length;
}
