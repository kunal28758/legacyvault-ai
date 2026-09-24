"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ActivityListResult } from "@/lib/types/activity";
import type {
  AdminAnalytics,
  AdminOperations,
  AdminUserDetail,
  AdminUserListResult,
  UserRole,
} from "@/lib/types/admin";

/**
 * Operator console data (FR-P001–P012).
 *
 * These endpoints are Super Admin only and every one of them is audited on the
 * server, so nothing here is cached longer than a page view: an operator should
 * see the platform as it is now, not as it was when they opened the tab.
 */
const STALE_MS = 15_000;

export function useAdminUsers(query: {
  q?: string;
  page?: number;
}): UseQueryResult<AdminUserListResult> {
  const params = {
    ...(query.q ? { q: query.q } : {}),
    ...(query.page ? { page: query.page } : {}),
  };
  return useQuery({
    queryKey: ["admin", "users", params],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<AdminUserListResult>("/admin/users", {
        query: params,
        signal,
      });
      return data;
    },
    staleTime: STALE_MS,
    placeholderData: (previous) => previous,
  });
}

export function useAdminUser(id: string | null): UseQueryResult<AdminUserDetail> {
  return useQuery({
    queryKey: ["admin", "user", id ?? "none"],
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<AdminUserDetail>(`/admin/users/${id}`, { signal });
      return data;
    },
  });
}

export function useAdminAnalytics(days = 30): UseQueryResult<AdminAnalytics> {
  return useQuery({
    queryKey: ["admin", "analytics", days],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<AdminAnalytics>("/admin/analytics", {
        query: { days },
        signal,
      });
      return data;
    },
    staleTime: STALE_MS,
  });
}

export function useAdminOperations(): UseQueryResult<AdminOperations> {
  return useQuery({
    queryKey: ["admin", "operations"],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<AdminOperations>("/admin/operations", { signal });
      return data;
    },
    staleTime: STALE_MS,
  });
}

export function useAdminAudit(query: {
  action?: string;
  outcome?: string;
  actorId?: string;
}): UseQueryResult<ActivityListResult> {
  const params = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
  };
  return useQuery({
    queryKey: ["admin", "audit", params],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<ActivityListResult>("/admin/audit-logs", {
        query: params,
        signal,
      });
      return data;
    },
    staleTime: STALE_MS,
    placeholderData: (previous) => previous,
  });
}

function useInvalidateAdmin() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["admin"] });
}

export function useSetUserRole() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserRole }) => {
      const { data } = await apiClient.patch<AdminUserDetail>(`/admin/users/${id}/role`, {
        role,
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUnlockUser() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<{ unlocked: true }>(`/admin/users/${id}/unlock`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useResetUserMfa() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<{ reset: true }>(`/admin/users/${id}/reset-mfa`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useResendSystemAccessToken() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (tokenId: string) => {
      const { data } = await apiClient.post<{ queued: boolean }>(
        `/admin/access-tokens/${tokenId}/resend`,
        { confirmed: true },
      );
      return data;
    },
    onSuccess: invalidate,
  });
}
