import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  getAIConfiguration,
  getAIProvider,
  setAIChainBudgetForTesting,
  setAIProviderForTesting,
} from "@/lib/ai";
import {
  AIProviderError,
  type AICapabilities,
  type AIProvider,
  type AIProviderName,
  type AIRequest,
} from "@/lib/ai/provider";
import { GEMINI_CAPABILITIES } from "@/lib/ai/providers/gemini";
import { capabilitiesFor, type CompatibleProviderName } from "@/lib/ai/providers/openai-compatible";
import { resetEnvGroupCache } from "@/lib/config/env";
import { logger } from "@/lib/observability/logger";
import { toAIApiError } from "@/lib/services/ai/errors";

/**
 * The provider factory (ADR-008 § 1): which providers form the chain, which of
 * them may take a given request, and when a failure moves on to the next one.
 * Vendor SDKs are replaced by scripted doubles that carry the real capability
 * declarations; nothing here reaches a network. These are deterministic
 * failure-path tests — not evidence that any real provider works.
 */
type Mode =
  "ok" | "outage" | "quota" | "timeout" | "refuse" | "auth" | "invalid" | "cancel" | "hang";

const calls: string[] = [];
const behaviour: Partial<Record<AIProviderName, Mode>> = {};

function failure(mode: Mode, name: AIProviderName): AIProviderError | null {
  switch (mode) {
    case "outage":
      return new AIProviderError("UNAVAILABLE", name, "down", {
        upstream: { status: 503, reason: "UNAVAILABLE" },
      });
    case "quota":
      return new AIProviderError("RATE_LIMITED", name, "quota", {
        upstream: { status: 429, reason: "RESOURCE_EXHAUSTED", quota: "requests-per-day" },
      });
    case "timeout":
      return new AIProviderError("TIMEOUT", name, "slow");
    case "refuse":
      return new AIProviderError("REFUSED", name, "no");
    case "auth":
      return new AIProviderError("NOT_CONFIGURED", name, "bad key", {
        upstream: { status: 401, reason: "invalid_api_key" },
      });
    case "invalid":
      return new AIProviderError("INVALID_OUTPUT", name, "wrong shape");
    case "cancel":
      return new AIProviderError("CANCELLED", name, "cancelled");
    default:
      return null;
  }
}

function scripted(name: AIProviderName, model: string, capabilities: AICapabilities): AIProvider {
  const act = async <T>(value: T, request?: AIRequest): Promise<T> => {
    calls.push(name);
    if (behaviour[name] === "hang") {
      // Like a real adapter: waits on the vendor until its signal is aborted.
      await new Promise((_, reject) =>
        request?.signal?.addEventListener("abort", () =>
          reject(new AIProviderError("CANCELLED", name, "aborted")),
        ),
      );
    }
    const error = failure(behaviour[name] ?? "ok", name);
    if (error) throw error;
    return value;
  };
  return {
    name,
    model,
    capabilities,
    generateText: (request) =>
      act(
        {
          text: `from ${name}`,
          usage: { inputTokens: 1, outputTokens: 1 },
          provider: name,
          model,
          truncated: false,
        },
        request,
      ),
    generateStructured: ({ schema }) =>
      act({
        data: schema.parse({ ok: true }),
        usage: { inputTokens: 1, outputTokens: 1 },
        provider: name,
        model,
      }),
    stream: () =>
      act({
        deltas: (async function* () {
          yield `from ${name}`;
        })(),
        result: Promise.resolve({ usage: { inputTokens: 0, outputTokens: 0 }, truncated: false }),
        provider: name,
        model,
      }),
    ping: () => act(undefined),
  };
}

vi.mock("@/lib/ai/providers/openai", () => ({
  createOpenAIProvider: (_key: string, model: string) =>
    scripted("openai", model, {
      imageTypes: ["image/png", "image/jpeg"],
      maxImages: 16,
      maxInlineBytes: 20 * 1_048_576,
      pdf: true,
      structured: true,
    }),
}));
vi.mock("@/lib/ai/providers/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/providers/gemini")>();
  return {
    ...actual,
    createGeminiProvider: (_key: string, model: string) =>
      scripted("gemini", model, actual.GEMINI_CAPABILITIES),
  };
});
vi.mock("@/lib/ai/providers/openai-compatible", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/providers/openai-compatible")>();
  return {
    ...actual,
    createCompatibleProvider: (options: { name: CompatibleProviderName; model: string }) =>
      scripted(options.name, options.model, actual.capabilitiesFor(options.name, options.model)),
  };
});

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(behaviour)) delete behaviour[key as AIProviderName];
  setAIProviderForTesting(null);
});

