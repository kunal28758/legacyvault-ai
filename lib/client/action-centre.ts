import { lifeEventEvidence, type LegacySnapshot } from "@/lib/client/legacy-snapshot";
import { LIFE_EVENT_CATALOGUE, lifeEventSteps } from "@/lib/legacy-plan/life-events";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/types/document-profile";

/**
 * The Action Centre: what needs the owner's attention, derived only from real
 * state (LegacySnapshot). Rules are listed in one place, each with the
 * condition that raises it and the condition that completes it. A rule that
 * does not apply produces nothing — no placeholder actions are ever invented.
 */
export type ActionPriority = "CRITICAL" | "IMPORTANT" | "UPCOMING" | "RECOMMENDED";

export type ActionSource =
  | "Will"
  | "Beneficiaries"
  | "Emergency"
  | "Dead Man’s Switch"
  | "Security"
  | "Vault"
  | "Assets"
  | "Life events";

export interface LegacyAction {
  id: string;
  title: string;
  explanation: string;
  priority: ActionPriority;
  source: ActionSource;
  cta: string;
  href: string;
  /** ISO timestamp or date the action is due by, when there is one. */
  deadline?: string;
  completed: boolean;
}

export const PRIORITY_ORDER: ActionPriority[] = [
  "CRITICAL",
  "IMPORTANT",
  "UPCOMING",
  "RECOMMENDED",
];

