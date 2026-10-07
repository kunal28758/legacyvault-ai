"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import type { DeadManSwitch } from "@/lib/types/dms";
import type { AccessScopeInput } from "@/lib/validators/dms.validators";

/**
 * Dead Man's Switch hooks (FR-I001–I012).
 *
 * Every action is a server transition; the client only asks and then re-reads.
 * There is no optimistic update anywhere here on purpose — a switch that looks
 * checked-in when it is not would be the most dangerous bug in the product.
 */
export function useDeadManSwitch(): UseQueryResult<DeadManSwitch | null> {
  return useQuery({
    queryKey: queryKeys.deadManSwitch.detail(),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<DeadManSwitch | null>("/dead-man-switch", { signal });
      return data;
    },
  });
}

function useInvalidateDms() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.deadManSwitch.all() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() }),
      // Disabling or recovering revokes release links.
      queryClient.invalidateQueries({ queryKey: queryKeys.accessTokens.all() }),
    ]);
  };
}

export interface DmsConfigureInput {
  inactivityPeriodDays: number;
  checkInFrequencyDays: number;
  escalationDelayHours: number;
  contactBeneficiaryIds: string[];
  releaseScope: AccessScopeInput;
  escalationRules?: { steps?: number };
}

export function useConfigureDms() {
  const invalidate = useInvalidateDms();
  return useMutation({
    mutationFn: async (input: DmsConfigureInput) => {
      const { data } = await apiClient.post<DeadManSwitch>("/dead-man-switch", input);
      return data;
    },
    onSuccess: invalidate,
  });
}

function useDmsAction(path: string) {
  const invalidate = useInvalidateDms();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<DeadManSwitch | null>(`/dead-man-switch/${path}`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export const useCheckIn = () => useDmsAction("check-in");
export const usePauseDms = () => useDmsAction("pause");
export const useResumeDms = () => useDmsAction("resume");
export const useDisableDms = () => useDmsAction("disable");
export const useCancelEscalation = () => useDmsAction("cancel-escalation");
