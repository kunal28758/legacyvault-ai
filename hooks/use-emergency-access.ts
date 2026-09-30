"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import type { EmergencyAccessOverview, EmergencyContact } from "@/lib/types/emergency-access";
import type { AccessScopeInput } from "@/lib/validators/dms.validators";

/** Emergency access hooks (FR-J001–J010). */
export function useEmergencyAccess(): UseQueryResult<EmergencyAccessOverview> {
  return useQuery({
    queryKey: queryKeys.emergencyAccess.contacts(),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<EmergencyAccessOverview>("/emergency-access/contacts", {
        signal,
      });
      return data;
    },
  });
}

function useInvalidateEmergencyAccess() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.emergencyAccess.all() });
}

export interface EmergencyContactInput {
  beneficiaryId: string;
  accessScope: AccessScopeInput;
  onTimeout: "WAIT" | "AUTO_GRANT" | "DENY";
  timeoutHours?: number | null;
  requestExpiryHours?: number;
  accessDurationHours?: number;
}

export function useConfigureEmergencyContact() {
  const invalidate = useInvalidateEmergencyAccess();
  return useMutation({
    mutationFn: async (input: EmergencyContactInput) => {
      const { data } = await apiClient.post<EmergencyContact>("/emergency-access/contacts", input);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useRemoveEmergencyContact() {
  const invalidate = useInvalidateEmergencyAccess();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete<{ id: string }>(`/emergency-access/contacts/${id}`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDecideEmergencyRequest() {
  const invalidate = useInvalidateEmergencyAccess();
  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "APPROVE" | "DENY" }) => {
      const { data } = await apiClient.post<EmergencyAccessOverview>(
        `/emergency-access/requests/${id}/decide`,
        { decision, confirmed: true },
      );
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useRevokeEmergencyRequest() {
  const invalidate = useInvalidateEmergencyAccess();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<EmergencyAccessOverview>(
        `/emergency-access/requests/${id}/revoke`,
        { confirmed: true },
      );
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Re-sends the designation email (no secret in it) and, for a granted request,
 * queues another delivery run — which mints a replacement link, never a second
 * live one (ADR-014 § 6).
 */
export function useResendDesignation() {
  const invalidate = useInvalidateEmergencyAccess();
  return useMutation({
    mutationFn: async (configId: string) => {
      const { data } = await apiClient.post<{ sentAt: string }>(
        `/emergency-access/contacts/${configId}/resend`,
        {},
      );
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useResendEmergencyAccess() {
  const invalidate = useInvalidateEmergencyAccess();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data } = await apiClient.post<{ queued: boolean }>(
        `/emergency-access/requests/${requestId}/resend-access`,
        {},
      );
      return data;
    },
    onSuccess: invalidate,
  });
}
