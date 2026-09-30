"use client";

import { useCallback } from "react";
import { useClerk } from "@clerk/nextjs";

import { ReverificationRequiredError } from "@/lib/client/api-client";

/**
 * The step-up re-authentication gate (FR-A018).
 *
 * Sensitive endpoints — decrypting a field, checking in, recovering a release,
 * deciding an emergency request, resending a link — answer 403
 * `REVERIFICATION_REQUIRED` once Clerk's verification window has lapsed. This
 * turns that answer into the prompt the person expects: Clerk's own
 * verification modal, then the original request again, exactly once.
 *
 * `__internal_openReverification` is the same entry point Clerk's own
 * `useReverification()` uses. It is called from this one module so that a
 * rename in the SDK is a single edit rather than a search across the app.
 */
export class ReverificationCancelledError extends Error {
  constructor() {
    super("Verification was cancelled.");
    this.name = "ReverificationCancelledError";
  }
}

export function useReverifiedAction(): <T>(action: () => Promise<T>) => Promise<T> {
  const clerk = useClerk();

  return useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (!(error instanceof ReverificationRequiredError)) throw error;

        await new Promise<void>((resolve, reject) => {
          clerk.__internal_openReverification({
            level: error.level === "multi_factor" ? "multi_factor" : "first_factor",
            afterVerification: resolve,
            afterVerificationCancelled: () => reject(new ReverificationCancelledError()),
          });
        });

        // Verified now — retry once. A second refusal is a real failure.
        return action();
      }
    },
    [clerk],
  );
}

/** True when the person closed the verification modal instead of completing it. */
export function isReverificationCancelled(error: unknown): boolean {
  return error instanceof ReverificationCancelledError;
}
