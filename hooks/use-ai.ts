"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { API_BASE_PATH, ApiError, apiClient } from "@/lib/client/api-client";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  AIAvailability,
  AIInteractionSummary,
  ChatStreamEvent,
  DocumentAnalysisList,
  DocumentAnalysisRecord,
  DocumentComparisonResult,
} from "@/lib/types/ai";
import { API_ERROR_CODES, type ApiEnvelope } from "@/lib/types/api";
import type { DocumentAnalyzeBody } from "@/lib/validators/ai.validators";

/**
 * AI hooks (ADR-008, ADR-016).
 *
 * Chat turns live only in the calling component's state; nothing here caches
 * or persists a question or an answer. Stored document analyses are the
 * server's encrypted records, fetched like any other resource.
 */
export function useAIAvailability(): UseQueryResult<AIAvailability> {
  return useQuery({
    queryKey: queryKeys.ai.availability(),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<AIAvailability>("/ai/status", { signal });
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useAIInteractions(limit = 10): UseQueryResult<{ items: AIInteractionSummary[] }> {
  return useQuery({
    queryKey: [...queryKeys.ai.interactions(), limit],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<{ items: AIInteractionSummary[] }>(
        "/ai/assistant/interactions",
        { query: { limit }, signal },
      );
      return data;
    },
  });
}

export function useDocumentAnalyses(
  documentId: string | null,
): UseQueryResult<DocumentAnalysisList> {
  return useQuery({
    queryKey: queryKeys.ai.analyses(documentId ?? "none"),
    enabled: Boolean(documentId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<DocumentAnalysisList>(
        `/ai/documents/${documentId}/analyses`,
        { signal },
      );
      return data;
    },
  });
}

export function useAnalyzeDocument(documentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: DocumentAnalyzeBody & { signal?: AbortSignal }) => {
      const { signal, ...payload } = body;
      const { data } = await apiClient.post<DocumentAnalysisRecord>(
        `/ai/documents/${documentId}/analyses`,
        payload,
        { signal },
      );
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.analyses(documentId ?? "none") }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.interactions() }),
      ]);
    },
  });
}

export function useCompareDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      documentIds,
      signal,
    }: {
      documentIds: [string, string];
      signal?: AbortSignal;
    }) => {
      const { data } = await apiClient.post<DocumentComparisonResult>(
        "/ai/documents/compare",
        { documentIds },
        { signal },
      );
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.ai.interactions() }),
  });
}

/**
 * POSTs to a streaming AI endpoint and reports each NDJSON event as it
 * arrives. Resolves with the final `done` event; rejects with an `ApiError`
 * for a refusal before streaming (validation, rate limit, AI unavailable) or
 * for an `error` event mid-answer. An abort rejects with an `AbortError`.
 */
export async function streamAI(
  path: string,
  body: unknown,
  options: { signal?: AbortSignal; onDelta: (text: string) => void },
): Promise<Extract<ChatStreamEvent, { type: "done" }>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}${path}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson, application/json",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, {
      code: API_ERROR_CODES.NETWORK_ERROR,
      message: "The request could not be sent. Check your connection and try again.",
    });
  }

  const correlationId = response.headers.get("X-Correlation-ID") ?? undefined;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/x-ndjson")) {
    // Refused before streaming began: the standard JSON error envelope.
    const envelope = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
    if (envelope && envelope.success === false) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw new ApiError(response.status, envelope.error, {
        correlationId,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      });
    }
    throw new ApiError(response.status, {
      code: API_ERROR_CODES.INVALID_RESPONSE,
      message: `The AI request failed (${response.status}).`,
    });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiError(response.status, {
      code: API_ERROR_CODES.INVALID_RESPONSE,
      message: "The AI answer could not be read.",
    });
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string): Extract<ChatStreamEvent, { type: "done" }> | null => {
    if (!line.trim()) return null;
    let event: ChatStreamEvent;
    try {
      event = JSON.parse(line) as ChatStreamEvent;
    } catch {
      return null;
    }
    if (event.type === "delta") options.onDelta(event.text);
    else if (event.type === "error") {
      throw new ApiError(503, { code: event.code, message: event.message }, { correlationId });
    } else if (event.type === "done") return event;
    return null;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const finished = handle(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (finished) return finished;
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  const finished = handle(buffer);
  if (finished) return finished;
  throw new ApiError(502, {
    code: API_ERROR_CODES.INVALID_RESPONSE,
    message: "The answer ended unexpectedly. Try again.",
  });
}
