import type { DmsStatus } from "@/lib/types/dms";
import type { EaRequestStatus } from "@/lib/types/emergency-access";

/**
 * How the emergency release workflow is described to the owner.
 *
 * Presentation only — every state is decided by the database. The wording
 * never treats inactivity as proof of anything: a switch reports that no
 * recent check-in was recorded, and what it will do next.
 */
export const DMS_STAGES: { status: DmsStatus; label: string; description: string }[] = [
  { status: "ACTIVE", label: "Active", description: "On schedule" },
  { status: "REMINDER_SENT", label: "Warning", description: "Check-in due — reminder sent" },
  { status: "GRACE_PERIOD", label: "Grace period", description: "Final window to check in" },
  {
    status: "ESCALATING",
    label: "Release pending",
    description: "Contacts told; you can still stop it",
  },
  { status: "RELEASING", label: "Authorized", description: "Release links being prepared" },
  {
    status: "RELEASED",
    label: "Released",
    description: "Contacts verify by code, then access",
  },
];

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function dmsView(status: DmsStatus): {
  label: string;
  tone: Tone;
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
      return { label: "Release pending", tone: "danger", stageIndex: 3 };
    case "RELEASING":
      return { label: "Release authorized", tone: "danger", stageIndex: 4 };
    case "RELEASED":
      return { label: "Released", tone: "danger", stageIndex: 5 };
  }
}

/** One plain sentence for the current state — the text, not the colour, carries it. */
export function dmsExplanation(status: DmsStatus): string {
  switch (status) {
    case "INACTIVE":
      return "Disabled — nothing is monitored and nothing can be released.";
    case "PAUSED":
      return "Paused — no deadline is running and nothing can be released. Resume to restart the schedule.";
    case "ACTIVE":
      return "On schedule. Check in before the next deadline to keep it that way.";
    case "REMINDER_SENT":
      return "No recent check-in was recorded. Check in to return to Active — nothing has been shared.";
    case "GRACE_PERIOD":
      return "The grace period is running. Check in now; nothing has been shared and your contacts have not been told.";
    case "ESCALATING":
      return "Your trusted contacts were told the workflow started. Nothing has been released — checking in stops it.";
    case "RELEASING":
      return "Release is authorized and links are being prepared. Checking in now still cancels it.";
    case "RELEASED":
      return "Released: your contacts were sent expiring links and must confirm a code before anything opens. Recovering revokes every link.";
  }
}

/** States in which a verified check-in is accepted (it cancels a pending release). */
export const CHECK_IN_STATES: DmsStatus[] = [
  "ACTIVE",
  "REMINDER_SENT",
  "GRACE_PERIOD",
  "ESCALATING",
  "RELEASING",
];

/**
 * Escalation steps between "contacts told" and release. Mirrors the scan's
 * reading of `escalation_rules.steps`; anything out of range is the default.
 */
export function escalationStepCount(rules: unknown): number {
  const record =
    rules && typeof rules === "object" && !Array.isArray(rules)
      ? (rules as Record<string, unknown>)
      : {};
  const steps = Number(record.steps);
  return Number.isFinite(steps) && steps >= 1 && steps <= 10 ? Math.floor(steps) : 2;
}

export interface ScheduleInput {
  status: DmsStatus;
  lastCheckInAt: string | null;
  nextCheckInAt: string | null;
  checkInFrequencyDays: number;
  inactivityPeriodDays: number;
  escalationDelayHours: number;
  escalationSteps: number;
  currentEscalationStep: number;
}

export interface ScheduleStep {
  id: "due" | "grace" | "notify" | "release";
  label: string;
  detail: string;
  /** Earliest time; the hourly scan applies it within about an hour. Null once it no longer applies. */
  at: string | null;
  reached: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * "What happens if you miss check-ins": the earliest date of each remaining
 * stage, from the same rules the scheduled scan applies.
 *
 *   due     last check-in + check-in interval
 *   grace   last check-in + inactivity threshold
 *   notify  grace + one delay (contacts are told)
 *   release notify + steps × delay (then contacts must verify by code)
 *
 * Pure, so the page and the tests agree. A disabled or paused switch has no
 * schedule.
 */
export function projectSchedule(input: ScheduleInput, now: number): ScheduleStep[] {
  if (input.status === "INACTIVE" || input.status === "PAUSED") return [];
  const order: DmsStatus[] = [
    "ACTIVE",
    "REMINDER_SENT",
    "GRACE_PERIOD",
    "ESCALATING",
    "RELEASING",
    "RELEASED",
  ];
  const stage = order.indexOf(input.status);
  const delay = input.escalationDelayHours * HOUR;
  const anchor = input.lastCheckInAt ? Date.parse(input.lastCheckInAt) : now;

  let due = anchor + input.checkInFrequencyDays * DAY;
  let grace = anchor + input.inactivityPeriodDays * DAY;
  let notify = grace + delay;
  let release = notify + input.escalationSteps * delay;
  // Once escalating, the scan's own next deadline is the better anchor.
  if (input.status === "ESCALATING" && input.nextCheckInAt) {
    const next = Date.parse(input.nextCheckInAt);
    const remaining = Math.max(0, input.escalationSteps - input.currentEscalationStep);
    release = next + remaining * delay;
  }
  if (input.status === "RELEASING") release = Math.max(now, release);
  if (input.status === "ACTIVE" && input.nextCheckInAt) due = Date.parse(input.nextCheckInAt);
  if (stage >= 3) {
    // Past stages keep no projected date.
    due = grace = notify = Number.NaN;
  }

  const iso = (value: number) => (Number.isFinite(value) ? new Date(value).toISOString() : null);
  return [
    {
      id: "due",
      label: "Check-in due",
      detail: "You are reminded by email and in the app.",
      at: iso(due),
      reached: stage >= 1,
    },
    {
      id: "grace",
      label: "Grace period starts",
      detail: "A final warning. Nothing is shared and contacts are not told yet.",
      at: iso(grace),
      reached: stage >= 2,
    },
    {
      id: "notify",
      label: "Trusted contacts told",
      detail: "They learn the workflow started — no link, nothing from your vault.",
      at: iso(notify),
      reached: stage >= 3,
    },
    {
      id: "release",
      label: "Earliest release",
      detail:
        "Only if you have been warned by email. Contacts must confirm a code before anything opens.",
      at: stage >= 5 ? null : iso(release),
      reached: stage >= 5,
    },
  ];
}

export function eaRequestView(status: EaRequestStatus): { label: string; tone: Tone } {
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
