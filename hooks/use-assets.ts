"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import {
  ASSET_SLUG_BY_KIND,
  type Asset,
  type AssetAssignmentsResult,
  type AssetKind,
  type AssetListResult,
  type AssetWithAssignments,
  type RevealedSensitiveFields,
} from "@/lib/types/asset";
import type { AssetProfile } from "@/lib/types/asset-profile";

/**
 * Asset data hooks (tasks T079–T090 client half).
 *
 * Everything goes through `/api/v1/assets/:type`. Sensitive values are never
 * part of a query: `revealSensitiveFields` is a mutation on purpose, so the
 * plaintext is returned once to the caller and never enters the React Query
 * cache, where a devtools panel or a later refetch could surface it.
 */
export interface AssetFilters {
  category?: string;
  q?: string;
  page?: number;
  limit?: number;
}

function slug(kind: AssetKind) {
  return ASSET_SLUG_BY_KIND[kind];
}

export function useAssets(
  kind: AssetKind,
  filters: AssetFilters = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<AssetListResult> {
  const query = {
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.page ? { page: filters.page } : {}),
    ...(filters.limit ? { limit: filters.limit } : {}),
  };

  return useQuery({
    queryKey: queryKeys.assets.list(kind, query),
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<AssetListResult>(`/assets/${slug(kind)}`, {
        query,
        signal,
      });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

export function useAsset(kind: AssetKind, id: string | null): UseQueryResult<AssetWithAssignments> {
  return useQuery({
    queryKey: queryKeys.assets.detail(kind, id ?? "none"),
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<AssetWithAssignments>(`/assets/${slug(kind)}/${id}`, {
        signal,
      });
      return data;
    },
  });
}

/** Values the form sends. Sensitive keys are write-only and never read back. */
export interface AssetFormValues {
  name?: string;
  category?: string;
  estimatedValue?: number | null;
  currency?: string;
  notes?: string | null;
  institution?: string | null;
  description?: string | null;
  location?: string | null;
  ownershipDetails?: string | null;
  platform?: string | null;
  username?: string | null;
  accountNumber?: string | null;
  policyNumber?: string | null;
  credentials?: string | null;
  recoveryInfo?: string | null;
  /** Legacy facts (status, dates, nominee, instructions) → metadata.profile. */
  profile?: AssetProfile;
}

function useInvalidateAssets() {
  const queryClient = useQueryClient();
  return async () => {
    // A change to an asset moves the plan's completeness and its review, so the
    // plan subtree is invalidated with it.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.assets.all() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.legacyPlan.all() }),
    ]);
  };
}

export function useCreateAsset(kind: AssetKind) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: async (values: AssetFormValues) => {
      const { data } = await apiClient.post<Asset>(`/assets/${slug(kind)}`, values);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateAsset(kind: AssetKind) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: AssetFormValues }) => {
      const { data } = await apiClient.patch<Asset>(`/assets/${slug(kind)}/${id}`, values);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteAsset(kind: AssetKind) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete<{ id: string }>(`/assets/${slug(kind)}/${id}`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useAssignBeneficiary(kind: AssetKind) {
  const invalidate = useInvalidateAssets();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      beneficiaryId,
      allocationPercentage,
    }: {
      id: string;
      beneficiaryId: string;
      allocationPercentage: number | null;
    }) => {
      const { data } = await apiClient.post<AssetAssignmentsResult>(
        `/assets/${slug(kind)}/${id}/assign`,
        { beneficiaryId, allocationPercentage, confirmed: true },
      );
      return data;
    },
    onSuccess: async () => {
      await invalidate();
      // Assignment counts appear on the beneficiary side too.
      await queryClient.invalidateQueries({ queryKey: queryKeys.beneficiaries.all() });
    },
  });
}

export function useUnassignBeneficiary(kind: AssetKind) {
  const invalidate = useInvalidateAssets();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, assignmentId }: { id: string; assignmentId: string }) => {
      const { data } = await apiClient.delete<AssetAssignmentsResult>(
        `/assets/${slug(kind)}/${id}/assign/${assignmentId}`,
      );
      return data;
    },
    onSuccess: async () => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: queryKeys.beneficiaries.all() });
    },
  });
}

/**
 * Fetches the decrypted fields for one asset.
 *
 * Deliberately a bare async function rather than a query *or* a mutation: both
 * retain their last result in a TanStack cache for as long as the component is
 * mounted, which would leave decrypted account numbers and credentials sitting
 * in a store that devtools can read. Here the plaintext exists only in the
 * caller's local variable, for as long as it needs it.
 */
export function useRevealSensitiveFields(kind: AssetKind) {
  return useCallback(
    async (id: string): Promise<RevealedSensitiveFields> => {
      const { data } = await apiClient.get<RevealedSensitiveFields>(
        `/assets/${slug(kind)}/${id}/decrypt`,
      );
      return data;
    },
    [kind],
  );
}
