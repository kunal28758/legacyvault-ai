import * as Sentry from "@sentry/nextjs";

/**
 * Browser observability (ADR-010, T188).
 *
 * Off unless `NEXT_PUBLIC_SENTRY_DSN` is set. Session replay and default PII
 * are deliberately not enabled: this application renders legacy plans, asset
 * details and document names, and none of that belongs in an error tracker.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    sendDefaultPii: false,
    beforeSend(event) {
      // The access link carries its token in the query string until the page
      // strips it; an event must never be the thing that keeps it.
      if (event.request?.url) {
        const [path] = event.request.url.split("?");
        event.request.url = path;
      }
      delete event.request?.query_string;
      return event;
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
