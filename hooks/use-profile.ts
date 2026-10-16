"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient, type DownloadedFile } from "@/lib/client/api-client";
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

/**
 * Forces the server to re-read the authoritative Clerk fields (MFA, email
 * verification, name) into the mirror, then updates the cached profile. Used
 * after the user changes a security factor in Clerk's own UI so every surface
 * that reads the mirror — the dashboard, the Security Center — agrees with
 * Clerk's live state without waiting for the webhook.
 */
export function useRefreshProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<UserProfile>("/users/me/refresh", {});
      return data;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.users.me(), profile);
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

export type ExportFormat = "xlsx" | "csv" | "json";

/**
 * Account-level actions (api-contracts.md § Users).
 *
 * The export is a bare async function, not a query: it returns every decrypted
 * sensitive field the account holds, and that must not sit in a cache. The
 * caller hands the file straight to a download and lets it go.
 */
export function useExportMyData(): (format: ExportFormat) => Promise<DownloadedFile> {
  return useCallback(async (format: ExportFormat) => {
    if (format !== "json") {
      const { data } = await apiClient.download("/users/me/export", { query: { format } });
      return data;
    }
    const { data } = await apiClient.get<unknown>("/users/me/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    return { blob, filename: null };
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

export interface ImmediateDeletionResult {
  status: "DELETED" | "CLEANUP_PENDING";
}

/** Permanent deletion with no grace period; the phrase is checked again server-side. */
export function useDeleteAccountNow() {
  return useMutation({
    mutationFn: async (confirmation: string) => {
      const { data } = await apiClient.post<ImmediateDeletionResult>("/users/me/delete-now", {
        confirmation,
      });
      return data;
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