afterEach(() => {
  setAIChainBudgetForTesting(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetEnvGroupCache();
});

const KEYS = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "HF_TOKEN",
  "AI_PROVIDER_ORDER",
  "AI_DOCUMENT_PROVIDERS",
  "OPENROUTER_MODEL",
  "OPENROUTER_ALLOW_PAID_MODELS",
  "HF_MODEL",
];

function configure(env: Record<string, string>) {
  for (const key of KEYS) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetEnvGroupCache();
}

const ALL_FREE = {
  GEMINI_API_KEY: "k-gemini",
  OPENROUTER_API_KEY: "k-or",
  GROQ_API_KEY: "k-groq",
  CEREBRAS_API_KEY: "k-cerebras",
  AI_PROVIDER_ORDER: "gemini,openrouter,groq,cerebras",
};

const text: AIRequest = { system: "s", messages: [{ role: "user", content: "hello" }] };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const withImage = (mimeType: string): AIRequest => ({
  system: "s",
  messages: [
    {
      role: "user",
      content: [
        { kind: "text", text: "describe" },
        { kind: "file", mimeType, data: PNG, filename: "photo" },
      ],
    },
  ],
  containsDocuments: true,
});

describe("AI configuration", () => {
  it("reports not configured when no key is set, and refuses to run", () => {
    configure({});
    expect(getAIConfiguration()).toEqual({
      configured: false,
      primary: null,
      fallback: null,
      fallbacks: [],
    });
    expect(() => getAIProvider()).toThrow(AIProviderError);
  });

  it("treats .env.example placeholders as not configured", () => {
    configure({ OPENAI_API_KEY: "sk-REPLACE_ME", GEMINI_API_KEY: "REPLACE_ME" });
    expect(getAIConfiguration().configured).toBe(false);
  });

  it("orders the legacy pair by AI_DEFAULT_PROVIDER", () => {
    configure({ OPENAI_API_KEY: "k1", GEMINI_API_KEY: "k2", AI_DEFAULT_PROVIDER: "gemini" });
    expect(getAIConfiguration()).toMatchObject({ primary: "gemini", fallbacks: ["openai"] });
  });

  it("never uses a free-tier provider whose key is set but which is not named in AI_PROVIDER_ORDER", () => {
    configure({ GEMINI_API_KEY: "k", GROQ_API_KEY: "k", OPENROUTER_API_KEY: "k" });
    expect(getAIConfiguration()).toMatchObject({ primary: "gemini", fallbacks: [] });
  });

  it("follows AI_PROVIDER_ORDER, skipping providers without a key", () => {
    configure({ ...ALL_FREE, CEREBRAS_API_KEY: "" });
    expect(getAIConfiguration()).toMatchObject({
      primary: "gemini",
      fallbacks: ["openrouter", "groq"],
    });
  });

  it("refuses an OpenRouter model that is not a free variant unless paid use is allowed", () => {
    const warn = vi.spyOn(logger, "warn");
    configure({ ...ALL_FREE, OPENROUTER_MODEL: "anthropic/some-paid-model" });
    expect(getAIConfiguration().fallbacks).not.toContain("openrouter");

    configure({
      ...ALL_FREE,
      OPENROUTER_MODEL: "anthropic/some-paid-model",
      OPENROUTER_ALLOW_PAID_MODELS: "true",
    });
    expect(getAIConfiguration().fallbacks).toContain("openrouter");
    expect(
      warn.mock.calls.some(([, message]) => String(message).includes("not a free variant")),
    ).toBe(true);
  });

  it("rejects an unknown provider name instead of guessing", () => {
    configure({ GEMINI_API_KEY: "k", AI_PROVIDER_ORDER: "gemini,gpt-free" });
    expect(getAIConfiguration().configured).toBe(false);
  });
});

