import "server-only";

import OpenAI from "openai";
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { z } from "zod";

import {
  AIProviderError,
  type AICapabilities,
  type AIErrorKind,
  type AIMessage,
  type AIProvider,
  type AIProviderName,
  type AIRequest,
  type AIStream,
  type AIUpstreamFailure,
  type AIUsage,
} from "@/lib/ai/provider";
import { withRetry } from "@/lib/ai/retry";

/**
 * Providers that speak OpenAI's Chat Completions protocol (ADR-008):
 * OpenRouter, Groq, Cerebras and Hugging Face Inference Providers.
 *
 * One adapter, four configurations — the request shape, streaming, error
 * mapping and retry policy are the same; what differs is the endpoint, the
 * name of the output-limit parameter, and what each model can read. Those
 * capabilities come from the vendors' own documentation (verified 2026-10-02,
 * see docs/DEPLOYMENT.md § AI providers); a model not listed here is treated as
 * text-only without structured output, so nothing is ever sent to a model on
 * the assumption that it can read it.
 *
 * The SDK's own retries are off: `withRetry` decides, so a spent daily quota
 * fails over at once instead of being retried.
 */
export type CompatibleProviderName = Extract<
  AIProviderName,
  "openrouter" | "groq" | "cerebras" | "huggingface"
>;

const REQUEST_TIMEOUT_MS = 90_000;
const MB = 1_048_576;

interface Profile {
  baseURL: string;
  maxTokensParam: "max_tokens" | "max_completion_tokens";
  headers?: Record<string, string>;
}

export const COMPATIBLE_PROFILES: Record<CompatibleProviderName, Profile> = {
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    maxTokensParam: "max_tokens",
    headers: { "X-Title": "LegacyVault AI" },
  },
  groq: { baseURL: "https://api.groq.com/openai/v1", maxTokensParam: "max_completion_tokens" },
  cerebras: { baseURL: "https://api.cerebras.ai/v1", maxTokensParam: "max_completion_tokens" },
  huggingface: { baseURL: "https://router.huggingface.co/v1", maxTokensParam: "max_tokens" },
};

const TEXT_ONLY: AICapabilities = {
  imageTypes: [],
  maxImages: 0,
  maxInlineBytes: 0,
  pdf: false,
  structured: false,
};

/**
 * Models whose capabilities were verified (2026-10-02). Inline images travel
 * base64-encoded, a third larger than the file, so byte budgets sit below each
 * vendor's documented request limit. None of these reads a PDF directly: PDFs
 * reach them only as text the server has already extracted.
 */
export const VERIFIED_MODELS: Record<CompatibleProviderName, Record<string, AICapabilities>> = {
  openrouter: {
    // Free variants (priced 0/0 in OpenRouter's public model list).
    "qwen/qwen3.8-27b:free": {
      imageTypes: ["image/png", "image/jpeg", "image/webp"],
      maxImages: 3,
      maxInlineBytes: 14 * MB,
      pdf: false,
      structured: true,
    },
    "google/gemma-4-31b-it:free": {
      imageTypes: ["image/png", "image/jpeg", "image/webp"],
      maxImages: 3,
      maxInlineBytes: 14 * MB,
      pdf: false,
      structured: true,
    },
  },
  groq: {
    "openai/gpt-oss-120b": { ...TEXT_ONLY, structured: true },
    "openai/gpt-oss-20b": { ...TEXT_ONLY, structured: true },
    // Preview model: 3 images, 20 MB per request.
    "qwen/qwen3.8-27b": {
      imageTypes: ["image/png", "image/jpeg"],
      maxImages: 3,
      maxInlineBytes: 14 * MB,
      pdf: false,
      structured: true,
    },
  },
  cerebras: {
    "gpt-oss-120b": { ...TEXT_ONLY, structured: true },
    // Free tier: 2 images and 10 MiB per request; PNG and JPEG data URIs only.
    "qwen-3.8-27b": {
      imageTypes: ["image/png", "image/jpeg"],
      maxImages: 2,
      maxInlineBytes: 7 * MB,
      pdf: false,
      structured: true,
    },
  },
  huggingface: {},
};

