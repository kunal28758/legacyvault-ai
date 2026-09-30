import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { getAIConfiguration, getAIProvider, setAIProviderForTesting } from "@/lib/ai";
import { AIProviderError, type AIProvider } from "@/lib/ai/provider";
import { resetEnvGroupCache } from "@/lib/config/env";
import { toAIApiError } from "@/lib/services/ai/errors";

/**
 * The provider factory (ADR-008 § 1): configuration, fallback on outage, and
 * the mapping of provider failures to the API contract. Vendor SDKs are
 * replaced by scripted test doubles; nothing here reaches a network.
 */
const calls: string[] = [];
let openaiBehaviour: "ok" | "outage" | "refuse" = "ok";

function scripted(
  name: "openai" | "gemini",
  behaviour: () => "ok" | "outage" | "refuse",
): AIProvider {
  const act = async <T>(value: T): Promise<T> => {
    calls.push(name);
    const mode = behaviour();
    if (mode === "outage") throw new AIProviderError("UNAVAILABLE", name, "down");
    if (mode === "refuse") throw new AIProviderError("REFUSED", name, "no");
    return value;
  };
  return {
    name,
    model: `${name}-model`,
    generateText: () =>
      act({
        text: `from ${name}`,
        usage: { inputTokens: 1, outputTokens: 1 },
        provider: name,
        model: `${name}-model`,
        truncated: false,
      }),
    generateStructured: ({ schema }) =>
      act({
        data: schema.parse({ ok: true }),
        usage: { inputTokens: 1, outputTokens: 1 },
        provider: name,
        model: `${name}-model`,
      }),
    stream: () =>
      act({
        deltas: (async function* () {})(),
        result: Promise.resolve({ usage: { inputTokens: 0, outputTokens: 0 }, truncated: false }),
        provider: name,
        model: `${name}-model`,
      }),
    ping: () => act(undefined),
  };
}

vi.mock("@/lib/ai/providers/openai", () => ({
  createOpenAIProvider: () => scripted("openai", () => openaiBehaviour),
}));
vi.mock("@/lib/ai/providers/gemini", () => ({
  createGeminiProvider: () => scripted("gemini", () => "ok"),
}));

beforeEach(() => {
  calls.length = 0;
  openaiBehaviour = "ok";
  setAIProviderForTesting(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvGroupCache();
});

function configure(env: Record<string, string>) {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetEnvGroupCache();
}

describe("AI configuration", () => {
  it("reports not configured when no key is set, and refuses to run", () => {
    configure({});
    expect(getAIConfiguration()).toEqual({ configured: false, primary: null, fallback: null });
    expect(() => getAIProvider()).toThrow(AIProviderError);
  });

  it("treats .env.example placeholders as not configured", () => {
    configure({ OPENAI_API_KEY: "sk-REPLACE_ME", GEMINI_API_KEY: "REPLACE_ME" });
    expect(getAIConfiguration().configured).toBe(false);
  });

  it("orders providers by AI_DEFAULT_PROVIDER", () => {
    configure({ OPENAI_API_KEY: "k1", GEMINI_API_KEY: "k2", AI_DEFAULT_PROVIDER: "gemini" });
    expect(getAIConfiguration()).toEqual({
      configured: true,
      primary: "gemini",
      fallback: "openai",
    });
  });
});

describe("fallback", () => {
  it("uses the fallback provider when the primary has an outage", async () => {
    configure({ OPENAI_API_KEY: "k1", GEMINI_API_KEY: "k2" });
    openaiBehaviour = "outage";
    const result = await getAIProvider().generateText({ system: "s", messages: [] });
    expect(result.text).toBe("from gemini");
    expect(calls).toEqual(["openai", "gemini"]);
  });

  it("does not retry a refusal on the other provider", async () => {
    configure({ OPENAI_API_KEY: "k1", GEMINI_API_KEY: "k2" });
    openaiBehaviour = "refuse";
    await expect(
      getAIProvider().generateStructured({
        system: "s",
        messages: [],
        schema: z.object({ ok: z.boolean() }),
        schemaName: "x",
      }),
    ).rejects.toMatchObject({ kind: "REFUSED" });
    expect(calls).toEqual(["openai"]);
  });

  it("a single configured provider has no fallback", async () => {
    configure({ OPENAI_API_KEY: "k1" });
    openaiBehaviour = "outage";
    await expect(getAIProvider().generateText({ system: "s", messages: [] })).rejects.toMatchObject(
      {
        kind: "UNAVAILABLE",
      },
    );
    expect(calls).toEqual(["openai"]);
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
});
