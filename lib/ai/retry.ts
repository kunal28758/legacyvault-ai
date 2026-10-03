import "server-only";

import { AIProviderError } from "./provider";

/**
 * Bounded retries for one provider (ADR-008).
 *
 * Only failures that can clear within seconds are retried on the same
 * provider: a 5xx, a timeout, a dropped connection — and a per-minute limit the
 * vendor says will lift almost at once. A spent daily quota, a rejected key, an
 * invalid request or a refusal is returned at once, so the factory can move to
 * the next provider (or report the failure) instead of waiting on a lost cause.
 *
 * Delays grow exponentially with full jitter and are capped; the caller's abort
 * signal ends both the waiting and the retries.
 */
export interface RetryPolicy {
  /** Attempts including the first. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Longest vendor-requested wait honoured on the same provider. */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  maxRetryAfterMs: 5_000,
};

/** How long to wait before retrying `error`, or null when it must not be retried. */
export function retryDelayFor(
  error: unknown,
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number | null {
  if (!(error instanceof AIProviderError)) return null;
  if (error.kind === "UNAVAILABLE" || error.kind === "TIMEOUT") {
    const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
    return Math.round(ceiling / 2 + random() * (ceiling / 2));
  }
  if (error.kind === "RATE_LIMITED") {
    // Only a short, per-minute wait the vendor named is worth sitting out here.
    const quota = error.upstream?.quota ?? "";
    const seconds = error.upstream?.retryAfterSeconds;
    if (!/per[- ]?minute/i.test(quota) || seconds == null) return null;
    const ms = seconds * 1_000;
    return ms <= policy.maxRetryAfterMs ? ms + Math.round(random() * 250) : null;
  }
  return null;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Runs `call`, retrying per `retryDelayFor`. Errors reaching here are already mapped. */
export async function withRetry<T>(
  call: () => Promise<T>,
  options: { signal?: AbortSignal; policy?: RetryPolicy } = {},
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const delay = attempt < policy.attempts ? retryDelayFor(error, attempt, policy) : null;
      if (delay === null || options.signal?.aborted) throw error;
      await pause(delay, options.signal).catch(() => {
        throw error;
      });
    }
  }
}