export function capabilitiesFor(name: CompatibleProviderName, model: string): AICapabilities {
  return VERIFIED_MODELS[name][model] ?? TEXT_ONLY;
}

/** OpenRouter's free variants end in `:free` and are priced at zero. */
export function isFreeOpenRouterModel(model: string): boolean {
  return model.endsWith(":free");
}

/* ── Requests ─────────────────────────────────────────────────────────────── */

function toMessages(
  request: AIRequest,
  provider: CompatibleProviderName,
): ChatCompletionMessageParam[] {
  const toParts = (content: AIMessage["content"]): string | ChatCompletionContentPart[] => {
    if (typeof content === "string") return content;
    return content.map((part): ChatCompletionContentPart => {
      if (part.kind === "text") return { type: "text", text: part.text };
      if (!part.mimeType.startsWith("image/")) {
        // The factory never routes a PDF here; refuse rather than mis-send.
        throw new AIProviderError(
          "UNSUPPORTED",
          provider,
          "This model cannot read that file type.",
        );
      }
      const data = Buffer.from(part.data).toString("base64");
      return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${data}` } };
    });
  };
  return [
    { role: "system", content: request.system },
    ...request.messages.map((message): ChatCompletionMessageParam =>
      message.role === "assistant"
        ? {
            role: "assistant",
            content:
              typeof message.content === "string" ? message.content : textOnly(message.content),
          }
        : { role: "user", content: toParts(message.content) },
    ),
  ];
}

function textOnly(content: Exclude<AIMessage["content"], string>): string {
  return content.map((part) => (part.kind === "text" ? part.text : "")).join("\n");
}

function usageOf(
  usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined,
): AIUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
  };
}

/* ── Failures ─────────────────────────────────────────────────────────────── */

function header(headers: unknown, name: string): string | null {
  return headers instanceof Headers ? headers.get(name) : null;
}

/** The vendor's wait, from `retry-after(-ms)` or OpenRouter's reset timestamp. */
function retryAfterSecondsOf(error: InstanceType<typeof OpenAI.APIError>): number | null {
  const ms = Number(header(error.headers, "retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return Math.ceil(ms / 1_000);
  const seconds = Number(header(error.headers, "retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const reset = JSON.stringify(error.error ?? {}).match(
    /X-RateLimit-Reset\\?"\s*:\s*\\?"?(\d{10,13})/i,
  );
  if (reset) {
    const at = Number(reset[1]) < 1e12 ? Number(reset[1]) * 1_000 : Number(reset[1]);
    return Math.max(1, Math.ceil((at - Date.now()) / 1_000));
  }
  return null;
}

/**
 * Which limit a 429 hit — a 429 means different things per vendor. Groq's
 * `x-ratelimit-*-requests` headers count requests per *day*; Cerebras names
 * its windows; OpenRouter says "per-day"/"per-min" in its error. Only the
 * derived category is kept, never the vendor's message.
 */
export function rateLimitWindow(
  provider: CompatibleProviderName,
  error: InstanceType<typeof OpenAI.APIError>,
  retryAfterSeconds: number | null,
): string | null {
  const zero = (name: string) => header(error.headers, name) === "0";
  if (zero("x-ratelimit-remaining-requests-day")) return "requests-per-day";
  if (zero("x-ratelimit-remaining-tokens-day")) return "tokens-per-day";
  if (provider === "groq" && zero("x-ratelimit-remaining-requests")) return "requests-per-day";
  if (zero("x-ratelimit-remaining-requests-minute")) return "requests-per-minute";
  if (zero("x-ratelimit-remaining-tokens-minute")) return "tokens-per-minute";
  if (provider === "groq" && zero("x-ratelimit-remaining-tokens")) return "tokens-per-minute";
  const said = `${error.message} ${JSON.stringify(error.error ?? {})}`;
  if (/per[- ]?day|daily|\bRPD\b|\bTPD\b/i.test(said)) return "requests-per-day";
  if (/per[- ]?min|\bRPM\b|\bTPM\b/i.test(said)) return "requests-per-minute";
  if (retryAfterSeconds !== null) {
    return retryAfterSeconds > 3_600 ? "requests-per-day" : "requests-per-minute";
  }
  return null;
}

const STATUS_KINDS: Record<number, { kind: AIErrorKind; message: string }> = {
  400: { kind: "REFUSED", message: "The AI provider refused the request." },
  401: { kind: "NOT_CONFIGURED", message: "The AI provider rejected the credentials." },
  402: { kind: "RATE_LIMITED", message: "The AI provider account has no credit left." },
  403: { kind: "NOT_CONFIGURED", message: "The AI provider rejected the credentials." },
  404: { kind: "NOT_CONFIGURED", message: "The configured AI model was not found." },
  408: { kind: "TIMEOUT", message: "The AI provider timed out." },
  413: { kind: "REFUSED", message: "The request was too large for the AI provider." },
  422: { kind: "REFUSED", message: "The AI provider refused the request." },
  429: { kind: "RATE_LIMITED", message: "The AI provider is rate limiting." },
  504: { kind: "TIMEOUT", message: "The AI provider timed out." },
};

export function mapCompatibleError(
  provider: CompatibleProviderName,
  cause: unknown,
  signal?: AbortSignal,
): AIProviderError {
  if (cause instanceof AIProviderError) return cause;
  if (signal?.aborted || cause instanceof OpenAI.APIUserAbortError) {
    return new AIProviderError("CANCELLED", provider, "The request was cancelled.");
  }
  if (cause instanceof OpenAI.APIConnectionTimeoutError) {
    return new AIProviderError("TIMEOUT", provider, "The AI provider timed out.");
  }
  if (cause instanceof OpenAI.APIConnectionError) {
    return new AIProviderError("UNAVAILABLE", provider, "The AI provider could not be reached.", {
      upstream: { status: null, reason: "CONNECTION_FAILED" },
    });
  }
  if (cause instanceof OpenAI.APIError && typeof cause.status === "number") {
    // Described, not wrapped: the vendor's message is free text.
    const retryAfterSeconds = retryAfterSecondsOf(cause);
    const code = cause.code ?? cause.type ?? null;
    const upstream: AIUpstreamFailure = {
      status: cause.status,
      reason: code && /^[A-Za-z_]{2,60}$/.test(code) ? code : null,
      quota:
        cause.status === 429
          ? rateLimitWindow(provider, cause, retryAfterSeconds)
          : cause.status === 402
            ? "credits"
            : null,
      retryAfterSeconds,
    };
    const known = STATUS_KINDS[cause.status] ?? {
      kind: "UNAVAILABLE" as const,
      message: "The AI provider is unavailable.",
    };
    return new AIProviderError(known.kind, provider, known.message, { upstream });
  }
  if (cause instanceof SyntaxError) {
    // A body that is not the JSON it claims to be: the vendor's fault, not ours.
    return new AIProviderError("UNAVAILABLE", provider, "The AI provider sent a malformed reply.", {
      upstream: { status: null, reason: "MALFORMED_RESPONSE" },
    });
  }
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return new AIProviderError("TIMEOUT", provider, "The AI provider timed out.");
  }
  return new AIProviderError("UNAVAILABLE", provider, "The AI provider is unavailable.", {
    upstream: { status: null, reason: "UNKNOWN" },
  });
}

function malformed(provider: CompatibleProviderName): AIProviderError {
  return new AIProviderError("UNAVAILABLE", provider, "The AI provider sent a malformed reply.", {
    upstream: { status: null, reason: "MALFORMED_RESPONSE" },
  });
}

function refusedBy(provider: CompatibleProviderName): AIProviderError {
  return new AIProviderError("REFUSED", provider, "The AI provider declined to answer.");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/* ── The adapter ──────────────────────────────────────────────────────────── */

export interface CompatibleProviderOptions {
  name: CompatibleProviderName;
  apiKey: string;
  model: string;
  /** For tests: the SDK otherwise uses the global `fetch`. */
  fetch?: typeof fetch;
}

export function createCompatibleProvider(options: CompatibleProviderOptions): AIProvider {
  const { name, model } = options;
  const profile = COMPATIBLE_PROFILES[name];
  const capabilities = capabilitiesFor(name, model);
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: profile.baseURL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    defaultHeaders: profile.headers,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const limit = (request: AIRequest) => ({
    [profile.maxTokensParam]: request.maxOutputTokens ?? 2_000,
  });

  const call = <T>(request: AIRequest, run: () => Promise<T>) =>
    withRetry(
      async () => {
        try {
          return await run();
        } catch (cause) {
          throw mapCompatibleError(name, cause, request.signal);
        }
      },
      { signal: request.signal },
    );

  return {
    name,
    model,
    capabilities,

    async generateText(request) {
      const completion = await call(request, () =>
        client.chat.completions.create(
          {
            model,
            messages: toMessages(request, name),
            ...limit(request),
          } as ChatCompletionCreateParamsNonStreaming,
          { signal: request.signal },
        ),
      );
      const choice = completion.choices?.[0];
      if (!choice) throw malformed(name);
      if (choice.finish_reason === "content_filter") throw refusedBy(name);
      return {
        text: choice.message?.content ?? "",
        usage: usageOf(completion.usage),
        provider: name,
        model,
        truncated: choice.finish_reason === "length",
      };
    },

    async generateStructured({ schema, schemaName, ...request }) {
      if (!capabilities.structured) {
        throw new AIProviderError(
          "UNSUPPORTED",
          name,
          "This model cannot return structured output.",
        );
      }
      const completion = await call(request, () =>
        client.chat.completions.create(
          {
            model,
            messages: toMessages(request, name),
            ...limit(request),
            response_format: {
              type: "json_schema",
              // Best-effort: the reply is re-validated with Zod below either way.
              json_schema: {
                name: schemaName,
                schema: z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>,
                strict: false,
              },
            },
          } as ChatCompletionCreateParamsNonStreaming,
          { signal: request.signal },
        ),
      );
      const choice = completion.choices?.[0];
      if (!choice) throw malformed(name);
      if (choice.finish_reason === "content_filter") throw refusedBy(name);
      const parsed = schema.safeParse(safeJson(choice.message?.content ?? ""));
      if (!parsed.success) {
        throw new AIProviderError(
          "INVALID_OUTPUT",
          name,
          "The AI provider returned an answer in the wrong shape.",
        );
      }
      return { data: parsed.data, usage: usageOf(completion.usage), provider: name, model };
    },

    async stream(request) {
      const chunks = await call(request, () =>
        client.chat.completions.create(
          {
            model,
            messages: toMessages(request, name),
            ...limit(request),
            stream: true,
          } as ChatCompletionCreateParamsStreaming,
          { signal: request.signal },
        ),
      );

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
        let sent = 0;
        let finished = false;
        try {
          for await (const chunk of chunks) {
            if (chunk.usage) usage = usageOf(chunk.usage);
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason === "content_filter") throw refusedBy(name);
            if (choice.finish_reason) finished = true;
            if (choice.finish_reason === "length") truncated = true;
            const text = choice.delta?.content;
            if (text) {
              sent += text.length;
              yield text;
            }
          }
          // A stream that just stops, without a finish reason, was cut off.
          if (!finished) throw malformed(name);
          settle({ usage, truncated });
        } catch (cause) {
          let error = mapCompatibleError(name, cause, request.signal);
          if (sent > 0 && error.kind !== "CANCELLED" && error.kind !== "REFUSED") {
            error = new AIProviderError(
              "INTERRUPTED",
              name,
              "The AI provider stopped partway through the answer.",
              { upstream: error.upstream ?? undefined },
            );
          }
          fail(error);
          throw error;
        }
      }

      return { deltas: deltas(), result, provider: name, model } satisfies AIStream;
    },

    async ping(signal) {
      try {
        await client.models.list({ signal: signal ?? AbortSignal.timeout(5_000) });
      } catch (cause) {
        throw mapCompatibleError(name, cause, signal);
      }
    },
  };
}
