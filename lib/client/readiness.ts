import { dmsView } from "@/lib/client/dms-presentation";
import type { DeadManSwitch } from "@/lib/types/dms";

/**
 * The legacy-readiness score shown on the dashboard.
 *
 * The weights are unchanged from the original model; what changed is the
 * input — every number now comes from the database rather than from browser
 * state, so the score reflects what a beneficiary would actually receive.
 */
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

export interface ReadinessInputs {
  planFinalized: boolean;
  planVersion: number | null;
  planPercent: number;
  activeBeneficiaries: number;
  assetCount: number;
  assignedAssetCount: number;
  documentCount: number;
  deadManSwitch: DeadManSwitch | null;
  emergencyContactCount: number;
  mfaEnabled: boolean;
}

export function readiness(input: ReadinessInputs): ReadinessBreakdown {
  const coverage = input.assetCount ? input.assignedAssetCount / input.assetCount : 0;
  const dmsStatus = input.deadManSwitch?.status ?? "INACTIVE";

  const items: ReadinessBreakdown["items"] = [
    {
      id: "plan",
      label: input.planFinalized ? "Legacy plan finalized" : "Legacy plan",
      weight: 35,
      earned: input.planFinalized ? 35 : Math.round((input.planPercent / 100) * 30),
      hint: input.planFinalized
        ? `v${input.planVersion ?? 1} finalized`
        : `${input.planPercent}% of sections complete`,
      href: "/legacy-plan",
    },
    {
      id: "beneficiaries",
      label: "Beneficiaries",
      weight: 15,
      earned: Math.min(15, input.activeBeneficiaries * 5),
      hint: `${input.activeBeneficiaries} active or pending`,
      href: "/beneficiaries",
    },
    {
      id: "assets",
      label: "Assets assigned",
      weight: 15,
      earned: Math.round(coverage * 15),
      hint: `${input.assignedAssetCount} of ${input.assetCount} assets have a beneficiary`,
      href: "/assets",
    },
    {
      id: "documents",
      label: "Documents in the vault",
      weight: 10,
      earned: Math.min(10, input.documentCount * 2.5),
      hint: `${input.documentCount} documents`,
      href: "/documents",
    },
    {
      id: "dms",
      label: "Dead Man’s Switch",
      weight: 10,
      earned: dmsStatus === "INACTIVE" ? 0 : dmsStatus === "PAUSED" ? 5 : 10,
      hint: dmsView(dmsStatus).label,
      href: "/dead-man-switch",
    },
    {
      id: "ea",
      label: "Emergency access",
      weight: 5,
      earned: input.emergencyContactCount ? 5 : 0,
      hint: input.emergencyContactCount ? "Contact configured" : "Not configured",
      href: "/emergency-access",
    },
    {
      id: "security",
      label: "Account security",
      weight: 10,
      earned: input.mfaEnabled ? 10 : 4,
      hint: input.mfaEnabled ? "2FA enabled" : "2FA not enabled",
      href: "/security-center",
    },
  ];

  return {
    score: Math.min(100, Math.round(items.reduce((total, item) => total + item.earned, 0))),
    items,
  };
}
