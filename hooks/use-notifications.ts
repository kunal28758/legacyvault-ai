"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import type { NotificationListResult } from "@/lib/types/notification";

/** Notification hooks (FR-L001–L006). */
export function useNotifications(
  filters: { unreadOnly?: boolean; page?: number; limit?: number } = {},
): UseQueryResult<NotificationListResult> {
  const query = {
    ...(filters.unreadOnly ? { unreadOnly: "true" } : {}),
    ...(filters.page ? { page: filters.page } : {}),
    ...(filters.limit ? { limit: filters.limit } : {}),
  };

  return useQuery({
    queryKey: queryKeys.notifications.list(query),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<NotificationListResult>("/notifications", {
        query,
        signal,
      });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

export function useUnreadCount(): UseQueryResult<{ count: number }> {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<{ count: number }>("/notifications/unread-count", {
        signal,
      });
      return data;
    },
  });
}

/** An empty id list marks everything unread as read. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] = []) => {
      const { data } = await apiClient.post<{ updated: number; unreadCount: number }>(
        "/notifications/read",
        { ids },
      );
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
    },
  });
}
