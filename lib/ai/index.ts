import "server-only";

import { getEnvGroup } from "@/lib/config/env";
import { logger } from "@/lib/observability/logger";

import { AIProviderError, type AIProvider, type AIProviderName, type AIStream } from "./provider";
import { createGeminiProvider } from "./providers/gemini";
import { createOpenAIProvider } from "./providers/openai";

/**
 * Provider factory (ADR-008 § 1).
 *
 * `AI_DEFAULT_PROVIDER` picks the primary; when the other provider is also
 * configured it becomes the fallback for outages, rate limits and timeouts —
 * never for a refusal or an invalid answer, which the other model would not
 * fix. Keys are read here and nowhere else.
 */
export type { AIProvider } from "./provider";

export interface AIConfiguration {
  configured: boolean;
  primary: AIProviderName | null;
  fallback: AIProviderName | null;
}

function providers(): AIProvider[] {
  const env = getEnvGroup("ai");
  const available: Partial<Record<AIProviderName, AIProvider>> = {};
  if (env.OPENAI_API_KEY)
    available.openai = createOpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);
  if (env.GEMINI_API_KEY)
    available.gemini = createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);

  const order: AIProviderName[] =
    env.AI_DEFAULT_PROVIDER === "gemini" ? ["gemini", "openai"] : ["openai", "gemini"];
  return order.map((name) => available[name]).filter((p): p is AIProvider => Boolean(p));
}

export function getAIConfiguration(): AIConfiguration {
  try {
    const list = providers();
    return {
      configured: list.length > 0,
      primary: list[0]?.name ?? null,
      fallback: list[1]?.name ?? null,
    };
  } catch (cause) {
    logger.error({ err: cause }, "AI configuration is invalid");
    return { configured: false, primary: null, fallback: null };
  }
}

let override: AIProvider | null = null;

/** Test seam: replaces the configured providers. Production never calls it. */
export function setAIProviderForTesting(provider: AIProvider | null): void {
  override = provider;
}

/** Tries each provider in turn while the failure is the vendor's. */
async function withFallback<T>(
  list: AIProvider[],
  call: (provider: AIProvider) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const provider of list) {
    try {
      return await call(provider);
    } catch (cause) {
      lastError = cause;
      const retry = cause instanceof AIProviderError && cause.retryableElsewhere;
      logger.warn(
        {
          provider: provider.name,
          kind: cause instanceof AIProviderError ? cause.kind : "UNKNOWN",
        },
        retry ? "AI provider failed; trying the fallback" : "AI provider failed",
      );
      if (!retry) throw cause;
    }
  }
  throw lastError;
}

/**
 * The provider the application talks to. Throws `NOT_CONFIGURED` when no key
 * is set, which routes surface as 503 `AI_UNAVAILABLE` — the non-AI product is
 * unaffected (api-contracts.md § AI).
 */
export function getAIProvider(): AIProvider {
  if (override) return override;
  const list = providers();
  if (list.length === 0) {
    throw new AIProviderError("NOT_CONFIGURED", null, "No AI provider is configured.");
  }
  if (list.length === 1) return list[0]!;

  const [primary] = list;
  return {
    name: primary!.name,
    model: primary!.model,
    generateText: (request) => withFallback(list, (p) => p.generateText(request)),
    generateStructured: (request) => withFallback(list, (p) => p.generateStructured(request)),
    // A stream can only fall back before its first token has been sent.
    stream: (request): Promise<AIStream> => withFallback(list, (p) => p.stream(request)),
    ping: (signal) => primary!.ping(signal),
  };
}
