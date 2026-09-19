"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/shared/error-state";

/** Route-group error boundary: safe message, retry, no internals (constitution X). */
export default function DashboardGroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry capture is wired in T188; until then keep the console signal for local debugging.
    console.error("[dashboard] route error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <ErrorState
        title="This page hit a problem"
        description="Nothing was changed. You can retry, or head back to the dashboard."
        onRetry={reset}
        correlationId={error.digest}
        className="w-full max-w-lg"
      />
    </div>
  );
}
