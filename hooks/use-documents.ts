"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { ApiError, apiClient } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import { declaredMimeType } from "@/lib/uploads/file-types";
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

/**
 * Where an upload is, as the browser tracks it. The server's session status
 * is the authority; these stages are how the browser narrates reaching it.
 */
export type UploadPhase = "validating" | "uploading" | "scanning" | "storing";

export interface UploadRequest {
  kind: "DOCUMENT" | "DOCUMENT_VERSION" | "VIDEO";
  file: File;
  folderId?: string | null;
  documentId?: string;
  title?: string;
  description?: string | null;
  deliveryCondition?: "IMMEDIATE" | "DEAD_MAN_SWITCH" | "EMERGENCY_ACCESS";
  onProgress?: (percent: number) => void;
  onPhase?: (phase: UploadPhase, uploadId?: string) => void;
  /** Aborting cancels the transfer; a completion already running on the server finishes there. */
  signal?: AbortSignal;
}

export interface UploadCompletion {
  title?: string;
  description?: string | null;
  deliveryCondition?: UploadRequest["deliveryCondition"];
}

/** Thrown when the user cancels; callers treat it as a choice, not a failure. */
export class UploadCancelledError extends Error {
  constructor() {
    super("The upload was cancelled.");
    this.name = "UploadCancelledError";
  }
}

/** PUTs the bytes to the signed URL, reporting real progress. */
function putToSignedUrl(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new UploadCancelledError());
    const request = new XMLHttpRequest();
    const onAbort = () => request.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => signal?.removeEventListener("abort", onAbort);

    request.open("PUT", url);
    request.setRequestHeader("content-type", contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      done();
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error("The file could not be uploaded. Please try again."));
    };
    request.onerror = () => {
      done();
      reject(new Error("The upload was interrupted. Check your connection and try again."));
    };
    request.onabort = () => {
      done();
      reject(new UploadCancelledError());
    };
    request.send(file);
  });
}

const STATUS_POLL_INTERVAL_MS = 3_000;
/** The server bounds a scan well inside its 300 s request limit. */
const STATUS_POLL_LIMIT_MS = 330_000;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new UploadCancelledError());
      },
      { once: true },
    );
  });
}

/**
 * Finishes an upload server-side: validation, malware scan, promotion.
 *
 * If the completion request itself is lost (a dropped connection, a proxy
 * timeout) or another request is already scanning the file, the session status
 * is polled until it settles — with a hard ceiling, so the browser can never
 * show "Scanning…" indefinitely. Callers use this directly to retry.
 */
export async function completeUploadRequest(
  uploadId: string,
  completion: UploadCompletion = {},
  signal?: AbortSignal,
): Promise<UploadOutcome> {
  let outcome: UploadOutcome;
  try {
    const { data } = await apiClient.post<UploadOutcome>(
      `/documents/uploads/${uploadId}/complete`,
      {
        ...(completion.title ? { title: completion.title } : {}),
        ...(completion.description !== undefined ? { description: completion.description } : {}),
        ...(completion.deliveryCondition
          ? { deliveryCondition: completion.deliveryCondition }
          : {}),
      },
      { signal },
    );
    outcome = data;
  } catch (error) {
    if (signal?.aborted) throw new UploadCancelledError();
    // A validation or authorization answer is final; only a lost response or
    // a server error is worth checking on.
    if (error instanceof ApiError && error.isClientError) throw error;
    outcome = await readUploadStatus(uploadId, signal);
  }

  const deadline = Date.now() + STATUS_POLL_LIMIT_MS;
  while (outcome.inProgress) {
    if (Date.now() > deadline) {
      return {
        ...outcome,
        inProgress: false,
        retryable: true,
        rejectionReason: "The security scan is taking longer than expected. Try again.",
      };
    }
    await wait(STATUS_POLL_INTERVAL_MS, signal);
    outcome = await readUploadStatus(uploadId, signal);
  }
  return outcome;
}

async function readUploadStatus(uploadId: string, signal?: AbortSignal): Promise<UploadOutcome> {
  const { data } = await apiClient.get<UploadOutcome>(`/documents/uploads/${uploadId}`, {
    signal,
  });
  return data;
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
      const uploadKind = request.kind === "VIDEO" ? "VIDEO" : "DOCUMENT";
      const mimeType = declaredMimeType(uploadKind, request.file);

      request.onPhase?.("validating");
      const { data: ticket } = await apiClient.post<UploadTicket>(
        "/documents/uploads",
        {
          kind: request.kind,
          name: request.file.name,
          mimeType,
          sizeBytes: request.file.size,
          ...(request.folderId !== undefined ? { folderId: request.folderId } : {}),
          ...(request.documentId ? { documentId: request.documentId } : {}),
        },
        { signal: request.signal },
      );

      request.onPhase?.("uploading", ticket.uploadId);
      await putToSignedUrl(
        ticket.uploadUrl,
        request.file,
        mimeType,
        request.onProgress,
        request.signal,
      );

      request.onPhase?.("scanning", ticket.uploadId);
      return await completeUploadRequest(
        ticket.uploadId,
        {
          title: request.title,
          description: request.description,
          deliveryCondition: request.deliveryCondition,
        },
        request.signal,
      );
    },
    onSuccess: async (outcome) => {
      if (outcome.status !== "PROMOTED") return;
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: queryKeys.videos.all() });
    },
  });
}

/** Re-runs the server-side half of an upload whose scan could not complete. */
export function useRetryUpload() {
  const invalidate = useInvalidateDocuments();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      uploadId,
      completion,
      signal,
    }: {
      uploadId: string;
      completion?: UploadCompletion;
      signal?: AbortSignal;
    }) => completeUploadRequest(uploadId, completion, signal),
    onSuccess: async (outcome) => {
      if (outcome.status !== "PROMOTED") return;
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: queryKeys.videos.all() });
    },
  });
}
