import "server-only";

import { getEnvGroup } from "@/lib/config/env";
import { logger } from "@/lib/observability/logger";

import {
  AIProviderError,
  type AIFilePart,
  type AIProvider,
  type AIProviderName,
  type AIRequest,
  type AIStream,
} from "./provider";
import { createGeminiProvider } from "./providers/gemini";
import { createOpenAIProvider } from "./providers/openai";
import {
  createCompatibleProvider,
  isFreeOpenRouterModel,
  type CompatibleProviderName,
} from "./providers/openai-compatible";

/**
 * Provider factory (ADR-008 § 1).
 *
 * The chain is built from configuration, never from what happens to be in the
 * environment: OpenAI and Gemini take part by default (primary first, per
 * `AI_DEFAULT_PROVIDER`); every other provider must be named in
 * `AI_PROVIDER_ORDER`, which then defines the whole order. A key alone
 * authorises nothing, and an OpenRouter model that is not a free variant is
 * refused unless `OPENROUTER_ALLOW_PAID_MODELS` says otherwise — so a failover
 * can never start spending money on its own.
 *
 * Each request walks the chain in order, skipping any provider that cannot
 * take it — a model that cannot read the attached image, has no structured
 * output, or is not approved for vault documents (`AI_DOCUMENT_PROVIDERS`). It
 * moves on only when a provider failed for reasons of its own (outage, timeout,
 * spent quota); a refusal, an invalid request, rejected credentials or an
 * answer that failed validation is returned as it is, because another model
 * would not fix it. Every attempt is logged with provider, model, duration and
 * outcome — never the prompt, the document or a key.
 */
export type { AIProvider } from "./provider";

export interface AIConfiguration {
  configured: boolean;
  primary: AIProviderName | null;
  /** The first fallback, if any. */
  fallback: AIProviderName | null;
  fallbacks: AIProviderName[];
}

interface Chain {
  providers: AIProvider[];
  documentProviders: ReadonlySet<AIProviderName>;
}

type Operation = "text" | "structured" | "stream";
type AIEnv = ReturnType<typeof getEnvGroup<"ai">>;

/** Providers that may receive vault documents unless configured otherwise. */
const DEFAULT_DOCUMENT_PROVIDERS: AIProviderName[] = ["gemini", "openai"];

const warned = new Set<string>();
function warnOnce(key: string, fields: Record<string, unknown>, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  logger.warn(fields, message);
}

function compatible(name: CompatibleProviderName, apiKey: string | undefined, model?: string) {
  return apiKey && model ? createCompatibleProvider({ name, apiKey, model }) : null;
}

function build(name: AIProviderName, env: AIEnv): AIProvider | null {
  switch (name) {
    case "gemini":
      return env.GEMINI_API_KEY ? createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL) : null;
    case "openai":
      return env.OPENAI_API_KEY ? createOpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL) : null;
    case "openrouter":
      if (
        env.OPENROUTER_API_KEY &&
        !isFreeOpenRouterModel(env.OPENROUTER_MODEL) &&
        !env.OPENROUTER_ALLOW_PAID_MODELS
      ) {
        warnOnce(
          "openrouter-paid",
          { provider: "openrouter", model: env.OPENROUTER_MODEL },
          "OpenRouter model is not a free variant; it is not used without OPENROUTER_ALLOW_PAID_MODELS",
        );
        return null;
      }
      return compatible("openrouter", env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL);
    case "groq":
      return compatible("groq", env.GROQ_API_KEY, env.GROQ_MODEL);
    case "cerebras":
      return compatible("cerebras", env.CEREBRAS_API_KEY, env.CEREBRAS_MODEL);
    case "huggingface":
      return compatible("huggingface", env.HF_TOKEN, env.HF_MODEL);
  }
}

