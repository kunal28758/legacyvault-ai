"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  LegacyPlan,
  LegacyPlanOverview,
  PlanReview,
  PlanSectionKey,
  PlanVersionSummary,
  SavePlanStepResult,
} from "@/lib/types/legacy-plan";

/**
 * Legacy-plan data hooks (tasks T057–T070 client half).
 *
 * The wizard holds `lockVersion` and sends it with every save; the server
 * answers with the next one. That is the whole concurrency story on the client —
 * there is no local copy of the plan that could drift, because each save
 * returns the authoritative version to carry into the next one.
 */
export function useLegacyPlanOverview(): UseQueryResult<LegacyPlanOverview> {
  return useQuery({
    queryKey: queryKeys.legacyPlan.overview(),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<LegacyPlanOverview>("/legacy-plans", { signal });
      return data;
    },
  });
}

/**
 * Opens the wizard's draft, creating one on first use.
 *
 * `POST` because it may create; `useQuery` with a mutating fetcher would be
 * wrong, so the wizard calls this once through `useMutation` on mount.
 */
export function useOpenDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<LegacyPlan>("/legacy-plans/current");
      return data;
    },
    onSuccess: (plan) => {
      queryClient.setQueryData(queryKeys.legacyPlan.detail(plan.id), plan);
    },
  });
}

export function useLegacyPlan(id: string | null): UseQueryResult<LegacyPlan> {
  return useQuery({
    queryKey: queryKeys.legacyPlan.detail(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<LegacyPlan>(`/legacy-plans/${id}`, { signal });
      return data;
    },
  });
}

export function usePlanReview(id: string | null): UseQueryResult<PlanReview> {
  return useQuery({
    queryKey: queryKeys.legacyPlan.review(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await apiClient.post<PlanReview>(`/legacy-plans/${id}/review`);
      return data;
    },
  });
}

export function usePlanVersions(
  id: string | null,
  options: { enabled?: boolean } = {},
): UseQueryResult<{ items: PlanVersionSummary[] }> {
  return useQuery({
    queryKey: queryKeys.legacyPlan.versions(id ?? "none"),
    enabled: Boolean(id) && (options.enabled ?? true),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<{ items: PlanVersionSummary[] }>(
        `/legacy-plans/${id}/versions`,
        { signal },
      );
      return data;
    },
  });
}

export function useSavePlanStep(planId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      step,
      data,
      lockVersion,
    }: {
      step: PlanSectionKey;
      data: Record<string, unknown>;
      lockVersion: number;
    }) => {
      const result = await apiClient.patch<SavePlanStepResult>(
        `/legacy-plans/${planId}/steps/${step}`,
        { data, lockVersion },
      );
      return result.data;
    },
    onSuccess: () => {
      // The saved section changes completeness, so the review is stale. The
      // plan itself is not refetched on every keystroke — the wizard already
      // holds the authoritative lockVersion returned above.
      if (planId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.legacyPlan.review(planId) });
      }
    },
  });
}

export function useFinalizePlan(planId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lockVersion,
      acknowledgeIncomplete,
    }: {
      lockVersion: number;
      acknowledgeIncomplete: boolean;
    }) => {
      const { data } = await apiClient.post<{
        planId: string;
        versionId: string;
        plan: LegacyPlan;
      }>(`/legacy-plans/${planId}/finalize`, {
        confirmed: true,
        lockVersion,
        acknowledgeIncomplete,
      });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.legacyPlan.all() });
    },
  });
}

export function useCreateNewDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fromPlanId: string) => {
      const { data } = await apiClient.post<LegacyPlan>(`/legacy-plans/${fromPlanId}/new-draft`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.legacyPlan.all() });
    },
  });
}
