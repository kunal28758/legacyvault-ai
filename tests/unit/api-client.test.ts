import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ReverificationRequiredError, apiClient } from "@/lib/client/api-client";
import { shouldRetry } from "@/lib/client/query-client";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Correlation-ID": "corr-1", ...headers },
  });
}

describe("api client (T013)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends same-origin JSON requests under /api/v1 and unwraps the envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: true, data: { id: "1" }, meta: { total: 1 } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiClient.get<{ id: string }>("/users/me", { query: { page: 1 } });

    expect(result.data).toEqual({ id: "1" });
    expect(result.meta?.correlationId).toBe("corr-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/users/me?page=1");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  it("maps 429 to ApiError with Retry-After seconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            429,
            { success: false, error: { code: "RATE_LIMITED", message: "Slow down" } },
            { "Retry-After": "30" },
          ),
        ),
    );
    await expect(apiClient.post("/beneficiaries", {})).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 30,
    });
  });

  it("re-throws REVERIFICATION_REQUIRED as a typed error the re-auth gate can catch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          success: false,
          error: {
            code: "REVERIFICATION_REQUIRED",
            message: "Verify it is you",
            details: { level: "multi_factor" },
          },
        }),
      ),
    );
    const error = await apiClient.get("/assets/digital/1/decrypt").catch((cause) => cause);
    expect(error).toBeInstanceOf(ReverificationRequiredError);
    expect((error as ReverificationRequiredError).level).toBe("multi_factor");
  });

  it("exposes 422 field errors without echoing raw input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid",
            fields: { email: ["Invalid email"] },
          },
        }),
      ),
    );
    const error = await apiClient.patch("/users/me", { email: "x" }).catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fields).toEqual({ email: ["Invalid email"] });
  });

  it("never retries 4xx errors but retries transport failures twice (T014)", () => {
    const forbidden = new ApiError(403, { code: "FORBIDDEN", message: "no" });
    const network = new ApiError(0, { code: "NETWORK_ERROR", message: "offline" });
    expect(shouldRetry(0, forbidden)).toBe(false);
    expect(shouldRetry(0, network)).toBe(true);
    expect(shouldRetry(2, network)).toBe(false);
  });
});
