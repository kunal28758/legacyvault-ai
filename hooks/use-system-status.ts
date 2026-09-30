"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import type { SystemStatus } from "@/lib/types/system-status";

/**
 * Live system status. The server probes every dependency for real and caches
 * the answer for 30 s, so polling once a minute (and on focus) keeps the
 * indicator honest without hammering anything.
 */
export function useSystemStatus(options: { enabled?: boolean } = {}): UseQueryResult<SystemStatus> {
  return useQuery({
    queryKey: queryKeys.system.status(),
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<SystemStatus>("/system-status", { signal });
      return data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
