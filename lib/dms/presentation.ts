import type { DmsStatus } from "@/lib/types/dms";
import type { EaRequestStatus } from "@/lib/types/emergency-access";

/**
 * How the protection states are described to the owner.
 *
 * Lifted out of the demo layer unchanged so the real Dead Man's Switch and
 * Emergency Access pages can use the same wording. These are presentation
 * concerns only — every state itself is decided by the database.
 */
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
      return { label: "Escalating", tone: "danger", stageIndex: 3 };
    case "RELEASING":
      return { label: "Release ready", tone: "danger", stageIndex: 4 };
    case "RELEASED":
      return { label: "Released", tone: "danger", stageIndex: 5 };
  }
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
