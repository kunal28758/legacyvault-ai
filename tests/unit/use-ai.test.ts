import { afterEach, describe, expect, it, vi } from "vitest";

import { streamAI } from "@/hooks/use-ai";

describe("streamAI", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails a response that never finishes instead of leaving the chat streaming", async () => {
    vi.useFakeTimers();
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("timeout", "TimeoutError")),
            );
          }),
      ),
    );

    const request = streamAI("/ai/assistant/message", { message: "hello" }, { onDelta: vi.fn() });
    const assertion = expect(request).rejects.toMatchObject({
      status: 504,
      code: "INVALID_RESPONSE",
      message: "The AI answer took too long to finish. Try again.",
    });
    setTimeout(() => timeoutController.abort(), 160_000);
    await vi.advanceTimersByTimeAsync(160_000);

    await assertion;
  });

  it("preserves an explicit user cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );

    const request = streamAI(
      "/ai/assistant/message",
      { message: "hello" },
      { signal: controller.signal, onDelta: vi.fn() },
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
