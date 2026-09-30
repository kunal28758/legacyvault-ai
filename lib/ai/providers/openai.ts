import "server-only";

import OpenAI from "openai";
import { ContentFilterFinishReasonError } from "openai/core/error";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
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
 * OpenAI through the Responses API (ADR-008).
 *
 * Files travel inline as base64 data: images as `input_image`, PDFs as
 * `input_file` (the model reads both the text layer and the page images, which
 * is what makes scanned PDFs legible). Nothing is uploaded to OpenAI's file
 * store, so there is no remote copy to clean up.
 */
const REQUEST_TIMEOUT_MS = 90_000;

function toInput(messages: AIMessage[]): ResponseInputItem[] {
  return messages.map((message): ResponseInputItem => {
    if (typeof message.content === "string" || message.role === "assistant") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) => (part.kind === "text" ? part.text : "")).join("\n");
      return { role: message.role, content: text };
    }
    return {
      role: "user",
      content: message.content.map((part) => {
        if (part.kind === "text") return { type: "input_text" as const, text: part.text };
        const base64 = Buffer.from(part.data).toString("base64");
        if (part.mimeType.startsWith("image/")) {
          return {
            type: "input_image" as const,
            image_url: `data:${part.mimeType};base64,${base64}`,
            detail: "auto" as const,
          };
        }
        return {
          type: "input_file" as const,
          filename: part.filename,
          file_data: `data:${part.mimeType};base64,${base64}`,
        };
      }),
    };
  });
}

function usageOf(
  usage: { input_tokens?: number; output_tokens?: number } | null | undefined,
): AIUsage {
  return { inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null };
}

function mapError(cause: unknown): AIProviderError {
  if (cause instanceof AIProviderError) return cause;
  if (cause instanceof OpenAI.APIUserAbortError) {
    return new AIProviderError("CANCELLED", "openai", "The request was cancelled.", { cause });
  }
  if (cause instanceof OpenAI.APIConnectionTimeoutError) {
    return new AIProviderError("TIMEOUT", "openai", "The AI provider timed out.", { cause });
  }
  if (cause instanceof OpenAI.RateLimitError) {
    return new AIProviderError("RATE_LIMITED", "openai", "The AI provider is rate limiting.", {
      cause,
    });
  }
  if (
    cause instanceof OpenAI.AuthenticationError ||
    cause instanceof OpenAI.PermissionDeniedError
  ) {
    return new AIProviderError(
      "NOT_CONFIGURED",
      "openai",
      "The AI provider rejected the credentials.",
      {
        cause,
      },
    );
  }
  if (cause instanceof OpenAI.BadRequestError) {
    return new AIProviderError("REFUSED", "openai", "The AI provider refused the request.", {
      cause,
    });
  }
  if (cause instanceof ContentFilterFinishReasonError) {
    return new AIProviderError("REFUSED", "openai", "The AI provider declined to answer.", {
      cause,
    });
  }
  return new AIProviderError("UNAVAILABLE", "openai", "The AI provider is unavailable.", { cause });
}

/** Reasoning models answer faster with a low effort, which suits interactive use. */
function reasoningFor(model: string): ResponseCreateParamsNonStreaming["reasoning"] {
  return /^(gpt-5|o\d)/.test(model) ? { effort: "low" } : undefined;
}

export function createOpenAIProvider(apiKey: string, model: string): AIProvider {
  const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });

  const base = (request: AIRequest) => ({
    model,
    instructions: request.system,
    input: toInput(request.messages),
    max_output_tokens: request.maxOutputTokens ?? 2_000,
    reasoning: reasoningFor(model),
    // Nothing is stored at OpenAI beyond the request itself (ADR-016).
    store: false,
  });

  return {
    name: "openai",
    model,

    async generateText(request) {
      try {
        const response = await client.responses.create(base(request), { signal: request.signal });
        return {
          text: response.output_text,
          usage: usageOf(response.usage),
          provider: "openai",
          model,
          truncated: response.incomplete_details?.reason === "max_output_tokens",
        };
      } catch (cause) {
        throw mapError(cause);
      }
    },

    async generateStructured({ schema, schemaName, ...request }) {
      try {
        const response = await client.responses.create(
          {
            ...base(request),
            text: {
              format: {
                type: "json_schema",
                name: schemaName,
                schema: z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>,
                strict: false,
              },
            },
          },
          { signal: request.signal },
        );
        if (response.incomplete_details?.reason === "max_output_tokens") {
          throw new AIProviderError("INVALID_OUTPUT", "openai", "The answer was cut off.");
        }
        const parsed = schema.safeParse(safeJson(response.output_text));
        if (!parsed.success) {
          throw new AIProviderError(
            "INVALID_OUTPUT",
            "openai",
            "The AI provider returned an answer in the wrong shape.",
          );
        }
        return { data: parsed.data, usage: usageOf(response.usage), provider: "openai", model };
      } catch (cause) {
        throw mapError(cause);
      }
    },

    async stream(request) {
      let events: AsyncIterable<ResponseStreamEvent>;
      try {
        events = await client.responses.create(
          { ...base(request), stream: true },
          { signal: request.signal },
        );
      } catch (cause) {
        throw mapError(cause);
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
          for await (const event of events) {
            if (event.type === "response.output_text.delta") {
              yield event.delta;
            } else if (event.type === "response.completed") {
              usage = usageOf(event.response.usage);
            } else if (event.type === "response.incomplete") {
              usage = usageOf(event.response.usage);
              truncated = event.response.incomplete_details?.reason === "max_output_tokens";
            } else if (event.type === "response.failed" || event.type === "error") {
              throw new AIProviderError(
                "UNAVAILABLE",
                "openai",
                "The AI provider failed mid-answer.",
              );
            }
          }
          settle({ usage, truncated });
        } catch (cause) {
          const error = mapError(cause);
          fail(error);
          throw error;
        }
      }

      return { deltas: deltas(), result, provider: "openai", model } satisfies AIStream;
    },

    async ping(signal) {
      try {
        await client.models.retrieve(model, { signal, timeout: 5_000 });
      } catch (cause) {
        throw mapError(cause);
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
