"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { AccessTokenSummary } from "@/lib/types/access";
import type { AccessScopeInput } from "@/lib/validators/dms.validators";

/**
 * Access link hooks (ADR-014).
 *
 * The plaintext link comes back from the mutation and is handed to the caller
 * to show once. It is deliberately not written into any cache: the server
 * cannot produce it again, and a cached copy would be a long-lived secret in
 * the browser.
 */
export interface IssuedLinkResult {
  token: AccessTokenSummary;
  link: string;
  emailSent: boolean;
}

export function useAccessTokens(beneficiaryId: string | null): UseQueryResult<{
  items: AccessTokenSummary[];
}> {
  return useQuery({
    queryKey: queryKeys.accessTokens.forBeneficiary(beneficiaryId ?? "none"),
    enabled: Boolean(beneficiaryId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<{ items: AccessTokenSummary[] }>(
        `/beneficiaries/${beneficiaryId}/tokens`,
        { signal },
      );
      return data;
    },
  });
}

function useInvalidateTokens() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.accessTokens.all() });
}

export function useIssueAccessToken() {
  const invalidate = useInvalidateTokens();
  return useMutation({
    mutationFn: async ({
      beneficiaryId,
      scope,
      ttlDays,
    }: {
      beneficiaryId: string;
      scope: AccessScopeInput;
      ttlDays: number;
    }) => {
      const { data } = await apiClient.post<IssuedLinkResult>(
        `/beneficiaries/${beneficiaryId}/tokens`,
        { scope, ttlDays, confirmed: true },
      );
      return data;
    },
    onSuccess: invalidate,
    gcTime: 0,
  });
}

/**
 * Resends a link: the current one is revoked as RESENT and exactly one
 * replacement is minted. The endpoint requires step-up verification, so the
 * caller wraps this in the re-auth gate.
 */
export function useResendAccessToken() {
  const invalidate = useInvalidateTokens();
  return useMutation({
    mutationFn: async ({
      beneficiaryId,
      tokenId,
      ttlDays,
    }: {
      beneficiaryId: string;
      tokenId: string;
      ttlDays: number;
    }) => {
      const { data } = await apiClient.post<IssuedLinkResult>(
        `/beneficiaries/${beneficiaryId}/tokens/${tokenId}/resend`,
        { ttlDays, confirmed: true },
      );
      return data;
    },
    onSuccess: invalidate,
    gcTime: 0,
  });
}

export function useRevokeAccessToken() {
  const invalidate = useInvalidateTokens();
  return useMutation({
    mutationFn: async ({ beneficiaryId, tokenId }: { beneficiaryId: string; tokenId: string }) => {
      const { data } = await apiClient.delete<{ items: AccessTokenSummary[] }>(
        `/beneficiaries/${beneficiaryId}/tokens/${tokenId}`,
      );
      return data;
    },
    onSuccess: invalidate,
  });
}
