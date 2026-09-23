"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ActivityListResult } from "@/lib/types/activity";

/** The caller's own audit rows, for the Security Center. */
export function useActivity(limit = 25): UseQueryResult<ActivityListResult> {
  return useQuery({
    queryKey: ["activity", { limit }],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<ActivityListResult>("/users/me/activity", {
        query: { limit },
        signal,
      });
      return data;
    },
  });
}
