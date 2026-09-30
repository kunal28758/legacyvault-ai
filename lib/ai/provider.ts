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
export type AIProviderName = "openai" | "gemini";

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
}

export interface AIUsage {
  inputTokens: number | null;
  outputTokens: number | null;
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
 * vendor's own message is kept only as the `cause` — it can echo request
 * content, so it is never shown to a user or logged verbatim.
 */
export type AIErrorKind =
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "REFUSED"
  | "INVALID_OUTPUT"
  | "CANCELLED";

export class AIProviderError extends Error {
  constructor(
    readonly kind: AIErrorKind,
    readonly provider: AIProviderName | null,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AIProviderError";
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
