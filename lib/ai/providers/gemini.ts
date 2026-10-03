import "server-only";

import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type HttpRetryOptions,
} from "@google/genai";
import { z } from "zod";

import {
  AIProviderError,
  type AICapabilities,
  type AIErrorKind,
  type AIMessage,
  type AIProvider,
  type AIRequest,
  type AIStream,
  type AIUpstreamFailure,
  type AIUsage,
} from "@/lib/ai/provider";

/**
 * Google Gemini through `@google/genai` (ADR-008).
 *
 * Gemini reads images and PDFs natively from inline data, including scanned
 * pages, which makes it a complete OCR path on its own (ADR-008 § 5).
 */
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * Transient vendor failures are retried before anything reaches the caller.
 *
 * Gemini answers bursts of 503 UNAVAILABLE ("This model is currently
 * experiencing high demand") that clear within seconds. With a single attempt,
 * every one of them became a failed answer in the product. The SDK retries on
 * the HTTP response, so a stream is only ever retried before its first token;
 * the overall budget is still `REQUEST_TIMEOUT_MS`, because the request's abort
 * signal also ends the retries. Worst case ≈ 1–2 s + 2–4 s + 4–8 s of backoff.
 *
 * 429 RESOURCE_EXHAUSTED is deliberately not retried: it means a quota (per
 * minute or per day) is spent, which seconds of backoff cannot outlast — it
 * would only delay the honest "busy" answer and spend more of the quota.
 */
export const GEMINI_RETRY: HttpRetryOptions = {
  attempts: 4,
  initialDelay: 1,
  maxDelay: 8,
  expBase: 2,
  jitter: 1,
  httpStatusCodes: [408, 500, 502, 503, 504],
};

function toContents(messages: AIMessage[]): Content[] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts:
      typeof message.content === "string"
        ? [{ text: message.content }]
        : message.content.map((part) =>
            part.kind === "text"
              ? { text: part.text }
              : {
                  inlineData: {
                    mimeType: part.mimeType,
                    data: Buffer.from(part.data).toString("base64"),
                  },
                },
          ),
  }));
}

function usageOf(
  usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined,
): AIUsage {
  return {
    inputTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage?.candidatesTokenCount ?? null,
  };
}

/** One string field of the vendor's JSON error body, which the SDK embeds (escaped) in its message. */
function errorField(error: ApiError, field: string, value: RegExp): string | null {
  const pattern = new RegExp(`\\\\*"${field}\\\\*"\\s*:\\s*\\\\*"(${value.source})\\\\*"`);
  return error.message.match(pattern)?.[1] ?? null;
}

/**
 * What the vendor's error says in machine-readable form: its status enum
 * (`UNAVAILABLE`, `RESOURCE_EXHAUSTED`…), the quota it reports as spent, and
 * the delay it asks for. Only identifiers and numbers are taken — the rest of
 * the message is free text that can echo the request, so it is never kept.
 */
export function upstreamOf(error: ApiError): AIUpstreamFailure {
  const delay = errorField(error, "retryDelay", /\d{1,6}(?:\.\d+)?s/);
  const limit = errorField(error, "quotaValue", /\d{1,12}/);
  return {
    status: error.status,
    reason: errorField(error, "status", /[A-Z][A-Z_]{2,40}/),
    quota: errorField(error, "quotaId", /[A-Za-z0-9-]{1,120}/),
    quotaLimit: limit ? Number(limit) : null,
    retryAfterSeconds: delay ? Math.ceil(Number.parseFloat(delay)) : null,
  };
}

const HTTP_FAILURES: Record<number, { kind: AIErrorKind; message: string }> = {
  400: { kind: "REFUSED", message: "The AI provider refused the request." },
  401: { kind: "NOT_CONFIGURED", message: "The AI provider rejected the credentials." },
  403: { kind: "NOT_CONFIGURED", message: "The AI provider rejected the credentials." },
  404: { kind: "NOT_CONFIGURED", message: "The configured AI model was not found." },
  408: { kind: "TIMEOUT", message: "The AI provider timed out." },
  429: { kind: "RATE_LIMITED", message: "The AI provider is rate limiting." },
  504: { kind: "TIMEOUT", message: "The AI provider timed out." },
};

export function mapError(cause: unknown, signal?: AbortSignal): AIProviderError {
  if (cause instanceof AIProviderError) return cause;
  if (signal?.aborted) {
    return new AIProviderError("CANCELLED", "gemini", "The request was cancelled.");
  }
  if (cause instanceof ApiError) {
    // The vendor's error is replaced, not wrapped: its message is free text.
    const upstream = upstreamOf(cause);
    const known = HTTP_FAILURES[cause.status] ?? {
      kind: "UNAVAILABLE" as const,
      message: "The AI provider is unavailable.",
    };
    return new AIProviderError(known.kind, "gemini", known.message, { upstream });
  }
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return new AIProviderError("TIMEOUT", "gemini", "The AI provider timed out.", { cause });
  }
  // A network failure (DNS, reset connection): no vendor text to leak.
  return new AIProviderError("UNAVAILABLE", "gemini", "The AI provider is unavailable.", { cause });
}