describe("failover decisions", () => {
  it("moves on when the primary's daily quota is spent", async () => {
    configure(ALL_FREE);
    behaviour.gemini = "quota";
    const result = await getAIProvider().generateText(text);
    expect(result.text).toBe("from openrouter");
    expect(calls).toEqual(["gemini", "openrouter"]);
  });

  it("moves on past an outage and a timeout", async () => {
    configure(ALL_FREE);
    behaviour.gemini = "outage";
    behaviour.openrouter = "timeout";
    const stream = await getAIProvider().stream(text);
    expect(stream.provider).toBe("groq");
    expect(calls).toEqual(["gemini", "openrouter", "groq"]);
  });

  it.each(["refuse", "auth", "invalid"] as const)(
    "does not fail over on %s — another model would not fix it",
    async (mode) => {
      configure(ALL_FREE);
      behaviour.gemini = mode;
      await expect(getAIProvider().generateText(text)).rejects.toBeInstanceOf(AIProviderError);
      expect(calls).toEqual(["gemini"]);
    },
  );

  it("reports the last real failure when every provider is down", async () => {
    configure(ALL_FREE);
    behaviour.gemini = "quota";
    behaviour.openrouter = "quota";
    behaviour.groq = "outage";
    behaviour.cerebras = "quota";
    const error = await getAIProvider()
      .generateText(text)
      .catch((e: unknown) => e);
    expect(calls).toEqual(["gemini", "openrouter", "groq", "cerebras"]);
    expect(toAIApiError(error).message).toMatch(/usage limit for today/);
  });
});

describe("the intended chain: gemini → groq → huggingface", () => {
  const INTENDED = {
    GEMINI_API_KEY: "k-gemini",
    GROQ_API_KEY: "k-groq",
    HF_TOKEN: "k-hf",
    GROQ_MODEL: "openai/gpt-oss-120b",
    HF_MODEL: "openai/gpt-oss-120b:fastest",
    AI_DEFAULT_PROVIDER: "gemini",
    AI_PROVIDER_ORDER: "gemini,groq,huggingface",
  };

  it("is built in exactly that order", () => {
    configure(INTENDED);
    expect(getAIConfiguration()).toMatchObject({
      primary: "gemini",
      fallbacks: ["groq", "huggingface"],
    });
  });

  it("does not fall back when the primary answers", async () => {
    configure(INTENDED);
    expect((await getAIProvider().generateText(text)).text).toBe("from gemini");
    expect(calls).toEqual(["gemini"]);
  });

  it("answers from Groq when Gemini's quota is spent", async () => {
    configure(INTENDED);
    behaviour.gemini = "quota";
    const stream = await getAIProvider().stream(text);
    expect(stream.provider).toBe("groq");
    expect(calls).toEqual(["gemini", "groq"]);
  });

  it("answers from Hugging Face when Gemini and Groq both fail", async () => {
    configure(INTENDED);
    behaviour.gemini = "outage";
    behaviour.groq = "quota";
    expect((await getAIProvider().generateText(text)).text).toBe("from huggingface");
    expect(calls).toEqual(["gemini", "groq", "huggingface"]);
  });

  it("returns one controlled, non-sensitive error when all three fail", async () => {
    configure(INTENDED);
    behaviour.gemini = "quota";
    behaviour.groq = "timeout";
    behaviour.huggingface = "outage";
    const error = await getAIProvider()
      .generateText(text)
      .catch((e: unknown) => e);
    expect(calls).toEqual(["gemini", "groq", "huggingface"]);
    const api = toAIApiError(error);
    expect(api.status).toBe(503);
    expect(api.message).toMatch(/temporarily unavailable/);
  });

  it("stops at rejected credentials instead of trying Hugging Face", async () => {
    configure(INTENDED);
    behaviour.gemini = "quota";
    behaviour.groq = "auth";
    const error = await getAIProvider()
      .generateText(text)
      .catch((e: unknown) => e);
    expect(calls).toEqual(["gemini", "groq"]);
    expect(error).toMatchObject({ kind: "NOT_CONFIGURED", upstream: { status: 401 } });
  });

  it("stops at once when the caller cancels", async () => {
    configure(INTENDED);
    behaviour.gemini = "cancel";
    await expect(getAIProvider().generateText(text)).rejects.toMatchObject({ kind: "CANCELLED" });
    expect(calls).toEqual(["gemini"]);
  });

  it("bounds the whole chain: a spent budget ends with a timeout, not another provider", async () => {
    configure(INTENDED);
    setAIChainBudgetForTesting(40);
    behaviour.gemini = "hang";
    const error = await getAIProvider()
      .generateText(text)
      .catch((e: unknown) => e);
    expect(calls).toEqual(["gemini"]);
    expect(error).toMatchObject({
      kind: "TIMEOUT",
      upstream: { reason: "CHAIN_BUDGET_SPENT" },
    });
    expect(toAIApiError(error).status).toBe(503);
  });

  it("never sends vault documents to Groq or Hugging Face by default", async () => {
    configure(INTENDED);
    behaviour.gemini = "quota";
    await expect(
      getAIProvider().generateText({ ...text, containsDocuments: true }),
    ).rejects.toMatchObject({ kind: "RATE_LIMITED" });
    expect(calls).toEqual(["gemini"]);
  });

  it("never sends an image to the text-only Groq or Hugging Face models", async () => {
    configure({ ...INTENDED, AI_DOCUMENT_PROVIDERS: "gemini,groq,huggingface" });
    behaviour.gemini = "quota";
    await expect(getAIProvider().generateText(withImage("image/png"))).rejects.toMatchObject({
      kind: "RATE_LIMITED",
    });
    expect(calls).toEqual(["gemini"]);
  });
});