function chain(): Chain {
  const env = getEnvGroup("ai");
  const order: AIProviderName[] =
    env.AI_PROVIDER_ORDER ??
    (env.AI_DEFAULT_PROVIDER === "gemini" ? ["gemini", "openai"] : ["openai", "gemini"]);
  return {
    providers: order.map((name) => build(name, env)).filter((p): p is AIProvider => Boolean(p)),
    documentProviders: new Set(env.AI_DOCUMENT_PROVIDERS ?? DEFAULT_DOCUMENT_PROVIDERS),
  };
}

export function getAIConfiguration(): AIConfiguration {
  try {
    const names = chain().providers.map((provider) => provider.name);
    return {
      configured: names.length > 0,
      primary: names[0] ?? null,
      fallback: names[1] ?? null,
      fallbacks: names.slice(1),
    };
  } catch (cause) {
    logger.error({ err: cause }, "AI configuration is invalid");
    return { configured: false, primary: null, fallback: null, fallbacks: [] };
  }
}

let override: AIProvider | null = null;

/** Test seam: replaces the configured providers. Production never calls it. */
export function setAIProviderForTesting(provider: AIProvider | null): void {
  override = provider;
}

/* ── Eligibility ──────────────────────────────────────────────────────────── */

function filesOf(request: AIRequest): AIFilePart[] {
  return request.messages.flatMap((message) =>
    typeof message.content === "string"
      ? []
      : message.content.filter((part): part is AIFilePart => part.kind === "file"),
  );
}

/** Why `provider` cannot take `request`, or null when it can. */
export function ineligibility(
  provider: AIProvider,
  request: AIRequest,
  operation: Operation,
  documentProviders: ReadonlySet<AIProviderName>,
): string | null {
  if (request.containsDocuments && !documentProviders.has(provider.name)) {
    return "not-approved-for-documents";
  }
  const capabilities = provider.capabilities;
  if (operation === "structured" && !capabilities.structured) return "no-structured-output";
  const files = filesOf(request);
  if (files.length === 0) return null;
  const images = files.filter((file) => file.mimeType.startsWith("image/"));
  if (images.some((image) => !capabilities.imageTypes.includes(image.mimeType))) {
    return "image-type-unsupported";
  }
  if (images.length > capabilities.maxImages) return "too-many-images";
  const others = files.filter((file) => !file.mimeType.startsWith("image/"));
  if (others.some((file) => file.mimeType !== "application/pdf" || !capabilities.pdf)) {
    return "file-type-unsupported";
  }
  const bytes = files.reduce((sum, file) => sum + file.data.byteLength, 0);
  if (bytes > capabilities.maxInlineBytes) return "files-too-large";
  return null;
}

/* ── Running a request ────────────────────────────────────────────────────── */

function unsupported(skipped: string[]): AIProviderError {
  const documentsOnly = skipped.every((entry) => entry.endsWith(":not-approved-for-documents"));
  return new AIProviderError(
    "UNSUPPORTED",
    null,
    documentsOnly
      ? "No configured AI provider is approved to read vault documents."
      : "No configured AI provider can read this kind of file.",
  );
}

/**
 * Every provider, retry and back-off in one request shares this budget, so a
 * slow chain ends well inside the 180 s the AI routes may run. When it is spent
 * the chain stops with a timeout instead of trying the next provider.
 */
const DEFAULT_CHAIN_BUDGET_MS = 150_000;
let chainBudgetMs = DEFAULT_CHAIN_BUDGET_MS;

/** Test seam: shortens the chain budget. Production never calls it. */
export function setAIChainBudgetForTesting(ms: number | null): void {
  chainBudgetMs = ms ?? DEFAULT_CHAIN_BUDGET_MS;
}

function budgetSpent(provider: AIProviderName | null): AIProviderError {
  return new AIProviderError("TIMEOUT", provider, "The AI service took too long to answer.", {
    upstream: { status: null, reason: "CHAIN_BUDGET_SPENT" },
  });
}

