// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIProviderError } from "@/lib/ai/provider";
import { createGeminiProvider } from "@/lib/ai/providers/gemini";
import { toAIApiError } from "@/lib/services/ai/errors";

/**
 * The Gemini provider against the real `@google/genai` SDK, with only `fetch`
 * scripted — so what is tested is the configuration the application actually
 * ships: retry of transient vendor failures, which key is sent, and how a
 * vendor failure is described without its free-text message.
 *
 * Root cause this guards (2026-10-02): `gemini-3.8-flash` answered bursts of
 * 503 UNAVAILABLE ("high demand"); the provider made one attempt, so every
 * burst reached the user as "The AI service is temporarily unavailable".
 */
const MODEL = "gemini-3.8-flash";

const HIGH_DEMAND = JSON.stringify({
  error: {
    code: 503,
    message:
      "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
    status: "UNAVAILABLE",
  },
});

function failure(status: number, reason: string, message = "vendor detail echoing the request") {
  return new Response(JSON.stringify({ error: { code: status, message, status: reason } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function answer(text: string) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function streamed(...texts: string[]) {
  const body = texts
    .map(
      (text, index) =>
        `data: ${JSON.stringify({
          candidates: [
            {
              content: { role: "model", parts: [{ text }] },
              ...(index === texts.length - 1 ? { finishReason: "STOP" } : {}),
            },
          ],
        })}\r\n\r\n`,
    )
    .join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // The SDK warns when both variables exist; keep the output clean.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const request = { system: "Be brief.", messages: [{ role: "user" as const, content: "2 + 2?" }] };

/** Runs a call while fake time passes, so backoff delays cost nothing. */
async function withBackoff<T>(call: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const settled = call().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  const outcome = await settled;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

describe("Gemini provider — transient failures", () => {
  it("retries a 503 'high demand' answer and returns the real reply", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(HIGH_DEMAND, { status: 503 }))
      .mockResolvedValueOnce(answer("4"));

    const provider = createGeminiProvider("test-key", MODEL);
    const result = await withBackoff(() => provider.generateText(request));

    expect(result.text).toBe("4");
    expect(result.model).toBe(MODEL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a stream before its first token", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(HIGH_DEMAND, { status: 503 }))
      .mockResolvedValueOnce(new Response(HIGH_DEMAND, { status: 503 }))
      .mockResolvedValueOnce(streamed("2 + 2 ", "= 4."));

    const provider = createGeminiProvider("test-key", MODEL);
    const stream = await withBackoff(() => provider.stream(request));
    let text = "";
    for await (const delta of stream.deltas) text += delta;

    expect(text).toBe("2 + 2 = 4.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after a bounded number of attempts and reports the upstream status only", async () => {
    fetchMock.mockImplementation(async () => new Response(HIGH_DEMAND, { status: 503 }));

    const provider = createGeminiProvider("test-key", MODEL);
    const error = await withBackoff(() => provider.generateText(request)).catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(error).toBeInstanceOf(AIProviderError);
    expect(error).toMatchObject({
      kind: "UNAVAILABLE",
      provider: "gemini",
      upstream: { status: 503, reason: "UNAVAILABLE" },
    });
    // The vendor's free-text message is neither the message nor a logged cause.
    const failure = error as AIProviderError;
    expect(failure.message).not.toContain("high demand");
    expect(failure.cause).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain("high demand");
  });
});

describe("Gemini provider — failures that must not be retried", () => {
  it("does not retry a rejected request, and keeps no vendor text", async () => {
    fetchMock.mockResolvedValue(failure(400, "INVALID_ARGUMENT", "secret prompt text"));

    const error = await createGeminiProvider("test-key", MODEL)
      .generateText(request)
      .catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      kind: "REFUSED",
      upstream: { status: 400, reason: "INVALID_ARGUMENT" },
    });
    expect(JSON.stringify(error)).not.toContain("secret prompt text");
    expect((error as Error).message).not.toContain("secret prompt text");
  });

  it("does not retry a spent quota — backoff cannot outlast it", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: "You exceeded your current quota for prompt text …",
            status: "RESOURCE_EXHAUSTED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                violations: [
                  {
                    quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                    quotaValue: "250",
                  },
                ],
              },
              { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "41.5s" },
            ],
          },
        }),
        { status: 429 },
      ),
    );

    const error = await createGeminiProvider("test-key", MODEL)
      .generateText(request)
      .catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      kind: "RATE_LIMITED",
      upstream: {
        status: 429,
        reason: "RESOURCE_EXHAUSTED",
        quota: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
        quotaLimit: 250,
        retryAfterSeconds: 42,
      },
    });
    expect(JSON.stringify(error)).not.toContain("prompt text");

    // A daily quota is not described as "busy, try again in a minute".
    const api = toAIApiError(error);
    expect(api.details).toEqual({ reason: "quota" });
    expect(api.message).toMatch(/usage limit for today/);
  });

  it("reports an unknown model as a configuration problem, not an outage", async () => {
    fetchMock.mockResolvedValue(failure(404, "NOT_FOUND"));

    const error = await createGeminiProvider("test-key", "gemini-typo")
      .generateText(request)
      .catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ kind: "NOT_CONFIGURED", upstream: { status: 404 } });
  });

  it("reports rejected credentials as a configuration problem", async () => {
    fetchMock.mockResolvedValue(failure(403, "PERMISSION_DENIED"));

    const error = await createGeminiProvider("bad-key", MODEL)
      .generateText(request)
      .catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      kind: "NOT_CONFIGURED",
      upstream: { status: 403, reason: "PERMISSION_DENIED" },
    });
  });
});

describe("Gemini provider — a stream cut off mid-answer", () => {
  it("reports it as interrupted (seen live as 'Incomplete JSON segment'), not as an outage", async () => {
    const first = `data: ${JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "2 + 2 = 4. Let me" }] } }],
    })}



`;
    // The connection closes in the middle of the next event.
    fetchMock.mockResolvedValue(
      new Response(first + 'data: {"candidates":[{"content":', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const stream = await createGeminiProvider("test-key", MODEL).stream(request);
    const seen: string[] = [];
    const error = await (async () => {
      for await (const delta of stream.deltas) seen.push(delta);
    })().catch((e: unknown) => e);

    expect(seen).toEqual(["2 + 2 = 4. Let me"]);
    expect(error).toMatchObject({ kind: "INTERRUPTED", provider: "gemini" });
    expect(toAIApiError(error).details).toEqual({ reason: "interrupted" });
  });
});

describe("Gemini provider — credentials", () => {
  it("sends the configured GEMINI_API_KEY even when GOOGLE_API_KEY is also set", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "global-google-key");
    fetchMock.mockResolvedValue(answer("ok"));

    await createGeminiProvider("configured-gemini-key", MODEL).generateText(request);

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("configured-gemini-key");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`models/${MODEL}:generateContent`);
  });
});
