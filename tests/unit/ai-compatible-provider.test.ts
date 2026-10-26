// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AIProviderError, type AIRequest } from "@/lib/ai/provider";
import {
  createCompatibleProvider,
  type CompatibleProviderName,
} from "@/lib/ai/providers/openai-compatible";
import { retryDelayFor } from "@/lib/ai/retry";

/**
 * The OpenAI-compatible adapter (OpenRouter, Groq, Cerebras, Hugging Face)
 * against the real `openai` SDK, with only `fetch` scripted. Deterministic
 * failure paths — these prove the adapter's behaviour, not that any vendor is
 * reachable from here (no vendor key is configured in this environment).
 */
const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  fetchMock.mockReset();
  vi.useRealTimers();
});

function provider(name: CompatibleProviderName, model: string) {
  return createCompatibleProvider({ name, apiKey: "test-key", model, fetch: fetchMock });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function completion(content: string, finish = "stop") {
  return json({
    id: "c1",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
    usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
  });
}

function sse(chunks: { content?: string; finish?: string }[], done = true) {
  const lines = chunks.map(
    (chunk) =>
      `data: ${JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "m",
        choices: [
          {
            index: 0,
            delta: chunk.content ? { content: chunk.content } : {},
            finish_reason: chunk.finish ?? null,
          },
        ],
      })}\n\n`,
  );
  return new Response(lines.join("") + (done ? "data: [DONE]\n\n" : ""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function vendorError(status: number, message: string, code: string | null, headers = {}) {
  return json({ error: { message, type: "error", code } }, status, headers);
}

const request: AIRequest = { system: "Be brief.", messages: [{ role: "user", content: "2 + 2?" }] };

async function bodyOf(call = 0): Promise<Record<string, unknown>> {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

/** Runs a call while fake time passes, so retry back-off costs nothing. */
async function withBackoff<T>(call: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const settled = call().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(30_000);
  const outcome = await settled;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

describe("requests", () => {
  it("sends Groq a chat completion with the system prompt and its output-limit parameter", async () => {
    fetchMock.mockResolvedValue(completion("4"));
    const result = await provider("groq", "openai/gpt-oss-120b").generateText({
      ...request,
      maxOutputTokens: 321,
    });

    expect(result).toMatchObject({ text: "4", provider: "groq", model: "openai/gpt-oss-120b" });
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 2 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.groq.com/openai/v1/chat/completions",
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    const body = await bodyOf();
    expect(body).toMatchObject({ model: "openai/gpt-oss-120b", max_completion_tokens: 321 });
    expect(body.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "2 + 2?" },
    ]);
  });

  it("sends an image to OpenRouter as a base64 data URL, with its own endpoint and limit name", async () => {
    fetchMock.mockResolvedValue(completion("A tax notice."));
    await provider("openrouter", "qwen/qwen3.8-27b:free").generateText({
      system: "s",
      messages: [
        {
          role: "user",
          content: [
            { kind: "text", text: "What is this?" },
            {
              kind: "file",
              mimeType: "image/png",
              data: new Uint8Array([1, 2, 3]),
              filename: "a.png",
            },
          ],
        },
      ],
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    const body = await bodyOf();
    expect(body).toHaveProperty("max_tokens");
    expect((body.messages as { content: unknown }[])[1]?.content).toEqual([
      { type: "text", text: "What is this?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ]);
  });

  it("refuses to send a PDF to a model that only reads text and images", async () => {
    const error = await provider("cerebras", "qwen-3.8-27b")
      .generateText({
        system: "s",
        messages: [
          {
            role: "user",
            content: [
              {
                kind: "file",
                mimeType: "application/pdf",
                data: new Uint8Array(1),
                filename: "x.pdf",
              },
            ],
          },
        ],
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "UNSUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns structured output only after it validates against the schema", async () => {
    fetchMock.mockResolvedValueOnce(completion('{"ok":true}'));
    const schema = z.object({ ok: z.boolean() });
    const result = await provider("cerebras", "gpt-oss-120b").generateStructured({
      ...request,
      schema,
      schemaName: "check",
    });
    expect(result.data).toEqual({ ok: true });
    expect((await bodyOf()).response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "check", strict: false },
    });

    fetchMock.mockResolvedValueOnce(completion('{"ok":"yes"}'));
    await expect(
      provider("cerebras", "gpt-oss-120b").generateStructured({
        ...request,
        schema,
        schemaName: "c",
      }),
    ).rejects.toMatchObject({ kind: "INVALID_OUTPUT" });
  });

  it("will not ask an unverified model for structured output", async () => {
    await expect(
      provider("huggingface", "someone/unverified").generateStructured({
        ...request,
        schema: z.object({}),
        schemaName: "x",
      }),
    ).rejects.toMatchObject({ kind: "UNSUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a content-filter stop as a refusal and a length stop as truncated", async () => {
    fetchMock.mockResolvedValueOnce(completion("", "content_filter"));
    await expect(
      provider("groq", "openai/gpt-oss-20b").generateText(request),
    ).rejects.toMatchObject({
      kind: "REFUSED",
    });
    fetchMock.mockResolvedValueOnce(completion("long…", "length"));
    expect((await provider("groq", "openai/gpt-oss-20b").generateText(request)).truncated).toBe(
      true,
    );
  });
});

describe("streaming", () => {
  it("yields deltas in order", async () => {
    fetchMock.mockResolvedValue(
      sse([{ content: "2 + 2 " }, { content: "= 4." }, { finish: "stop" }]),
    );
    const stream = await provider("groq", "openai/gpt-oss-120b").stream(request);
    let text = "";
    for await (const delta of stream.deltas) text += delta;
    expect(text).toBe("2 + 2 = 4.");
    await expect(stream.result).resolves.toMatchObject({ truncated: false });
    expect(await bodyOf()).toMatchObject({ stream: true });
  });

  it("reports a stream that stops after part of the answer as interrupted", async () => {
    fetchMock.mockResolvedValue(sse([{ content: "The policy expires on" }], false));
    const stream = await provider("openrouter", "qwen/qwen3.8-27b:free").stream(request);
    const seen: string[] = [];
    const error = await (async () => {
      for await (const delta of stream.deltas) seen.push(delta);
    })().catch((e: unknown) => e);
    expect(seen).toEqual(["The policy expires on"]);
    expect(error).toMatchObject({ kind: "INTERRUPTED", provider: "openrouter" });
    await expect(stream.result).rejects.toMatchObject({ kind: "INTERRUPTED" });
  });

  it("reports an empty stream that never finishes as a malformed reply", async () => {
    fetchMock.mockResolvedValue(sse([], false));
    const stream = await provider("groq", "openai/gpt-oss-120b").stream(request);
    const error = await (async () => {
      for await (const _ of stream.deltas) void _;
    })().catch((e: unknown) => e);
    expect(error).toMatchObject({
      kind: "UNAVAILABLE",
      upstream: { reason: "MALFORMED_RESPONSE" },
    });
  });
});

describe("rate limits — a 429 means different things per vendor", () => {
  it("Groq: an exhausted request budget is per DAY and is not retried", async () => {
    fetchMock.mockResolvedValue(
      vendorError(429, "Rate limit reached … secret prompt echo", "rate_limit_exceeded", {
        "retry-after": "3000",
        "x-ratelimit-remaining-requests": "0",
      }),
    );
    const error = await provider("groq", "openai/gpt-oss-120b")
      .generateText(request)
      .catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      kind: "RATE_LIMITED",
      upstream: {
        status: 429,
        reason: "rate_limit_exceeded",
        quota: "requests-per-day",
        retryAfterSeconds: 3000,
      },
    });
    expect(JSON.stringify(error)).not.toContain("secret prompt echo");
    expect((error as Error).message).not.toContain("secret prompt echo");
    expect((error as Error).cause).toBeUndefined();
  });

  it("Groq: a short per-minute token limit is waited out once, then answered", async () => {
    fetchMock
      .mockResolvedValueOnce(
        vendorError(429, "tokens per minute", "rate_limit_exceeded", {
          "retry-after": "2",
          "x-ratelimit-remaining-tokens": "0",
          "x-ratelimit-remaining-requests": "900",
        }),
      )
      .mockResolvedValueOnce(completion("4"));
    const result = await withBackoff(() =>
      provider("groq", "openai/gpt-oss-120b").generateText(request),
    );
    expect(result.text).toBe("4");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("OpenRouter: free-models-per-day is a daily quota", async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: {
            code: 429,
            message:
              "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
            metadata: { headers: { "X-RateLimit-Limit": "50", "X-RateLimit-Remaining": "0" } },
          },
        },
        429,
      ),
    );
    const error = await provider("openrouter", "qwen/qwen3.8-27b:free")
      .generateText(request)
      .catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ kind: "RATE_LIMITED", upstream: { quota: "requests-per-day" } });
  });

  it("Cerebras: a named daily window is recognised from its headers", async () => {
    fetchMock.mockResolvedValue(
      vendorError(429, "Too many tokens", null, { "x-ratelimit-remaining-tokens-day": "0" }),
    );
    const error = await provider("cerebras", "gpt-oss-120b")
      .generateText(request)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ upstream: { quota: "tokens-per-day" } });
  });

  it("a long per-minute wait is not sat out on the same provider", () => {
    const error = new AIProviderError("RATE_LIMITED", "groq", "x", {
      upstream: { status: 429, reason: null, quota: "requests-per-minute", retryAfterSeconds: 45 },
    });
    expect(retryDelayFor(error, 1)).toBeNull();
  });
});

describe("other failures", () => {
  it("retries a 5xx with back-off and gives up after three attempts", async () => {
    fetchMock.mockImplementation(async () => vendorError(503, "overloaded", null));
    const error = await withBackoff(() =>
      provider("cerebras", "gpt-oss-120b").generateText(request),
    ).catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error).toMatchObject({ kind: "UNAVAILABLE", upstream: { status: 503 } });
  });

  it("recovers when a retry succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(vendorError(502, "bad gateway", null))
      .mockResolvedValueOnce(completion("4"));
    const result = await withBackoff(() =>
      provider("groq", "openai/gpt-oss-120b").generateText(request),
    );
    expect(result.text).toBe("4");
  });

  it("treats a 413 rate_limit_exceeded response as a retryable rate limit", async () => {
    fetchMock.mockResolvedValue(
      vendorError(413, "Rate limit reached", "rate_limit_exceeded", {
        "retry-after": "19",
        "x-ratelimit-remaining-requests": "0",
      }),
    );

    const error = await provider("groq", "openai/gpt-oss-120b")
      .generateText(request)
      .catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      kind: "RATE_LIMITED",
      upstream: {
        status: 413,
        reason: "rate_limit_exceeded",
        retryAfterSeconds: 19,
      },
    });
    expect((error as AIProviderError).retryableElsewhere).toBe(true);
  });

  it.each([
    [400, "REFUSED"],
    [401, "NOT_CONFIGURED"],
    [404, "NOT_CONFIGURED"],
    [413, "REFUSED"],
  ])("does not retry a %i", async (status, kind) => {
    fetchMock.mockResolvedValue(vendorError(status, "vendor text", "some_code"));
    const error = await provider("groq", "openai/gpt-oss-120b")
      .generateText(request)
      .catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ kind, upstream: { status } });
  });

  it("treats an OpenRouter 402 (no credit) as a spent quota, so the chain can move on", async () => {
    fetchMock.mockResolvedValue(vendorError(402, "Insufficient credits", null));
    const error = await provider("openrouter", "qwen/qwen3.8-27b:free")
      .generateText(request)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "RATE_LIMITED", upstream: { quota: "credits" } });
    expect((error as AIProviderError).retryableElsewhere).toBe(true);
  });

  it("treats a reply that is not JSON as malformed", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response("<html>gateway error</html>", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const error = await withBackoff(() =>
      provider("groq", "openai/gpt-oss-120b").generateText(request),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "UNAVAILABLE" });
    expect(JSON.stringify(error)).not.toContain("gateway error");
  });

  it("maps a dropped connection to a retryable outage", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const error = await withBackoff(() =>
      provider("groq", "openai/gpt-oss-120b").generateText(request),
    ).catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error).toMatchObject({ kind: "UNAVAILABLE", upstream: { reason: "CONNECTION_FAILED" } });
  });

  it("stops at once when the caller cancels", async () => {
    const abort = new AbortController();
    fetchMock.mockImplementation(async (_url, init) => {
      abort.abort();
      throw (
        (init?.signal as AbortSignal | undefined)?.reason ??
        new DOMException("aborted", "AbortError")
      );
    });
    const error = await provider("groq", "openai/gpt-oss-120b")
      .generateText({ ...request, signal: abort.signal })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "CANCELLED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
