import { ASSET_KIND_META } from "@/lib/assets/meta";
import { formatCompactCurrency } from "@/lib/format";

/**
 * Local, rule-based assistant shown while no AI provider is connected.
 *
 * It is **not** an AI. It matches a question against a handful of topics and
 * answers from the caller's own real data — counts, gaps, next steps — so the
 * page is useful without anything being invented. Every reply says where its
 * information came from, and the page labels the whole panel as not being the
 * real assistant.
 *
 * The production assistant (ADR-008, ADR-016) will stream from
 * `POST /api/v1/ai/assistant/message`. That work is deliberately deferred.
 */
export const SUGGESTED_PROMPTS = [
  "Help me organize my digital assets",
  "What information should I add to my legacy plan?",
  "Help me review my beneficiary assignments",
  "Help me prepare a legacy plan draft",
];

export interface AssistantReply {
  content: string;
  /** Limits of the answer, shown as flags (FR-R004/R005). */
  flags: string[];
  suggestions: string[];
}

/** Everything the rules may read. All of it comes from the API. */
export interface AssistantContext {
  planPercent: number;
  incompleteSectionTitles: string[];
  personalDetailsComplete: boolean;
  specialWishesComplete: boolean;
  readinessScore: number;
  readinessGaps: { label: string; hint: string }[];
  beneficiaries: { total: number; active: number; pending: number };
  assetCounts: { FINANCIAL_ASSET: number; PHYSICAL_ASSET: number; DIGITAL_ASSET: number };
  unassignedAssets: { name: string; estimatedValue: number | null; currency: string }[];
  partiallyAllocatedAssets: string[];
  digitalAssets: { name: string; category: string; hasRecoveryInfo: boolean }[];
  documentCount: number;
  dms: {
    status: string;
    inactivityPeriodDays: number;
    checkInFrequencyDays: number;
    contactCount: number;
    scope: { documents: number; assets: number; videos: number; planSections: number };
  } | null;
  emergency: { contactCount: number; pendingRequests: number };
  security: { mfaEnabled: boolean; sessionCount: number };
}

function list(items: string[], max = 4): string {
  const shown = items.slice(0, max);
  return (
    shown.map((item) => `• ${item}`).join("\n") +
    (items.length > max ? `\n• …and ${items.length - max} more` : "")
  );
}

