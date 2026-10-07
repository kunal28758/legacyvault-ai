"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/client/api-client";
import type { ActivityListResult } from "@/lib/types/activity";

/**
 * The caller's own audit rows, newest first (Security Center, dashboard, Activity Log).
 * `resourceId` narrows to one record's history (asset detail).
 */
export function useActivity(
  limit = 25,
  page = 1,
  resourceId?: string,
): UseQueryResult<ActivityListResult> {
  const query = {
    limit,
    ...(page === 1 ? {} : { page }),
    ...(resourceId ? { resourceId } : {}),
  };
  return useQuery({
    queryKey: ["activity", query],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<ActivityListResult>("/users/me/activity", {
        query,
        signal,
      });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}
