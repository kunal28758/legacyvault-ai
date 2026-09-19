import {
  ASSET_KIND_META,
  getPlanCompleteness,
  readiness,
  unassignedAssets,
} from "@/lib/demo/selectors";
import type { DemoWorkspace } from "@/lib/demo/types";
import { formatCompactCurrency } from "@/lib/format";

/**
 * Local, rule-based assistant used while no AI provider is connected.
 *
 * It answers from the demo workspace (counts, gaps, next steps) so the
 * conversation is grounded and useful, never invents facts, and flags what it
 * cannot know (jurisdiction-specific legal requirements). The real assistant
 * (T108–T110, ADR-008) streams from `POST /api/v1/ai/assistant/message` with the
 * same client-held, session-scoped history contract (ADR-016).
 */
export const SUGGESTED_PROMPTS = [
  "Help me organize my digital assets",
  "What information should I add to my legacy plan?",
  "Help me review my beneficiary assignments",
  "Help me prepare a legacy plan draft",
];

export interface AssistantReply {
  content: string;
  /** Detected limits of the answer, shown as flags (FR-R004/R005). */
  flags: string[];
  suggestions: string[];
}

function list(items: string[], max = 4): string {
  const shown = items.slice(0, max);
  return (
    shown.map((i) => `• ${i}`).join("\n") +
    (items.length > max ? `\n• …and ${items.length - max} more` : "")
  );
}

