"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  DocumentDetail,
  DocumentListResult,
  DocumentShare,
  DocumentSummary,
  FolderSummary,
  SignedAccess,
  UploadOutcome,
  UploadTicket,
} from "@/lib/types/document";

/**
 * Document and folder hooks (FR-H001–H010).
 *
 * Signed URLs are fetched on demand and never cached: each one is short-lived
 * and single-purpose, so holding one in a query cache would only create a
 * window where a stale link is handed out.
 */
export interface DocumentFilters {
  folderId?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export function useDocuments(
  filters: DocumentFilters = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<DocumentListResult> {
  const query = {
    ...(filters.folderId ? { folderId: filters.folderId } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.page ? { page: filters.page } : {}),
    ...(filters.limit ? { limit: filters.limit } : {}),
  };

  return useQuery({
    queryKey: queryKeys.documents.list(query),
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<DocumentListResult>("/documents", { query, signal });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

export function useDocument(id: string | null): UseQueryResult<DocumentDetail> {
  return useQuery({
    queryKey: queryKeys.documents.detail(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<DocumentDetail>(`/documents/${id}`, { signal });
      return data;
    },
  });
}

export function useFolders(): UseQueryResult<{ items: FolderSummary[] }> {
  return useQuery({
    queryKey: queryKeys.documents.folders(),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<{ items: FolderSummary[] }>("/documents/folders", {
        signal,
      });
      return data;
    },
  });
}

function useInvalidateDocuments() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all() }),
      // Attachments feed the plan's document section.
      queryClient.invalidateQueries({ queryKey: queryKeys.legacyPlan.all() }),
    ]);
  };
}

export function useRenameDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: async ({
      id,
      name,
      folderId,
    }: {
      id: string;
      name?: string;
      folderId?: string | null;
    }) => {
      const { data } = await apiClient.patch<DocumentSummary>(`/documents/${id}`, {
        ...(name !== undefined ? { name } : {}),
        ...(folderId !== undefined ? { folderId } : {}),
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete<{ id: string }>(`/documents/${id}`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useShareDocument() {
  const invalidate = useInvalidateDocuments();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, beneficiaryId }: { id: string; beneficiaryId: string }) => {
      const { data } = await apiClient.post<DocumentShare[]>(`/documents/${id}/share`, {
        beneficiaryId,
        confirmed: true,
      });
      return data;
    },
    onSuccess: async () => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: queryKeys.beneficiaries.all() });
    },
  });
}

export function useUnshareDocument() {
  const invalidate = useInvalidateDocuments();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, beneficiaryId }: { id: string; beneficiaryId: string }) => {
      const { data } = await apiClient.delete<DocumentShare[]>(
        `/documents/${id}/share/${beneficiaryId}`,
      );
      return data;
    },
    onSuccess: async () => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: queryKeys.beneficiaries.all() });
    },
  });
}

export function useCreateFolder() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: async ({ name, parentId }: { name: string; parentId?: string | null }) => {
      const { data } = await apiClient.post<FolderSummary>("/documents/folders", {
        name,
        parentId: parentId ?? null,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteFolder() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete<{ id: string }>(`/documents/folders/${id}`, {
        confirmed: true,
      });
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Fetches a signed link and hands it straight to the caller.
 *
 * Not a query: the link expires in minutes, so caching one would only make it
 * possible to hand out a dead URL.
 */
export function useDocumentAccess() {
  return useCallback(
    async (id: string, mode: "download" | "preview" = "download"): Promise<SignedAccess> => {
      const { data } = await apiClient.get<SignedAccess>(`/documents/${id}/${mode}`);
      return data;
    },
    [],
  );
}

/* ── Upload ───────────────────────────────────────────────────────────────── */

export interface UploadRequest {
  kind: "DOCUMENT" | "DOCUMENT_VERSION" | "VIDEO";
  file: File;
  folderId?: string | null;
  documentId?: string;
  title?: string;
  description?: string | null;
  deliveryCondition?: "IMMEDIATE" | "DEAD_MAN_SWITCH" | "EMERGENCY_ACCESS";
  onProgress?: (percent: number) => void;
}

/** PUTs the bytes to the signed URL, reporting real progress. */
function putToSignedUrl(url: string, file: File, onProgress?: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error("The file could not be uploaded. Please try again."));
    };
    request.onerror = () => reject(new Error("The upload was interrupted. Please try again."));
    request.send(file);
  });
}

/**
 * The full two-step upload: session, bytes, completion.
 *
 * The browser never learns the permanent storage path — it PUTs to a signed
 * quarantine URL and the server decides where the object ends up once it has
 * been measured and scanned.
 */
export function useUpload() {
  const invalidate = useInvalidateDocuments();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: UploadRequest): Promise<UploadOutcome> => {
      const { data: ticket } = await apiClient.post<UploadTicket>("/documents/uploads", {
        kind: request.kind,
        name: request.file.name,
        mimeType: request.file.type || "application/octet-stream",
        sizeBytes: request.file.size,
        ...(request.folderId !== undefined ? { folderId: request.folderId } : {}),
        ...(request.documentId ? { documentId: request.documentId } : {}),
      });

      await putToSignedUrl(ticket.uploadUrl, request.file, request.onProgress);

      const { data: outcome } = await apiClient.post<UploadOutcome>(
        `/documents/uploads/${ticket.uploadId}/complete`,
        {
          ...(request.title ? { title: request.title } : {}),
          ...(request.description !== undefined ? { description: request.description } : {}),
          ...(request.deliveryCondition ? { deliveryCondition: request.deliveryCondition } : {}),
        },
      );
      return outcome;
    },
    onSuccess: async () => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: queryKeys.videos.all() });
    },
  });
}