describe("what each provider may receive", () => {
  it("never sends an image to a text-only model", async () => {
    configure({
      ...ALL_FREE,
      AI_PROVIDER_ORDER: "gemini,groq,openrouter",
      AI_DOCUMENT_PROVIDERS: "gemini,groq,openrouter",
    });
    behaviour.gemini = "quota";
    const result = await getAIProvider().generateText(withImage("image/png"));
    // groq's gpt-oss-120b is text-only; OpenRouter's free Qwen reads PNG.
    expect(calls).toEqual(["gemini", "openrouter"]);
    expect(result.text).toBe("from openrouter");
  });

  it("never sends a HEIC photo to a model that cannot read HEIC", async () => {
    configure({ ...ALL_FREE, AI_DOCUMENT_PROVIDERS: "gemini,openrouter,groq,cerebras" });
    behaviour.gemini = "quota";
    const error = await getAIProvider()
      .generateText(withImage("image/heic"))
      .catch((e: unknown) => e);
    expect(calls).toEqual(["gemini"]);
    expect(error).toMatchObject({ kind: "RATE_LIMITED" });
  });

  it("keeps vault documents away from providers not approved for them", async () => {
    configure(ALL_FREE); // AI_DOCUMENT_PROVIDERS unset: only Gemini/OpenAI
    behaviour.gemini = "quota";
    const error = await getAIProvider()
      .generateText({ ...text, containsDocuments: true })
      .catch((e: unknown) => e);
    expect(calls).toEqual(["gemini"]);
    expect(toAIApiError(error).message).toMatch(/usage limit for today/);
  });

  it("says plainly when no approved provider exists at all", async () => {
    configure({ GROQ_API_KEY: "k", AI_PROVIDER_ORDER: "groq" });
    const error = await getAIProvider()
      .generateText({ ...text, containsDocuments: true })
      .catch((e: unknown) => e);
    expect(calls).toEqual([]);
    expect(error).toMatchObject({ kind: "UNSUPPORTED" });
    expect(toAIApiError(error)).toMatchObject({ status: 422 });
    expect(toAIApiError(error).message).toMatch(/approved to read vault documents/);
  });

  it("in production, sends vault documents to no provider until one is approved explicitly", async () => {
    configure({ GEMINI_API_KEY: "k-gemini", AI_PROVIDER_ORDER: "gemini" });
    vi.stubEnv("NODE_ENV", "production");

    const error = await getAIProvider()
      .generateText({ ...text, containsDocuments: true })
      .catch((e: unknown) => e);
    // Fail closed: nothing was called, and the user is told why.
    expect(calls).toEqual([]);
    expect(error).toMatchObject({ kind: "UNSUPPORTED" });
    expect(toAIApiError(error).message).toMatch(/approved to read vault documents/);

    // Chat without documents still works with the same key.
    await expect(getAIProvider().generateText(text)).resolves.toMatchObject({
      text: "from gemini",
    });
  });

  it("in production, uses exactly the providers an operator approved for documents", async () => {
    configure({
      GEMINI_API_KEY: "k-gemini",
      AI_PROVIDER_ORDER: "gemini",
      AI_DOCUMENT_PROVIDERS: "gemini",
    });
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      getAIProvider().generateText({ ...text, containsDocuments: true }),
    ).resolves.toMatchObject({ text: "from gemini" });
    expect(calls).toEqual(["gemini"]);
  });

  it.each(["quota", "outage"] as const)(
    "in production, a %s at the approved provider never moves vault documents to an unapproved fallback",
    async (mode) => {
      configure({
        GEMINI_API_KEY: "k-gemini",
        GROQ_API_KEY: "k-groq",
        HF_TOKEN: "k-hf",
        AI_PROVIDER_ORDER: "gemini,groq,huggingface",
        AI_DOCUMENT_PROVIDERS: "gemini",
      });
      vi.stubEnv("NODE_ENV", "production");
      behaviour.gemini = mode;

      const error = await getAIProvider()
        .stream({ ...text, containsDocuments: true })
        .catch((e: unknown) => e);
      expect(calls).toEqual(["gemini"]);
      expect(error).toMatchObject({ kind: mode === "quota" ? "RATE_LIMITED" : "UNAVAILABLE" });

      // The same outage still lets plain chat fall back.
      calls.length = 0;
      await expect(getAIProvider().stream(text)).resolves.toMatchObject({ provider: "groq" });
    },
  );

  it("skips models without structured output for document analyses", async () => {
    configure({
      HF_TOKEN: "k",
      HF_MODEL: "some/unverified-model",
      GEMINI_API_KEY: "k",
      AI_PROVIDER_ORDER: "huggingface,gemini",
    });
    const result = await getAIProvider().generateStructured({
      ...text,
      schema: z.object({ ok: z.boolean() }),
      schemaName: "x",
    });
    expect(calls).toEqual(["gemini"]);
    expect(result.provider).toBe("gemini");
  });
});