export function generateAssistantReply(message: string, ws: DemoWorkspace): AssistantReply {
  const q = message.toLowerCase();
  const plan = getPlanCompleteness(ws);
  const score = readiness(ws);
  const unassigned = unassignedAssets(ws);

  if (/digital asset|online account|domain|wallet|subscription|password|credential/.test(q)) {
    const digital = ws.assets.filter((a) => a.kind === "DIGITAL_ASSET");
    const missingRecovery = digital.filter((a) => a.kind === "DIGITAL_ASSET" && !a.hasRecoveryInfo);
    return {
      content:
        `You have ${digital.length} digital asset${digital.length === 1 ? "" : "s"} recorded${digital.length ? `:\n${list(digital.map((a) => `${a.name} (${a.category.replace(/_/g, " ").toLowerCase()})`))}` : "."}\n\n` +
        `A tidy digital inventory usually covers: email and cloud accounts, domains and hosting, financial apps, crypto wallets, subscriptions that renew, and social profiles with a wish (memorialize, delete, hand over).\n\n` +
        (missingRecovery.length
          ? `${missingRecovery.length} of them have no recovery information stored yet (${missingRecovery.map((a) => a.name).join(", ")}). Adding it — encrypted, revealed only after re-verification — is the single most useful next step.`
          : `All of them have recovery information stored. Consider assigning each one to a beneficiary so the hand-over is clear.`),
      flags: ["Based only on what is recorded in your workspace"],
      suggestions: ["Which digital assets have no beneficiary?", "How are credentials protected?"],
    };
  }

  if (/beneficiar|assignment|allocation|inherit|share/.test(q)) {
    const active = ws.beneficiaries.filter((b) => b.status !== "INACTIVE");
    const pending = ws.beneficiaries.filter((b) => b.status === "PENDING");
    const over = ws.assets.filter((a) => {
      const total = ws.assignments
        .filter((x) => x.resourceId === a.id)
        .reduce((s, x) => s + (x.allocationPercentage ?? 0), 0);
      return total > 0 && total < 100;
    });
    return {
      content:
        `You have ${active.length} beneficiar${active.length === 1 ? "y" : "ies"} (${pending.length} still pending their invitation).\n\n` +
        (unassigned.length
          ? `${unassigned.length} asset${unassigned.length === 1 ? " has" : "s have"} no beneficiary yet:\n${list(unassigned.map((a) => `${a.name} · ${formatCompactCurrency(a.estimatedValue, a.currency)}`))}\n\n`
          : `Every asset has at least one beneficiary. `) +
        (over.length
          ? `${over.length} asset${over.length === 1 ? " is" : "s are"} partially allocated (under 100 %): ${over.map((a) => a.name).join(", ")}. Allocation is per resource, so the remaining share is simply unallocated until you assign it.`
          : `Allocations that exist add up cleanly — nothing exceeds 100 % per resource.`),
      flags: [
        "Allocation rules are enforced by the platform; inheritance law varies by jurisdiction",
      ],
      suggestions: [
        "Help me assign the unassigned assets",
        "What does a pending beneficiary mean?",
      ],
    };
  }

  if (/draft|prepare|write|will generator|generate/.test(q)) {
    return {
      content:
        `I can help you prepare a draft, but nothing I produce becomes part of your plan until you review and explicitly confirm it.\n\n` +
        `A first draft normally works from what you already recorded: ${plan.sections["personal-details"].complete ? "personal details ✓" : "personal details (missing)"}, ${ws.beneficiaries.length} beneficiaries, ${ws.assets.length} assets and your special wishes${plan.sections["special-wishes"].complete ? " ✓" : " (not written yet)"}.\n\n` +
        `Suggested order: complete Personal Details and Special Wishes in the wizard, assign the ${unassigned.length} unassigned asset${unassigned.length === 1 ? "" : "s"}, then generate a draft from the finalized plan. The AI will generator (with confidence per section and a confirm step) becomes available once the AI provider is connected.`,
      flags: [
        "Drafts are informational, not legal advice",
        "AI provider not connected in this demo",
      ],
      suggestions: ["What information should I add to my legacy plan?", "Open the will wizard"],
    };
  }

  if (/legacy plan|plan|what information|add to my|missing|incomplete|finaliz/.test(q)) {
    const incomplete = plan.incompleteSections.map((k) => plan.sections[k].title);
    return {
      content:
        `Your legacy plan is ${plan.percent}% complete. ${incomplete.length ? `Sections still open:\n${list(incomplete, 9)}` : "Every section is complete."}\n\n` +
        `Personal Details is the only section required to finalize; the others can be acknowledged as incomplete and completed in a later version.\n\n` +
        `Beyond the wizard, families usually thank you for: where important documents physically are, who to call first, recurring payments to cancel, and wishes for digital accounts.`,
      flags: incomplete.length ? [] : ["Consider a professional review before relying on the plan"],
      suggestions: incomplete.length
        ? [`Take me to ${incomplete[0]}`, "Help me prepare a legacy plan draft"]
        : ["Help me review my beneficiary assignments"],
    };
  }

  if (/dead man|switch|check.?in|inactiv/.test(q)) {
    return {
      content:
        `Your Dead Man’s Switch is ${ws.dms.status.replace(/_/g, " ").toLowerCase()} with a ${ws.dms.inactivityPeriodDays}-day inactivity threshold and check-ins every ${ws.dms.checkInFrequencyDays} days. ${ws.dms.contactIds.length} trusted contact${ws.dms.contactIds.length === 1 ? "" : "s"} would be notified during escalation.\n\n` +
        `The release scope currently covers ${ws.dms.releaseScope.documents.length} documents, ${ws.dms.releaseScope.assets.length} assets, ${ws.dms.releaseScope.videos.length} videos and ${ws.dms.releaseScope.planSections.length} plan sections — nothing outside it is ever released.`,
      flags: [],
      suggestions: [
        "What happens if I miss a check-in?",
        "Help me review my beneficiary assignments",
      ],
    };
  }

  if (/emergency/.test(q)) {
    const pendingReq = ws.emergencyRequests.filter((r) => r.status === "VERIFIED").length;
    return {
      content:
        `You have ${ws.emergencyContacts.length} emergency contact${ws.emergencyContacts.length === 1 ? "" : "s"}${pendingReq ? ` and ${pendingReq} request${pendingReq === 1 ? "" : "s"} waiting for your decision` : ""}.\n\n` +
        `Emergency access requires the contact to verify a one-time code, then your approval (or your timeout rule). Access is scoped, time-limited and revocable.`,
      flags: [],
      suggestions: ["Open emergency access", "Help me review my beneficiary assignments"],
    };
  }

  if (/secur|2fa|two.factor|mfa|encrypt|safe/.test(q)) {
    return {
      content:
        `Security snapshot: email verified, two-factor authentication ${ws.security.mfaEnabled ? "enabled" : "not enabled"}, ${ws.security.sessions.length} active session${ws.security.sessions.length === 1 ? "" : "s"}.\n\n` +
        `Sensitive fields (account numbers, credentials, recovery info) are encrypted with AES-256-GCM and only decrypted after you re-verify. Documents live in private storage behind short-lived signed links.` +
        (ws.security.mfaEnabled
          ? ""
          : `\n\nEnabling two-factor authentication is the highest-impact improvement available right now.`),
      flags: [],
      suggestions: ["Open the Security Center", "How are credentials protected?"],
    };
  }

  if (/hello|hi|hey|thanks|thank you/.test(q)) {
    return {
      content: `Happy to help. Your legacy readiness is ${score.score}/100. Ask me about your plan, beneficiaries, assets, documents, the Dead Man’s Switch or security — I answer from what is in your workspace.`,
      flags: [],
      suggestions: SUGGESTED_PROMPTS.slice(0, 3),
    };
  }

  const gaps = score.items
    .filter((i) => i.earned < i.weight)
    .sort((a, b) => b.weight - b.earned - (a.weight - a.earned));
  return {
    content:
      `I can only answer from what is recorded in your workspace, so here is the most useful overview I can give.\n\n` +
      `Legacy readiness: ${score.score}/100. Biggest gaps:\n${list(gaps.slice(0, 3).map((g) => `${g.label} — ${g.hint}`))}\n\n` +
      `Assets by class: ${(["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"] as const).map((k) => `${ws.assets.filter((a) => a.kind === k).length} ${ASSET_KIND_META[k].label.toLowerCase()}`).join(", ")}. Documents in the vault: ${ws.documents.length}.`,
    flags: ["I could not match your question to a specific area — try one of the suggestions"],
    suggestions: SUGGESTED_PROMPTS.slice(0, 3),
  };
}
