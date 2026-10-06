"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/client/api-client";
import type { ActivityListResult } from "@/lib/types/activity";

/** The caller's own audit rows, newest first (Security Center, dashboard, Activity Log). */
export function useActivity(limit = 25, page = 1): UseQueryResult<ActivityListResult> {
  return useQuery({
    queryKey: ["activity", page === 1 ? { limit } : { limit, page }],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<ActivityListResult>("/users/me/activity", {
        query: page === 1 ? { limit } : { limit, page },
        signal,
      });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}
