"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import type { SignedAccess } from "@/lib/types/document";
import type { DeliveryCondition, VideoListResult, VideoMessage } from "@/lib/types/video";

/** Video legacy hooks (FR-K001–K006). */
export function useVideos(
  filters: { deliveryCondition?: DeliveryCondition; q?: string } = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<VideoListResult> {
  const query = {
    ...(filters.deliveryCondition ? { deliveryCondition: filters.deliveryCondition } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  };

  return useQuery({
    queryKey: queryKeys.videos.list(query),
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<VideoListResult>("/videos", { query, signal });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

function useInvalidateVideos() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.videos.all() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.beneficiaries.all() }),
    ]);
  };
}

export function useUpdateVideo() {
  const invalidate = useInvalidateVideos();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string;
      values: {
        title?: string;
        description?: string | null;
        deliveryCondition?: DeliveryCondition;
      };
    }) => {
      const { data } = await apiClient.patch<VideoMessage>(`/videos/${id}`, values);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteVideo() {
  const invalidate = useInvalidateVideos();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete<{ id: string }>(`/videos/${id}`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useAssignVideo() {
  const invalidate = useInvalidateVideos();
  return useMutation({
    mutationFn: async ({ id, beneficiaryId }: { id: string; beneficiaryId: string }) => {
      const { data } = await apiClient.post<VideoMessage>(`/videos/${id}/assign`, {
        beneficiaryId,
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUnassignVideo() {
  const invalidate = useInvalidateVideos();
  return useMutation({
    mutationFn: async ({ id, assignmentId }: { id: string; assignmentId: string }) => {
      const { data } = await apiClient.delete<VideoMessage>(`/videos/${id}/assign/${assignmentId}`);
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Signed playback link; fetched on demand and never cached. */
export function useVideoAccess() {
  return useCallback(async (id: string): Promise<SignedAccess> => {
    const { data } = await apiClient.get<SignedAccess>(`/videos/${id}/access`);
    return data;
  }, []);
}
