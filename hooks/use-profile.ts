"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";

/** The application profile that mirrors Clerk plus the app-owned fields. */
export interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  mfaEnabled: boolean;
  role: "USER" | "SUPER_ADMIN";
  dateOfBirth: string | null;
  phone: string | null;
  alternateEmail: string | null;
  address: Record<string, unknown> | null;
  familyInfo: Record<string, unknown> | null;
  preferences: Record<string, unknown>;
  notificationPreferences: Record<string, unknown>;
  securityPreferences: Record<string, unknown>;
  hasIdentificationDetails: boolean;
  onboardingCompletedAt: string | null;
  lastLoginAt: string | null;
  deletionRequestedAt: string | null;
  createdAt: string;
}

export function useProfile(): UseQueryResult<UserProfile> {
  return useQuery({
    queryKey: queryKeys.users.me(),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<UserProfile>("/users/me", { signal });
      return data;
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      values: Partial<Pick<UserProfile, "phone" | "alternateEmail" | "dateOfBirth">>,
    ) => {
      const { data } = await apiClient.patch<UserProfile>("/users/me", values);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.me() });
    },
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      preferences?: Record<string, unknown>;
      notificationPreferences?: Record<string, unknown>;
      securityPreferences?: Record<string, unknown>;
    }) => {
      const { data } = await apiClient.patch<UserProfile>("/users/me/preferences", values);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.me() });
    },
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<UserProfile>("/users/me/onboarding/complete", {});
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.me() });
    },
  });
}

export interface DeletionState {
  deletionRequestedAt: string | null;
  deletesAt: string | null;
}

/**
 * Account-level actions (api-contracts.md § Users).
 *
 * The export is a bare async function, not a query: it returns every decrypted
 * sensitive field the account holds, and that must not sit in a cache. The
 * caller hands the payload straight to a download and lets it go.
 */
export function useExportMyData(): () => Promise<unknown> {
  return useCallback(async () => {
    const { data } = await apiClient.get<unknown>("/users/me/export");
    return data;
  }, []);
}

export function useRequestAccountDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.delete<DeletionState>("/users/me", { confirmed: true });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.me() });
    },
  });
}

export function useCancelAccountDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<DeletionState>("/users/me/cancel-deletion", {});
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.me() });
    },
  });
}