async function run<T>(
  { providers, documentProviders }: Chain,
  request: AIRequest,
  operation: Operation,
  call: (provider: AIProvider, request: AIRequest) => Promise<T>,
): Promise<{ value: T; provider: AIProvider; started: number }> {
  const skipped: string[] = [];
  let lastError: AIProviderError | null = null;
  const budget = AbortSignal.timeout(chainBudgetMs);
  const bounded: AIRequest = {
    ...request,
    signal: request.signal ? AbortSignal.any([request.signal, budget]) : budget,
  };

  for (const provider of providers) {
    const reason = ineligibility(provider, request, operation, documentProviders);
    if (reason) {
      skipped.push(`${provider.name}:${reason}`);
      continue;
    }
    if (budget.aborted) throw budgetSpent(lastError?.provider ?? null);
    const started = Date.now();
    try {
      const value = await call(provider, bounded);
      return { value, provider, started };
    } catch (thrown) {
      if (!(thrown instanceof AIProviderError)) throw thrown;
      // The budget, not the caller, ended it: report a timeout, not a cancel.
      const cause =
        budget.aborted && !request.signal?.aborted ? budgetSpent(provider.name) : thrown;
      const failover = cause.retryableElsewhere && !budget.aborted;
      logger.warn(
        {
          provider: provider.name,
          model: provider.model,
          operation,
          durationMs: Date.now() - started,
          outcome: cause.kind === "CANCELLED" ? "cancelled" : "failed",
          kind: cause.kind,
          upstream: cause.upstream,
          failover,
        },
        "AI provider call failed",
      );
      lastError = cause;
      if (!failover) throw cause;
    }
  }

  if (skipped.length) logger.info({ operation, skipped }, "AI providers skipped for this request");
  throw lastError ?? unsupported(skipped);
}

function succeeded(provider: AIProvider, operation: Operation, started: number): void {
  logger.info(
    {
      provider: provider.name,
      model: provider.model,
      operation,
      durationMs: Date.now() - started,
      outcome: "success",
    },
    "AI provider call",
  );
}

/** Logs how a stream ended once it has: completed, cut off, or failed. */
function observed(stream: AIStream, provider: AIProvider, started: number): AIStream {
  stream.result.then(
    ({ truncated }) =>
      logger.info(
        {
          provider: provider.name,
          model: provider.model,
          operation: "stream",
          durationMs: Date.now() - started,
          outcome: truncated ? "truncated" : "completed",
        },
        "AI stream finished",
      ),
    (cause: unknown) =>
      logger.warn(
        {
          provider: provider.name,
          model: provider.model,
          operation: "stream",
          durationMs: Date.now() - started,
          outcome:
            cause instanceof AIProviderError && cause.kind === "INTERRUPTED"
              ? "interrupted"
              : "failed",
          kind: cause instanceof AIProviderError ? cause.kind : "UNKNOWN",
          upstream: cause instanceof AIProviderError ? cause.upstream : null,
        },
        "AI stream failed",
      ),
  );
  return stream;
}

/**
 * The provider the application talks to. Throws `NOT_CONFIGURED` when no key
 * is set, which routes surface as 503 `AI_UNAVAILABLE` — the non-AI product is
 * unaffected (api-contracts.md § AI).
 */
export function getAIProvider(): AIProvider {
  if (override) return override;
  const configured = chain();
  const [primary] = configured.providers;
  if (!primary) {
    throw new AIProviderError("NOT_CONFIGURED", null, "No AI provider is configured.");
  }

  return {
    name: primary.name,
    model: primary.model,
    capabilities: primary.capabilities,
    async generateText(request) {
      const { value, provider, started } = await run(configured, request, "text", (p, r) =>
        p.generateText(r),
      );
      succeeded(provider, "text", started);
      return value;
    },
    async generateStructured(request) {
      const { value, provider, started } = await run(configured, request, "structured", (p, r) =>
        p.generateStructured({ ...request, signal: r.signal }),
      );
      succeeded(provider, "structured", started);
      return value;
    },
    // A stream can only fall back before its first token has been sent.
    async stream(request) {
      const { value, provider, started } = await run(configured, request, "stream", (p, r) =>
        p.stream(r),
      );
      return observed(value, provider, started);
    },
    ping: (signal) => primary.ping(signal),
  };
}
