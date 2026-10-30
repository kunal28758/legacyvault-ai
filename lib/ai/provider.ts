import "server-only";

import type { z } from "zod";

/**
 * The AI provider boundary (ADR-008 § 1).
 *
 * Every model call in LegacyVault goes through this interface, so the rest of
 * the application never imports a vendor SDK, never sees an API key, and can
 * fall back from one provider to the other on an outage (FR-R001, FR-R010).
 *
 * The interface is deliberately small:
 *  • `generateText`       — one answer, whole;
 *  • `generateStructured` — JSON constrained by a schema and **re-validated
 *                           with Zod on receipt**, so a model can never hand the
 *                           application a shape it did not ask for;
 *  • `stream`             — text deltas for the chat surfaces.
 *
 * Files (images, scanned PDFs) travel as inline parts. Nothing here persists
 * anything; callers decide what, if anything, is kept (ADR-016).
 */
export type AIProviderName =
  "openai" | "gemini" | "openrouter" | "groq" | "cerebras" | "huggingface";

export const AI_PROVIDER_NAMES: readonly AIProviderName[] = [
  "gemini",
  "openai",
  "openrouter",
  "groq",
  "cerebras",
  "huggingface",
];

/**
 * What a configured model can actually be sent, as verified against the
 * vendor's documentation. The factory consults it before every attempt, so a
 * fallback never receives a request it cannot read — an image is never sent to
 * a text-only model in the hope that it copes.
 */
export interface AICapabilities {
  /** Image types the model reads when sent inline. Empty for text-only models. */
  imageTypes: readonly string[];
  maxImages: number;
  /** Total inline file bytes one request may carry. */
  maxInlineBytes: number;
  /** Reads a PDF sent inline (scanned documents that need OCR). */
  pdf: boolean;
  /** Returns JSON constrained by a schema (document analyses). */
  structured: boolean;
}

export interface AIFilePart {
  kind: "file";
  mimeType: string;
  /** Raw bytes. Sent inline to the provider and never written anywhere. */
  data: Uint8Array;
  filename: string;
}

export interface AITextPart {
  kind: "text";
  text: string;
}

export type AIContentPart = AITextPart | AIFilePart;

export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIContentPart[];
}

export interface AIRequest {
  /** System instructions: policy, grounding rules, output expectations. */
  system: string;
  messages: AIMessage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /**
   * True when the request carries the content of a vault document (an
   * attachment, a document analysis). Only providers approved for vault
   * documents (`AI_DOCUMENT_PROVIDERS`) may receive it.
   */
  containsDocuments?: boolean;
}

export interface AIUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export type StructuredOutputClassification =
  | "empty"
  | "non_json"
  | "malformed_json"
  | "schema_invalid_json"
  | "valid_json";

export type StructuredOutputFinishReason =
  | "stop"
  | "length"
  | "content_filter"
  | "tool_calls"
  | "function_call";

export interface StructuredOutputDiagnostic {
  classification: StructuredOutputClassification;
  finishReason: StructuredOutputFinishReason | null;
}

export interface AITextResult {
  text: string;
  usage: AIUsage;
  provider: AIProviderName;
  model: string;
  /** True when the model stopped because it hit the output limit. */
  truncated: boolean;
}

export interface AIStructuredResult<T> {
  data: T;
  usage: AIUsage;
  provider: AIProviderName;
  model: string;
  structuredOutput?: StructuredOutputDiagnostic;
}

export interface AIStream {
  /** Text deltas in order. Throws `AIProviderError` on failure. */
  deltas: AsyncIterable<string>;
  /** Settles after the stream ends. */
  result: Promise<{ usage: AIUsage; truncated: boolean }>;
  provider: AIProviderName;
  model: string;
}

export interface AIProvider {
  readonly name: AIProviderName;
  readonly model: string;
  readonly capabilities: AICapabilities;
  generateText(request: AIRequest): Promise<AITextResult>;
  generateStructured<T>(
    request: AIRequest & { schema: z.ZodType<T>; schemaName: string },
  ): Promise<AIStructuredResult<T>>;
  stream(request: AIRequest): Promise<AIStream>;
  /** A cheap authenticated call (listing a model), for the status page. */
  ping(signal?: AbortSignal): Promise<void>;
}

/**
 * Why a provider call failed, in terms the application can act on. The
 * vendor's own message can echo request content, so it is never shown to a
 * user or logged: an HTTP failure from the vendor is described by `upstream`
 * instead — its status code and the vendor's status enum, nothing free-form.
 */
export type AIErrorKind =
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "REFUSED"
  | "INVALID_OUTPUT"
  | "CANCELLED"
  /** A stream failed after part of the answer had already been sent. */
  | "INTERRUPTED"
  /** No configured provider can take this request (e.g. an image, and only text models). */
  | "UNSUPPORTED";

/** What the vendor answered, for diagnosis (e.g. `{ status: 503, reason: "UNAVAILABLE" }`). */
export interface AIUpstreamFailure {
  status: number | null;
  /** The vendor's machine-readable status, e.g. `RESOURCE_EXHAUSTED`; never message text. */
  reason: string | null;
  /** Which quota was spent, as the vendor identifies it (e.g. `…PerDay…`), when it says. */
  quota?: string | null;
  /** That quota's size, when the vendor says. */
  quotaLimit?: number | null;
  /** How long the vendor asked callers to wait, when it says. */
  retryAfterSeconds?: number | null;
  /** Closed, content-free diagnostics for structured-output responses. */
  structuredOutput?: StructuredOutputDiagnostic;
}

export class AIProviderError extends Error {
  readonly upstream: AIUpstreamFailure | null;

  constructor(
    readonly kind: AIErrorKind,
    readonly provider: AIProviderName | null,
    message: string,
    options?: { cause?: unknown; upstream?: AIUpstreamFailure },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AIProviderError";
    this.upstream = options?.upstream ?? null;
  }

  /** Worth trying the other provider: the failure was the vendor's, not the input's. */
  get retryableElsewhere(): boolean {
    return this.kind === "UNAVAILABLE" || this.kind === "RATE_LIMITED" || this.kind === "TIMEOUT";
  }
}

/** Joins a message's text parts; file parts are described, never inlined. */
export function textOf(content: AIMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.kind === "text" ? part.text : `[attached file: ${part.filename}]`))
    .join("\n");
}

/** A spent *daily* quota: it will not clear in seconds, so neither waiting nor retrying helps. */
export function isDailyQuota(upstream: AIUpstreamFailure | null | undefined): boolean {
  return /per[- ]?day/i.test(upstream?.quota ?? "");
}