function refused(reason: FinishReason | undefined): boolean {
  return (
    reason === FinishReason.SAFETY ||
    reason === FinishReason.PROHIBITED_CONTENT ||
    reason === FinishReason.BLOCKLIST ||
    reason === FinishReason.SPII
  );
}

/** A caller's cancel and the per-request timeout, whichever comes first. */
function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * What Gemini models read inline (docs: "Text, Image, Video, Audio, and PDF"
 * for gemini-3.8-flash). Inline data is bounded at 20 MB per request.
 */
export const GEMINI_CAPABILITIES: AICapabilities = {
  imageTypes: ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"],
  maxImages: 16,
  maxInlineBytes: 20 * 1_048_576,
  pdf: true,
  structured: true,
};

export function createGeminiProvider(apiKey: string, model: string): AIProvider {
  // The key is always passed explicitly, so a GOOGLE_API_KEY elsewhere in the
  // environment is never used (the SDK still warns that it exists).
  const client = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: GEMINI_RETRY } });

  const config = (
    request: AIRequest,
    extra: GenerateContentConfig = {},
  ): GenerateContentConfig => ({
    systemInstruction: request.system,
    maxOutputTokens: request.maxOutputTokens ?? 2_000,
    abortSignal: withTimeout(request.signal),
    // Interactive answers: Flash models spend nothing on hidden reasoning
    // tokens. (Pro models refuse a zero budget, so they keep their default.)
    ...(model.includes("flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    ...extra,
  });

  return {
    name: "gemini",
    model,
    capabilities: GEMINI_CAPABILITIES,

    async generateText(request) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: toContents(request.messages),
          config: config(request),
        });
        const reason = response.candidates?.[0]?.finishReason;
        if (refused(reason)) {
          throw new AIProviderError("REFUSED", "gemini", "The AI provider declined to answer.");
        }
        return {
          text: response.text ?? "",
          usage: usageOf(response.usageMetadata),
          provider: "gemini",
          model,
          truncated: reason === FinishReason.MAX_TOKENS,
        };
      } catch (cause) {
        throw mapError(cause, request.signal);
      }
    },

    async generateStructured({ schema, schemaName: _schemaName, ...request }) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: toContents(request.messages),
          config: config(request, {
            responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(schema, { target: "draft-7" }),
          }),
        });
        const reason = response.candidates?.[0]?.finishReason;
        if (refused(reason)) {
          throw new AIProviderError("REFUSED", "gemini", "The AI provider declined to answer.");
        }
        const parsed = schema.safeParse(safeJson(response.text ?? ""));
        if (!parsed.success) {
          throw new AIProviderError(
            "INVALID_OUTPUT",
            "gemini",
            "The AI provider returned an answer in the wrong shape.",
          );
        }
        return {
          data: parsed.data,
          usage: usageOf(response.usageMetadata),
          provider: "gemini",
          model,
        };
      } catch (cause) {
        throw mapError(cause, request.signal);
      }
    },

    async stream(request) {
      let chunks: AsyncGenerator<Awaited<ReturnType<typeof client.models.generateContent>>>;
      try {
        chunks = await client.models.generateContentStream({
          model,
          contents: toContents(request.messages),
          config: config(request),
        });
      } catch (cause) {
        throw mapError(cause, request.signal);
      }

      let settle!: (value: { usage: AIUsage; truncated: boolean }) => void;
      let fail!: (error: unknown) => void;
      const result = new Promise<{ usage: AIUsage; truncated: boolean }>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      });
      result.catch(() => undefined);

      async function* deltas(): AsyncGenerator<string> {
        let usage: AIUsage = { inputTokens: null, outputTokens: null };
        let truncated = false;
        let sent = false;
        try {
          for await (const chunk of chunks) {
            const reason = chunk.candidates?.[0]?.finishReason;
            if (refused(reason)) {
              throw new AIProviderError("REFUSED", "gemini", "The AI provider declined to answer.");
            }
            if (reason === FinishReason.MAX_TOKENS) truncated = true;
            if (chunk.usageMetadata) usage = usageOf(chunk.usageMetadata);
            const text = chunk.text;
            if (text) {
              sent = true;
              yield text;
            }
          }
          settle({ usage, truncated });
        } catch (cause) {
          let error = mapError(cause, request.signal);
          // Part of the answer is already on screen (seen live: the SDK's
          // "Incomplete JSON segment" when Gemini closes a stream early). It
          // cannot be retried or failed over without repeating it, so it is
          // reported as cut off rather than as an outage.
          if (sent && error.kind !== "CANCELLED" && error.kind !== "REFUSED") {
            error = new AIProviderError(
              "INTERRUPTED",
              "gemini",
              "The AI provider stopped partway through the answer.",
              { upstream: error.upstream ?? { status: null, reason: "STREAM_INTERRUPTED" } },
            );
          }
          fail(error);
          throw error;
        }
      }

      return { deltas: deltas(), result, provider: "gemini", model } satisfies AIStream;
    },

    async ping(signal) {
      try {
        await client.models.get({
          model,
          config: { abortSignal: signal ?? AbortSignal.timeout(5_000) },
        });
      } catch (cause) {
        throw mapError(cause, signal);
      }
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
