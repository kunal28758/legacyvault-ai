// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenAIProvider } from "@/lib/ai/providers/openai";

/**
 * The OpenAI provider's failure mapping, against the real `openai` SDK with
 * only `fetch` scripted. Like Gemini, a vendor HTTP failure must be described
 * by status and machine-readable code — never carried as its free-text
 * message, which can echo the request and would otherwise reach the logs.
 */
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function failure(status: number, code: string, message = "vendor text echoing the prompt") {
  return new Response(JSON.stringify({ error: { message, type: "error", code } }), {
    status,
    // No wait between the SDK's own retry attempts.
    headers: { "Content-Type": "application/json", "retry-after-ms": "0" },
  });
}

const request = { system: "s", messages: [{ role: "user" as const, content: "hi" }] };

describe("OpenAI provider — failures", () => {
  it.each([
    [429, "rate_limit_exceeded", "RATE_LIMITED"],
    [401, "invalid_api_key", "NOT_CONFIGURED"],
    [404, "model_not_found", "NOT_CONFIGURED"],
    [400, "invalid_request_error", "REFUSED"],
    [503, "server_error", "UNAVAILABLE"],
  ])("maps %i %s to %s without keeping the vendor's message", async (status, code, kind) => {
    fetchMock.mockImplementation(async () => failure(status, code));

    const error = await createOpenAIProvider("sk-test", "gpt-test")
      .generateText(request)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ kind, provider: "openai", upstream: { status, reason: code } });
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("echoing the prompt");
    expect((error as Error).message).not.toContain("echoing the prompt");
  });
});
