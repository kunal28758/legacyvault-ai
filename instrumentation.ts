import * as Sentry from "@sentry/nextjs";

import { scrubTelemetryEvent } from "@/lib/client/sensitive-url";

/**
 * Server and edge observability (ADR-010, T188).
 *
 * Sentry initialises only when `SENTRY_DSN` is set, so a developer without an
 * account — and the test runs — behave exactly as before. Two rules matter more
 * than the traces:
 *
 *  • **Nothing from a vault leaves the process.** Request bodies, headers and
 *    cookies are not attached (`sendDefaultPii: false`), and every URL in an
 *    event or transaction loses its query and fragment, where an access-link
 *    secret could be (lib/client/sensitive-url.ts).
 *  • **The correlation id is the link.** Every API response already carries one
 *    and every log line repeats it, so an event is matched to its request
 *    without shipping the request itself.
 */
export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    // Personally identifying request data is never attached.
    sendDefaultPii: false,
    beforeSend: scrubTelemetryEvent,
    beforeSendTransaction: scrubTelemetryEvent,
  });
}

/** Server-side errors Next.js catches on its own (`instrumentation.js` § onRequestError). */
export const onRequestError = Sentry.captureRequestError;
