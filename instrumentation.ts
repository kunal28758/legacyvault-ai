import * as Sentry from "@sentry/nextjs";

/**
 * Server and edge observability (ADR-010, T188).
 *
 * Sentry initialises only when `SENTRY_DSN` is set, so a developer without an
 * account — and the test runs — behave exactly as before. Two rules matter more
 * than the traces:
 *
 *  • **Nothing from a vault leaves the process.** Request bodies, headers and
 *    cookies are not attached (`sendDefaultPii: false`), and the scrubber below
 *    drops the query string and the access-link token if either ever appears.
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
    beforeSend(event) {
      return scrub(event);
    },
  });
}

/** Server-side errors Next.js catches on its own (`instrumentation.js` § onRequestError). */
export const onRequestError = Sentry.captureRequestError;

/**
 * Removes anything that could carry a secret.
 *
 * The one place a token has ever appeared in a URL is the emailed access link
 * (`/access?t=…`), which the browser strips immediately — but an event captured
 * in that millisecond must not keep it.
 */
function scrub<T extends { request?: { url?: string; query_string?: unknown; cookies?: unknown } }>(
  event: T,
): T {
  if (event.request) {
    if (typeof event.request.url === "string") {
      const [path] = event.request.url.split("?");
      event.request.url = path;
    }
    delete event.request.query_string;
    delete event.request.cookies;
  }
  return event;
}
