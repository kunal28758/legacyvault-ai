import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError, ReverificationRequiredError } from "@/lib/api/client";

/**
 * TanStack Query configuration (task T014).
 *
 * - user data is never stale-served for long (`staleTime` 30 s) and never persisted
 *   to shared caches (constitution XV — the HTTP layer already sends `no-store`)
 * - 4xx responses are never retried; network / 5xx errors retry at most twice
 * - reverification-required errors are left for the re-auth gate (T201) to handle
 */
export const QUERY_STALE_TIME_MS = 30_000;
export const QUERY_GC_TIME_MS = 5 * 60_000;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ReverificationRequiredError) return false;
  if (error instanceof ApiError && error.isClientError) return false;
  return failureCount < 2;
}

export type QueryErrorHandler = (error: unknown) => void;

export function makeQueryClient(onError?: QueryErrorHandler): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => onError?.(error),
    }),
    mutationCache: new MutationCache({
      onError: (error) => onError?.(error),
    }),
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
