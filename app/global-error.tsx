"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * The last boundary: an error in the root layout itself.
 *
 * It replaces the whole document, so it ships its own `<html>` and no imports
 * from the design system — whatever failed may be the reason the rest cannot
 * render. Plain markup, honest wording, one way forward.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0b1020",
          color: "#e2e8f0",
          fontFamily: "Segoe UI, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <p style={{ fontSize: "13px", letterSpacing: "0.08em", color: "#818cf8", margin: 0 }}>
            LEGACYVAULT AI
          </p>
          <h1 style={{ fontSize: "24px", margin: "12px 0" }}>Something went wrong</h1>
          <p style={{ fontSize: "15px", lineHeight: "24px", color: "#94a3b8" }}>
            Nothing in your vault was changed. Reloading usually resolves it; if it does not, the
            reference below identifies this exact failure.
          </p>
          {error.digest && (
            <p style={{ fontSize: "12px", color: "#64748b" }}>Reference: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "16px",
              padding: "10px 20px",
              borderRadius: "10px",
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#e2e8f0",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
