import type { DeadManSwitch } from "@/lib/types/dms";

/**
 * The Security Centre's control list.
 *
 * Every check reads real state: whether Clerk reports MFA, whether a switch is
 * armed, whether anyone is nominated, whether the plan has been finalized.
 * Nothing here is advisory fiction — if a control cannot be evaluated the check
 * says so rather than guessing.
 */
export interface SecurityCheck {
  id: string;
  title: string;
  status: "good" | "attention" | "risk";
  detail: string;
  href?: string;
  action?: string;
}

export interface SecurityInputs {
  mfaEnabled: boolean;
  emailVerified: boolean;
  alternateEmail: string | null;
  beneficiaryCount: number;
  activeBeneficiaryCount: number;
  planFinalized: boolean;
  deadManSwitch: DeadManSwitch | null;
  emergencyContactCount: number;
  encryptedFieldCount: number;
}

export function securityChecks(input: SecurityInputs): SecurityCheck[] {
  const dmsStatus = input.deadManSwitch?.status ?? "INACTIVE";
  const dmsArmed = dmsStatus !== "INACTIVE" && dmsStatus !== "PAUSED";
  const dmsPending = ["ESCALATING", "RELEASING", "RELEASED"].includes(dmsStatus);

  return [
    {
      id: "mfa",
      title: "Two-factor authentication",
      status: input.mfaEnabled ? "good" : "risk",
      detail: input.mfaEnabled
        ? "A second factor is required to sign in and to re-verify sensitive actions."
        : "Without a second factor, a stolen password is enough to reach your vault.",
      href: "/settings?tab=security",
      action: input.mfaEnabled ? undefined : "Turn on 2FA",
    },
    {
      id: "email",
      title: "Verified email",
      status: input.emailVerified ? "good" : "attention",
      detail: input.emailVerified
        ? "Security alerts and recovery reach a verified address."
        : "Verify your email so security alerts can reach you.",
      href: "/settings",
    },
    {
      id: "recovery",
      title: "Alternate contact",
      status: input.alternateEmail ? "good" : "attention",
      detail: input.alternateEmail
        ? "A second address is on file for recovery contact."
        : "Add an alternate email so you are reachable if the primary one fails.",
      href: "/settings",
      action: input.alternateEmail ? undefined : "Add alternate email",
    },
    {
      id: "beneficiaries",
      title: "Beneficiaries",
      status: input.activeBeneficiaryCount > 0 ? "good" : "attention",
      detail:
        input.activeBeneficiaryCount > 0
          ? `${input.activeBeneficiaryCount} of ${input.beneficiaryCount} can receive access.`
          : "Nobody is set up to receive anything yet.",
      href: "/beneficiaries",
      action: input.activeBeneficiaryCount > 0 ? undefined : "Add a beneficiary",
    },
    {
      id: "plan",
      title: "Legacy plan",
      status: input.planFinalized ? "good" : "attention",
      detail: input.planFinalized
        ? "A finalized version is preserved and cannot be altered."
        : "Your plan is still a draft. Finalizing preserves an immutable version.",
      href: "/legacy-plan",
      action: input.planFinalized ? undefined : "Review and finalize",
    },
    {
      id: "dms",
      title: "Dead Man’s Switch",
      status: dmsPending
        ? "attention"
        : dmsArmed
          ? "good"
          : dmsStatus === "PAUSED"
            ? "attention"
            : "risk",
      detail:
        dmsStatus === "RELEASED"
          ? "Release completed — review who has access, or recover to revoke every link."
          : input.deadManSwitch?.releaseHold
            ? "Release on hold: no warning email to you has been confirmed delivered, so nothing is released. Checking in stops it."
            : dmsPending
              ? "A release is pending because no check-in was recorded. Checking in stops it."
              : dmsArmed
                ? `Monitoring with ${input.deadManSwitch?.contacts.length ?? 0} trusted contact${
                    (input.deadManSwitch?.contacts.length ?? 0) === 1 ? "" : "s"
                  }.`
                : dmsStatus === "PAUSED"
                  ? "Paused — no deadline is running while it stays paused."
                  : "Nothing will be released if your check-ins stop.",
      href: "/dead-man-switch",
      action:
        dmsStatus === "RELEASED"
          ? "Review release"
          : dmsPending
            ? "Check in"
            : dmsArmed
              ? undefined
              : "Configure the switch",
    },
    {
      id: "emergency",
      title: "Emergency access",
      status: input.emergencyContactCount > 0 ? "good" : "attention",
      detail:
        input.emergencyContactCount > 0
          ? `${input.emergencyContactCount} designated contact${input.emergencyContactCount === 1 ? "" : "s"} can request verified access.`
          : "No one can request access in an emergency.",
      href: "/emergency-access",
      action: input.emergencyContactCount > 0 ? undefined : "Designate a contact",
    },
    {
      id: "encryption",
      title: "Encrypted fields",
      status: "good",
      detail:
        input.encryptedFieldCount > 0
          ? `${input.encryptedFieldCount} sensitive value${input.encryptedFieldCount === 1 ? "" : "s"} stored encrypted and revealed only after re-verification.`
          : "Account numbers and credentials are encrypted before storage whenever you add them.",
      href: "/assets",
    },
  ];
}

/** A simple weighted score: risks cost more than gaps. */
export function securityScore(checks: SecurityCheck[]): number {
  if (checks.length === 0) return 0;
  const points = checks.reduce(
    (total, check) =>
      total + (check.status === "good" ? 1 : check.status === "attention" ? 0.5 : 0),
    0,
  );
  return Math.round((points / checks.length) * 100);
}
