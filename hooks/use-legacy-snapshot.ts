"use client";

import { useMemo } from "react";

import { useAssets } from "@/hooks/use-assets";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { useDeadManSwitch } from "@/hooks/use-dead-man-switch";
import { useDocuments } from "@/hooks/use-documents";
import { useEmergencyAccess } from "@/hooks/use-emergency-access";
import { useLegacyPlanOverview } from "@/hooks/use-legacy-plan";
import { useNow } from "@/hooks/use-now";
import { useProfile } from "@/hooks/use-profile";
import { deriveActions, openActions, type LegacyAction } from "@/lib/client/action-centre";
import { buildLegacySnapshot, type LegacySnapshot } from "@/lib/client/legacy-snapshot";
import { readiness, type ReadinessBreakdown } from "@/lib/client/readiness";

export interface LegacyState {
  snapshot: LegacySnapshot;
  actions: LegacyAction[];
  open: LegacyAction[];
  readiness: ReadinessBreakdown;
}

/**
 * The owner's legacy state, derived from the queries the app already makes.
 * TanStack Query dedupes by key, so every consumer (dashboard, Action Centre,
 * palette, Copilot) shares one set of requests. `state` stays null until the
 * profile and plan — the inputs every rule depends on — have loaded, so
 * nothing is ever computed from missing data.
 */
export function useLegacyState(options: { enabled?: boolean } = {}): {
  state: LegacyState | null;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const enabled = options.enabled ?? true;
  const now = useNow(60_000);
  const profile = useProfile();
  const plan = useLegacyPlanOverview();
  const beneficiaries = useBeneficiaries({}, { enabled });
  const financial = useAssets("FINANCIAL_ASSET", {}, { enabled });
  const physical = useAssets("PHYSICAL_ASSET", {}, { enabled });
  const digital = useAssets("DIGITAL_ASSET", {}, { enabled });
  const documents = useDocuments({ limit: 100 }, { enabled });
  const dms = useDeadManSwitch();
  const emergency = useEmergencyAccess();

  const queries = [
    profile,
    plan,
    beneficiaries,
    financial,
    physical,
    digital,
    documents,
    dms,
    emergency,
  ];
  // Every rule reads every source, so nothing is derived until all have loaded:
  // a still-loading list must never read as "you have none".
  const loaded = queries.every((query) => query.isSuccess);

  const state = useMemo<LegacyState | null>(() => {
    if (!enabled || !loaded || !profile.data || !plan.data) return null;
    const snapshot = buildLegacySnapshot({
      now,
      profile: {
        mfaEnabled: profile.data.mfaEnabled,
        emailVerified: profile.data.emailVerified,
        alternateEmail: profile.data.alternateEmail,
        preferences: profile.data.preferences ?? {},
      },
      planOverview: plan.data,
      beneficiaries: beneficiaries.data?.items ?? [],
      assets: [
        ...(financial.data?.items ?? []),
        ...(physical.data?.items ?? []),
        ...(digital.data?.items ?? []),
      ],
      documents: documents.data?.items ?? [],
      documentTotal: documents.data?.total ?? 0,
      dms: dms.data ?? null,
      emergency: emergency.data ?? null,
    });
    const actions = deriveActions(snapshot);
    return { snapshot, actions, open: openActions(actions), readiness: readiness(snapshot) };
  }, [
    enabled,
    loaded,
    now,
    profile.data,
    plan.data,
    beneficiaries.data,
    financial.data,
    physical.data,
    digital.data,
    documents.data,
    dms.data,
    emergency.data,
  ]);

  return {
    state,
    isPending: enabled && !loaded && !queries.some((query) => query.isError),
    isError: queries.some((query) => query.isError && !query.data),
    refetch: () => queries.forEach((query) => void query.refetch()),
  };
}