export const PRIORITY_LABELS: Record<ActionPriority | "COMPLETED", string> = {
  CRITICAL: "Critical",
  IMPORTANT: "Important",
  UPCOMING: "Upcoming",
  RECOMMENDED: "Recommended",
  COMPLETED: "Completed",
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export function deriveActions(s: LegacySnapshot): LegacyAction[] {
  const actions: LegacyAction[] = [];
  const add = (action: Omit<LegacyAction, "completed"> & { completed?: boolean }) =>
    actions.push({ completed: false, ...action });
  const nextCheckInMs = s.dms.nextCheckInAt ? Date.parse(s.dms.nextCheckInAt) - s.now : null;

  // ── Emergency & switch: time-critical first ────────────────────────────────
  for (const request of s.emergency.openRequests) {
    add({
      id: `ea-request-${request.id}`,
      title: "Emergency access request needs your decision",
      explanation:
        "A designated contact verified their identity and is waiting. If you do nothing, your timeout rule applies when the request expires.",
      priority: "CRITICAL",
      source: "Emergency",
      cta: "Review request",
      href: "/emergency-access",
      deadline: request.expiresAt,
    });
  }

  if (["ESCALATING", "RELEASING"].includes(s.dms.status)) {
    add({
      id: "dms-escalating",
      title: "Your Dead Man’s Switch is escalating",
      explanation:
        "Check-ins stopped and contacts are being notified. Recover now if you are active — release happens only at the final stage.",
      priority: "CRITICAL",
      source: "Dead Man’s Switch",
      cta: "Recover",
      href: "/dead-man-switch",
    });
  } else if (["REMINDER_SENT", "GRACE_PERIOD"].includes(s.dms.status)) {
    add({
      id: "dms-overdue",
      title: "Check-in overdue",
      explanation:
        s.dms.status === "GRACE_PERIOD"
          ? "The grace period is running. Check in to stop escalation."
          : "A reminder was sent. Check in to keep the switch on schedule.",
      priority: "CRITICAL",
      source: "Dead Man’s Switch",
      cta: "Check in",
      href: "/dead-man-switch",
      deadline: s.dms.nextCheckInAt ?? undefined,
    });
  } else if (
    s.dms.status === "ACTIVE" &&
    nextCheckInMs !== null &&
    nextCheckInMs < 7 * 86_400_000
  ) {
    add({
      id: "dms-checkin-soon",
      title: "Check-in due soon",
      explanation: "Confirm you are active before the deadline to keep the switch on schedule.",
      priority: "UPCOMING",
      source: "Dead Man’s Switch",
      cta: "Check in",
      href: "/dead-man-switch",
      deadline: s.dms.nextCheckInAt ?? undefined,
    });
  }

  // ── Will ──────────────────────────────────────────────────────────────────
  if (!s.plan.exists && !s.plan.finalized) {
    add({
      id: "will",
      title: "Start your will",
      explanation: "The guided plan takes about ten minutes for a first draft and saves as you go.",
      priority: "IMPORTANT",
      source: "Will",
      cta: "Start will",
      href: "/legacy-plan/wizard",
    });
  } else if (s.plan.status === "DRAFT" && s.plan.percent < 100) {
    add({
      id: "will",
      title: "Complete your will",
      explanation: `${s.plan.percent}% complete. Still to do: ${s.plan.incompleteSections.slice(0, 3).join(", ")}${s.plan.incompleteSections.length > 3 ? "…" : ""}.`,
      priority: "IMPORTANT",
      source: "Will",
      cta: "Continue will",
      href: "/legacy-plan/wizard",
    });
  } else if (s.plan.status === "DRAFT") {
    add({
      id: "will",
      title: "Review and finalize your will",
      explanation: "Every section is complete. Finalizing preserves an immutable version.",
      priority: "IMPORTANT",
      source: "Will",
      cta: "Review",
      href: "/legacy-plan/wizard",
    });
  } else {
    add({
      id: "will",
      title: "Will finalized",
      explanation: "A finalized version is preserved. Review it after major life changes.",
      priority: "IMPORTANT",
      source: "Will",
      cta: "Open",
      href: "/legacy-plan",
      completed: true,
    });
  }

  // ── Beneficiaries ─────────────────────────────────────────────────────────
  add({
    id: "beneficiary-first",
    title: s.beneficiaries.total ? "Beneficiaries added" : "Add your first beneficiary",
    explanation: s.beneficiaries.total
      ? plural(s.beneficiaries.total, "person", "people") + " can receive what you assign."
      : "Nobody is set up to receive anything yet. Recipients never need an account.",
    priority: "IMPORTANT",
    source: "Beneficiaries",
    cta: "Add beneficiary",
    href: "/beneficiaries?new=1",
    completed: s.beneficiaries.total > 0,
  });
  if (s.beneficiaries.pending > 0) {
    add({
      id: "beneficiary-pending",
      title: `${plural(s.beneficiaries.pending, "invitation")} not accepted yet`,
      explanation:
        "They have not opened their secure access link. You can resend it from their profile.",
      priority: "IMPORTANT",
      source: "Beneficiaries",
      cta: "Review invitations",
      href: "/beneficiaries",
    });
  }
  if (s.beneficiaries.total > 0) {
    const assigned = s.beneficiaries.withAssignments > 0 || s.documents.shared > 0;
    add({
      id: "beneficiary-assign",
      title: assigned ? "Resources assigned to beneficiaries" : "Decide who receives what",
      explanation: assigned
        ? "At least one beneficiary has assets or documents assigned."
        : "Assign assets or share documents so each person knows what is theirs.",
      priority: "RECOMMENDED",
      source: "Beneficiaries",
      cta: "Assign",
      href: "/assets",
      completed: assigned,
    });
  }

  // ── Security ──────────────────────────────────────────────────────────────
  add({
    id: "security-mfa",
    title: s.security.mfaEnabled
      ? "Two-factor authentication on"
      : "Turn on two-factor authentication",
    explanation: s.security.mfaEnabled
      ? "A second factor protects sign-in and sensitive actions."
      : "Without a second factor, a stolen password is enough to reach your vault.",
    priority: "IMPORTANT",
    source: "Security",
    cta: "Turn on 2FA",
    href: "/settings?tab=security",
    completed: s.security.mfaEnabled,
  });
  add({
    id: "security-email",
    title: s.security.emailVerified ? "Email verified" : "Verify your email",
    explanation: "Security alerts and recovery messages go to your verified address.",
    priority: "IMPORTANT",
    source: "Security",
    cta: "Verify",
    href: "/settings",
    completed: s.security.emailVerified,
  });
  add({
    id: "security-recovery",
    title: s.security.recoveryEmail ? "Recovery email on file" : "Add a recovery email",
    explanation: "A second address keeps you reachable if your primary email fails.",
    priority: "RECOMMENDED",
    source: "Security",
    cta: "Add email",
    href: "/settings",
    completed: s.security.recoveryEmail,
  });

  // ── Emergency access & switch setup ───────────────────────────────────────
  add({
    id: "emergency-contact",
    title: s.emergency.contacts ? "Emergency contact designated" : "Designate an emergency contact",
    explanation: s.emergency.contacts
      ? "Someone you trust can request verified, time-limited access."
      : "No one can request access to your legacy if something happens suddenly.",
    priority: "RECOMMENDED",
    source: "Emergency",
    cta: "Designate",
    href: "/emergency-access",
    completed: s.emergency.contacts > 0,
  });
  const armed = !["INACTIVE", "PAUSED"].includes(s.dms.status);
  add({
    id: "dms-setup",
    title: armed
      ? "Dead Man’s Switch monitoring"
      : s.dms.status === "PAUSED"
        ? "Dead Man’s Switch paused"
        : "Set up the Dead Man’s Switch",
    explanation: armed
      ? "Check-ins are on schedule."
      : s.dms.status === "PAUSED"
        ? "No deadline is running while it stays paused. Resume when you are ready."
        : "Optional: release chosen resources to trusted contacts only if you stop checking in.",
    priority: "RECOMMENDED",
    source: "Dead Man’s Switch",
    cta: s.dms.status === "PAUSED" ? "Resume" : "Set up",
    href: "/dead-man-switch",
    completed: armed,
  });
  if (armed && s.dms.trustedContacts === 0) {
    add({
      id: "dms-contacts",
      title: "Add trusted contacts to your switch",
      explanation: "The switch is on, but a release would reach nobody.",
      priority: "IMPORTANT",
      source: "Dead Man’s Switch",
      cta: "Add contacts",
      href: "/dead-man-switch",
    });
  }
  if (armed && s.dms.releaseScopeSize === 0) {
    add({
      id: "dms-scope",
      title: "Choose what the switch releases",
      explanation: "Nothing is selected for release yet — only what you choose is ever shared.",
      priority: "IMPORTANT",
      source: "Dead Man’s Switch",
      cta: "Choose",
      href: "/dead-man-switch",
    });
  }

  // ── Vault ─────────────────────────────────────────────────────────────────
  add({
    id: "documents-first",
    title: s.documents.total ? "Documents in your vault" : "Add your first important document",
    explanation: s.documents.total
      ? `${plural(s.documents.total, "document")} stored privately.`
      : "Wills, deeds, policies and identity documents are what your family will look for first.",
    priority: "IMPORTANT",
    source: "Vault",
    cta: "Upload",
    href: "/documents?upload=1",
    completed: s.documents.total > 0,
  });
  if (s.documents.expired.length) {
    const first = s.documents.expired[0];
    add({
      id: "documents-expired",
      title: `${plural(s.documents.expired.length, "document")} expired`,
      explanation: `${first.name} expired on ${first.date}. Upload the renewed version so it stays current.`,
      priority: "IMPORTANT",
      source: "Vault",
      cta: "Review",
      href: `/documents?q=${encodeURIComponent(first.name)}`,
      deadline: first.date,
    });
  }
  for (const doc of s.documents.expiringSoon) {
    add({
      id: `document-expiring-${doc.id}`,
      title: `${doc.name} expires ${doc.days === 0 ? "today" : `in ${plural(doc.days, "day")}`}`,
      explanation: "Renew it and upload the new version before it lapses.",
      priority: "UPCOMING",
      source: "Vault",
      cta: "Open",
      href: `/documents?q=${encodeURIComponent(doc.name)}`,
      deadline: doc.date,
    });
  }
  for (const doc of s.documents.reviewDue) {
    add({
      id: `document-review-${doc.id}`,
      title: `Review ${doc.name}`,
      explanation:
        doc.days < 0
          ? `You planned to review it on ${doc.date}.`
          : "You set a reminder to review it.",
      priority: "UPCOMING",
      source: "Vault",
      cta: "Open",
      href: `/documents?q=${encodeURIComponent(doc.name)}`,
      deadline: doc.date,
    });
  }
  if (s.documents.total > 0) {
    const uncategorized = s.documents.total - s.documents.categorized;
    add({
      id: "documents-categorize",
      title: uncategorized
        ? `Categorize ${plural(uncategorized, "document")}`
        : "Documents categorized",
      explanation: uncategorized
        ? "Categories and expiry dates let LegacyVault tell you what is missing and what is about to lapse."
        : "Every document has a category.",
      priority: "RECOMMENDED",
      source: "Vault",
      cta: "Categorize",
      href: "/documents",
      completed: uncategorized === 0,
    });
    const hasWillCopy = (s.documents.byCategory.WILL_ESTATE ?? 0) > 0;
    add({
      id: "documents-will-copy",
      title: hasWillCopy ? "Will & estate documents stored" : "Store a signed copy of your will",
      explanation: hasWillCopy
        ? `${DOCUMENT_CATEGORY_LABELS.WILL_ESTATE} documents are in your vault.`
        : `If you already uploaded it, set its category to “${DOCUMENT_CATEGORY_LABELS.WILL_ESTATE}”.`,
      priority: "RECOMMENDED",
      source: "Vault",
      cta: "Upload",
      href: "/documents?upload=1",
      completed: hasWillCopy,
    });
  }

  // ── Assets ────────────────────────────────────────────────────────────────
  if (s.assets.total > 0) {
    const unassigned = s.assets.total - s.assets.assigned;
    add({
      id: "assets-unassigned",
      title: unassigned
        ? `${plural(unassigned, "asset")} without a beneficiary`
        : "Every asset has a beneficiary",
      explanation: unassigned
        ? "Assign each asset so it is clear who should receive it."
        : "Allocations are recorded for every asset.",
      priority: "RECOMMENDED",
      source: "Assets",
      cta: "Assign",
      href: "/assets",
      completed: unassigned === 0,
    });
  }
  add({
    id: "assets-digital",
    title: s.assets.digital ? "Digital accounts recorded" : "Record your online accounts",
    explanation: s.assets.digital
      ? `${plural(s.assets.digital, "digital asset")} recorded.`
      : "If you have email, cloud, social or crypto accounts, record them so they are not lost. Credentials are encrypted.",
    priority: "RECOMMENDED",
    source: "Assets",
    cta: "Add account",
    href: "/assets/digital?new=1",
    completed: s.assets.digital > 0,
  });

  // ── Life events the owner recorded ────────────────────────────────────────
  for (const event of s.lifeEvents) {
    const steps = lifeEventSteps(event, lifeEventEvidence(s));
    for (const step of steps) {
      add({
        id: `life-${event.id}-${step.id}`,
        title: `${LIFE_EVENT_CATALOGUE[event.type].label}: ${step.title}`,
        explanation: step.detail,
        priority: "RECOMMENDED",
        source: "Life events",
        cta: "Open",
        href: step.href,
        completed: step.complete,
      });
    }
  }

  return sortActions(actions);
}

/** Open actions by priority, then soonest deadline; completed ones last. */
export function sortActions(actions: LegacyAction[]): LegacyAction[] {
  const rank = (a: LegacyAction) => (a.completed ? 99 : PRIORITY_ORDER.indexOf(a.priority));
  const due = (a: LegacyAction) => (a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY);
  return [...actions].sort((a, b) => rank(a) - rank(b) || due(a) - due(b));
}

export function openActions(actions: LegacyAction[]): LegacyAction[] {
  return actions.filter((action) => !action.completed);
}
