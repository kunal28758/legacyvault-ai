import "server-only";

import { AIProviderError, isDailyQuota } from "@/lib/ai/provider";
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
        "AI features are not configured correctly in this environment. An administrator needs to check the AI provider key and model.",
        { cause: error, details: { reason: "not_configured" } },
      );
    case "RATE_LIMITED":
      // A spent daily quota will not clear "in a minute"; say so honestly.
      if (isDailyQuota(error.upstream)) {
        return new ApiError(
          503,
          "AI_UNAVAILABLE",
          "The AI service has reached its usage limit for today. Everything else in LegacyVault still works — try again later.",
          { cause: error, details: { reason: "quota" } },
        );
      }
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
    case "INTERRUPTED":
      return new ApiError(
        503,
        "AI_UNAVAILABLE",
        "The AI service stopped partway through this answer, so it may be incomplete. Try again.",
        { cause: error, details: { reason: "interrupted" } },
      );
    case "UNSUPPORTED":
      return new ApiError(422, "AI_UNAVAILABLE", error.message, {
        cause: error,
        details: { reason: "unsupported" },
      });
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
