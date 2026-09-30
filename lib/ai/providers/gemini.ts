import "server-only";

import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
} from "@google/genai";
import { z } from "zod";

import {
  AIProviderError,
  type AIMessage,
  type AIProvider,
  type AIRequest,
  type AIStream,
  type AIUsage,
} from "@/lib/ai/provider";

/**
 * Google Gemini through `@google/genai` (ADR-008).
 *
 * Gemini reads images and PDFs natively from inline data, including scanned
 * pages, which makes it a complete OCR path on its own (ADR-008 § 5).
 */
const REQUEST_TIMEOUT_MS = 90_000;

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

function mapError(cause: unknown, signal?: AbortSignal): AIProviderError {
  if (cause instanceof AIProviderError) return cause;
  if (signal?.aborted) {
    return new AIProviderError("CANCELLED", "gemini", "The request was cancelled.", { cause });
  }
  if (cause instanceof ApiError) {
    if (cause.status === 429) {
      return new AIProviderError("RATE_LIMITED", "gemini", "The AI provider is rate limiting.", {
        cause,
      });
    }
    if (cause.status === 401 || cause.status === 403) {
      return new AIProviderError(
        "NOT_CONFIGURED",
        "gemini",
        "The AI provider rejected the credentials.",
        {
          cause,
        },
      );
    }
    if (cause.status === 400) {
      return new AIProviderError("REFUSED", "gemini", "The AI provider refused the request.", {
        cause,
      });
    }
  }
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return new AIProviderError("TIMEOUT", "gemini", "The AI provider timed out.", { cause });
  }
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

export function createGeminiProvider(apiKey: string, model: string): AIProvider {
  const client = new GoogleGenAI({ apiKey });

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
        try {
          for await (const chunk of chunks) {
            const reason = chunk.candidates?.[0]?.finishReason;
            if (refused(reason)) {
              throw new AIProviderError("REFUSED", "gemini", "The AI provider declined to answer.");
            }
            if (reason === FinishReason.MAX_TOKENS) truncated = true;
            if (chunk.usageMetadata) usage = usageOf(chunk.usageMetadata);
            const text = chunk.text;
            if (text) yield text;
          }
          settle({ usage, truncated });
        } catch (cause) {
          const error = mapError(cause, request.signal);
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
