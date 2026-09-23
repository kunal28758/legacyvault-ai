"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  Beneficiary,
  BeneficiaryDetail,
  BeneficiaryListResult,
  BeneficiaryWithRoles,
} from "@/lib/types/beneficiary";

/**
 * Beneficiary data hooks (tasks T075/T076 client half).
 *
 * Every read and write goes through the versioned REST API — the browser never
 * touches Supabase directly, so authorization, validation and auditing happen
 * server-side exactly once. Mutations invalidate the whole `beneficiaries`
 * subtree because a single change can move counts, roles and assignments at the
 * same time.
 */
export interface BeneficiaryFilters {
  status?: "PENDING" | "ACTIVE" | "INACTIVE";
  q?: string;
  page?: number;
  limit?: number;
}

export function useBeneficiaries(
  filters: BeneficiaryFilters = {},
): UseQueryResult<BeneficiaryListResult> {
  const query = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.page ? { page: filters.page } : {}),
    ...(filters.limit ? { limit: filters.limit } : {}),
  };

  return useQuery({
    queryKey: queryKeys.beneficiaries.list(query),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<BeneficiaryListResult>("/beneficiaries", {
        query,
        signal,
      });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

export function useBeneficiary(id: string | null): UseQueryResult<BeneficiaryDetail> {
  return useQuery({
    queryKey: queryKeys.beneficiaries.detail(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<BeneficiaryDetail>(`/beneficiaries/${id}`, { signal });
      return data;
    },
  });
}

export interface BeneficiaryFormValues {
  name: string;
  relationship: string;
  email: string;
  phone: string | null;
  notes: string | null;
}

function useInvalidateBeneficiaries() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.beneficiaries.all() });
}

export function useCreateBeneficiary() {
  const invalidate = useInvalidateBeneficiaries();
  return useMutation({
    mutationFn: async (values: BeneficiaryFormValues) => {
      const { data } = await apiClient.post<BeneficiaryWithRoles>("/beneficiaries", values);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateBeneficiary() {
  const invalidate = useInvalidateBeneficiaries();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<BeneficiaryFormValues> }) => {
      // FR-D008: name and email are authoritative fields, so the server demands
      // an explicit confirmation before it will change either.
      const confirmed = values.name !== undefined || values.email !== undefined;
      const { data } = await apiClient.patch<Beneficiary>(`/beneficiaries/${id}`, {
        ...values,
        ...(confirmed ? { confirmed: true } : {}),
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useSetBeneficiaryStatus() {
  const invalidate = useInvalidateBeneficiaries();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "ACTIVE" | "INACTIVE" }) => {
      const { data } = await apiClient.post<Beneficiary>(`/beneficiaries/${id}/status`, {
        status,
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useRemoveBeneficiary() {
  const invalidate = useInvalidateBeneficiaries();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete<{ id: string }>(`/beneficiaries/${id}`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useInviteBeneficiary() {
  const invalidate = useInvalidateBeneficiaries();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<{ beneficiary: Beneficiary; emailSent: boolean }>(
        `/beneficiaries/${id}/invite`,
      );
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUnassignBeneficiary() {
  const invalidate = useInvalidateBeneficiaries();
  return useMutation({
    mutationFn: async ({ id, assignmentId }: { id: string; assignmentId: string }) => {
      const { data } = await apiClient.delete<{ id: string }>(
        `/beneficiaries/${id}/assignments/${assignmentId}`,
      );
      return data;
    },
    onSuccess: invalidate,
  });
}