export function generateAssistantReply(message: string, context: AssistantContext): AssistantReply {
  const q = message.toLowerCase();

  if (/digital asset|online account|domain|wallet|subscription|password|credential/.test(q)) {
    const digital = context.digitalAssets;
    const missingRecovery = digital.filter((asset) => !asset.hasRecoveryInfo);
    return {
      content:
        `You have ${digital.length} digital asset${digital.length === 1 ? "" : "s"} recorded${
          digital.length
            ? `:\n${list(digital.map((a) => `${a.name} (${a.category.replace(/_/g, " ").toLowerCase()})`))}`
            : "."
        }\n\n` +
        `A tidy digital inventory usually covers: email and cloud accounts, domains and hosting, financial apps, crypto wallets, subscriptions that renew, and social profiles with a wish (memorialize, delete, hand over).\n\n` +
        (missingRecovery.length
          ? `${missingRecovery.length} of them have no recovery information stored yet (${missingRecovery.map((a) => a.name).join(", ")}). Adding it — encrypted, revealed only after re-verification — is the single most useful next step.`
          : `All of them have recovery information stored. Consider assigning each one to a beneficiary so the hand-over is clear.`),
      flags: ["Based only on what is recorded in your account"],
      suggestions: ["Which digital assets have no beneficiary?", "How are credentials protected?"],
    };
  }

  if (/beneficiar|assignment|allocation|inherit|share/.test(q)) {
    const { active, pending } = context.beneficiaries;
    const unassigned = context.unassignedAssets;
    const partial = context.partiallyAllocatedAssets;
    return {
      content:
        `You have ${active} beneficiar${active === 1 ? "y" : "ies"} (${pending} still pending their invitation).\n\n` +
        (unassigned.length
          ? `${unassigned.length} asset${unassigned.length === 1 ? " has" : "s have"} no beneficiary yet:\n${list(
              unassigned.map(
                (a) => `${a.name} · ${formatCompactCurrency(a.estimatedValue, a.currency)}`,
              ),
            )}\n\n`
          : `Every asset has at least one beneficiary. `) +
        (partial.length
          ? `${partial.length} asset${partial.length === 1 ? " is" : "s are"} partially allocated (under 100%): ${partial.join(", ")}. Allocation is per resource, so the remaining share is simply unallocated until you assign it.`
          : `Allocations that exist add up cleanly — nothing exceeds 100% per resource.`),
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
    const unassigned = context.unassignedAssets.length;
    const totalAssets =
      context.assetCounts.FINANCIAL_ASSET +
      context.assetCounts.PHYSICAL_ASSET +
      context.assetCounts.DIGITAL_ASSET;
    return {
      content:
        `I can help you prepare a draft, but nothing produced here becomes part of your plan until you review and explicitly confirm it.\n\n` +
        `A first draft normally works from what you already recorded: ${
          context.personalDetailsComplete ? "personal details ✓" : "personal details (missing)"
        }, ${context.beneficiaries.total} beneficiaries, ${totalAssets} assets and your special wishes${
          context.specialWishesComplete ? " ✓" : " (not written yet)"
        }.\n\n` +
        `Suggested order: complete Personal Details and Special Wishes in the wizard, assign the ${unassigned} unassigned asset${unassigned === 1 ? "" : "s"}, then generate a draft from the finalized plan.`,
      flags: [
        "Drafts are informational, not legal advice",
        "The AI will generator is not connected yet",
      ],
      suggestions: ["What information should I add to my legacy plan?", "Open the will wizard"],
    };
  }

  if (/legacy plan|plan|what information|add to my|missing|incomplete|finaliz/.test(q)) {
    const incomplete = context.incompleteSectionTitles;
    return {
      content:
        `Your legacy plan is ${context.planPercent}% complete. ${
          incomplete.length
            ? `Sections still open:\n${list(incomplete, 9)}`
            : "Every section is complete."
        }\n\n` +
        `Personal Details is the only section required to finalize; the others can be acknowledged as incomplete and completed in a later version.\n\n` +
        `Beyond the wizard, families usually thank you for: where important documents physically are, who to call first, recurring payments to cancel, and wishes for digital accounts.`,
      flags: incomplete.length ? [] : ["Consider a professional review before relying on the plan"],
      suggestions: incomplete.length
        ? [`Take me to ${incomplete[0]}`, "Help me prepare a legacy plan draft"]
        : ["Help me review my beneficiary assignments"],
    };
  }

  if (/dead man|switch|check.?in|inactiv/.test(q)) {
    if (!context.dms) {
      return {
        content:
          "You have not configured a Dead Man's Switch yet. It confirms you are active on a schedule, and only after a full escalation releases the resources you choose to the contacts you nominate.",
        flags: [],
        suggestions: ["Open the Dead Man's Switch", "Help me review my beneficiary assignments"],
      };
    }
    const dms = context.dms;
    return {
      content:
        `Your Dead Man's Switch is ${dms.status.replace(/_/g, " ").toLowerCase()} with a ${dms.inactivityPeriodDays}-day inactivity threshold and check-ins every ${dms.checkInFrequencyDays} days. ${dms.contactCount} trusted contact${dms.contactCount === 1 ? "" : "s"} would be notified during escalation.\n\n` +
        `The release scope currently covers ${dms.scope.documents} documents, ${dms.scope.assets} assets, ${dms.scope.videos} videos and ${dms.scope.planSections} plan sections — nothing outside it is ever released.`,
      flags: [],
      suggestions: [
        "What happens if I miss a check-in?",
        "Help me review my beneficiary assignments",
      ],
    };
  }

  if (/emergency/.test(q)) {
    const { contactCount, pendingRequests } = context.emergency;
    return {
      content:
        `You have ${contactCount} emergency contact${contactCount === 1 ? "" : "s"}${
          pendingRequests
            ? ` and ${pendingRequests} request${pendingRequests === 1 ? "" : "s"} waiting for your decision`
            : ""
        }.\n\n` +
        `Emergency access requires the contact to verify a one-time code, then your approval (or your timeout rule). Access is scoped, time-limited and revocable.`,
      flags: [],
      suggestions: ["Open emergency access", "Help me review my beneficiary assignments"],
    };
  }

  if (/secur|2fa|two.factor|mfa|encrypt|safe/.test(q)) {
    const { mfaEnabled, sessionCount } = context.security;
    return {
      content:
        `Security snapshot: two-factor authentication ${mfaEnabled ? "enabled" : "not enabled"}, ${sessionCount} active session${sessionCount === 1 ? "" : "s"}.\n\n` +
        `Sensitive fields (account numbers, credentials, recovery info) are encrypted with AES-256-GCM and only decrypted after you re-verify. Documents live in private storage behind short-lived signed links.` +
        (mfaEnabled
          ? ""
          : `\n\nEnabling two-factor authentication is the highest-impact improvement available right now.`),
      flags: [],
      suggestions: ["Open the Security Center", "How are credentials protected?"],
    };
  }

  if (/hello|hi|hey|thanks|thank you/.test(q)) {
    return {
      content: `Happy to help. Your legacy readiness is ${context.readinessScore}/100. Ask me about your plan, beneficiaries, assets, documents, the Dead Man's Switch or security — I answer from what is in your account.`,
      flags: [],
      suggestions: SUGGESTED_PROMPTS.slice(0, 3),
    };
  }

  return {
    content:
      `I can only answer from what is recorded in your account, so here is the most useful overview I can give.\n\n` +
      `Legacy readiness: ${context.readinessScore}/100. Biggest gaps:\n${list(
        context.readinessGaps.slice(0, 3).map((gap) => `${gap.label} — ${gap.hint}`),
      )}\n\n` +
      `Assets by class: ${(["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"] as const)
        .map((kind) => `${context.assetCounts[kind]} ${ASSET_KIND_META[kind].label.toLowerCase()}`)
        .join(", ")}. Documents in the vault: ${context.documentCount}.`,
    flags: ["I could not match your question to a specific area — try one of the suggestions"],
    suggestions: SUGGESTED_PROMPTS.slice(0, 3),
  };
}
