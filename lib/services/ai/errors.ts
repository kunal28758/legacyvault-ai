import "server-only";

import { AIProviderError } from "@/lib/ai/provider";
import { ApiError } from "@/lib/api/errors";

/**
 * Maps a provider failure to the API contract (api-contracts.md § AI): an
 * outage is 503 `AI_UNAVAILABLE` and leaves every non-AI feature untouched.
 * The vendor's own error text is never passed through — it can echo the
 * request, which may contain document content.
 */
export function toAIApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!(error instanceof AIProviderError)) return ApiError.internal(error);

  switch (error.kind) {
    case "NOT_CONFIGURED":
      return new ApiError(
        503,
        "AI_UNAVAILABLE",
        "AI features are not configured in this environment. An administrator needs to add an AI provider key.",
        { cause: error, details: { reason: "not_configured" } },
      );
    case "RATE_LIMITED":
      return new ApiError(
        503,
        "AI_UNAVAILABLE",
        "The AI service is busy right now. Try again in a minute.",
        {
          cause: error,
          details: { reason: "busy" },
        },
      );
    case "REFUSED":
      return new ApiError(
        422,
        "AI_UNAVAILABLE",
        "The AI service declined to process this request.",
        {
          cause: error,
          details: { reason: "refused" },
        },
      );
    case "INVALID_OUTPUT":
      return new ApiError(
        503,
        "AI_UNAVAILABLE",
        "The AI returned an answer that failed validation, so it was not used. Try again.",
        { cause: error, details: { reason: "invalid_output" } },
      );
    case "CANCELLED":
      return new ApiError(503, "AI_UNAVAILABLE", "The request was cancelled.", {
        cause: error,
        details: { reason: "cancelled" },
      });
    default:
      return new ApiError(
        503,
        "AI_UNAVAILABLE",
        "The AI service is temporarily unavailable. Everything else in LegacyVault still works — try again shortly.",
        { cause: error, details: { reason: "unavailable" } },
      );
  }
}

/** Shown with every AI answer (FR-L007, FR-R009). */
export const AI_DISCLAIMER =
  "AI-generated guidance, not legal or financial advice. Check important details against the original and consult a qualified professional before acting.";