describe("logging", () => {
  it("records provider, model, duration and outcome — never the prompt", async () => {
    configure(ALL_FREE);
    behaviour.gemini = "quota";
    const warn = vi.spyOn(logger, "warn");
    const info = vi.spyOn(logger, "info");
    await getAIProvider().generateText({
      system: "secret system prompt",
      messages: [{ role: "user", content: "my account number is 12345678" }],
    });

    const failed = warn.mock.calls.find(([, message]) => message === "AI provider call failed");
    expect(failed?.[0]).toMatchObject({
      provider: "gemini",
      operation: "text",
      outcome: "failed",
      kind: "RATE_LIMITED",
      failover: true,
      upstream: { status: 429, quota: "requests-per-day" },
    });
    expect(typeof (failed?.[0] as { durationMs: number }).durationMs).toBe("number");
    const ok = info.mock.calls.find(([, message]) => message === "AI provider call");
    expect(ok?.[0]).toMatchObject({ provider: "openrouter", outcome: "success" });

    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    expect(logged).not.toMatch(/secret system prompt|12345678/);
  });
});

describe("API mapping", () => {
  it("maps provider failures to AI_UNAVAILABLE without leaking vendor text", () => {
    const outage = toAIApiError(
      new AIProviderError("UNAVAILABLE", "openai", "secret vendor detail"),
    );
    expect(outage.status).toBe(503);
    expect(outage.code).toBe("AI_UNAVAILABLE");
    expect(outage.message).not.toContain("secret vendor detail");

    expect(toAIApiError(new AIProviderError("NOT_CONFIGURED", null, "x")).details).toEqual({
      reason: "not_configured",
    });
    expect(toAIApiError(new AIProviderError("REFUSED", "gemini", "x")).status).toBe(422);
  });

  it("tells a per-minute limit apart from a spent daily quota", () => {
    const minute = toAIApiError(
      new AIProviderError("RATE_LIMITED", "groq", "x", {
        upstream: { status: 429, reason: null, quota: "requests-per-minute" },
      }),
    );
    expect(minute.message).toMatch(/busy right now/);
    const day = toAIApiError(
      new AIProviderError("RATE_LIMITED", "gemini", "x", {
        upstream: {
          status: 429,
          reason: null,
          quota: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
        },
      }),
    );
    expect(day.details).toEqual({ reason: "quota" });
  });

  it("explains an answer that was cut off mid-stream", () => {
    const error = toAIApiError(new AIProviderError("INTERRUPTED", "gemini", "x"));
    expect(error.details).toEqual({ reason: "interrupted" });
    expect(error.message).toMatch(/stopped partway/);
  });

  it("uses the real Gemini capability declaration", () => {
    expect(GEMINI_CAPABILITIES).toMatchObject({ pdf: true, structured: true });
    expect(capabilitiesFor("groq", "openai/gpt-oss-120b").imageTypes).toEqual([]);
    expect(capabilitiesFor("huggingface", "anything")).toMatchObject({
      imageTypes: [],
      structured: false,
    });
  });
});
