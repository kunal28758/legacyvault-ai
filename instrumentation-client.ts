import * as Sentry from "@sentry/nextjs";

import { scrubBreadcrumb, scrubTelemetryEvent } from "@/lib/client/sensitive-url";

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
    // An access link carries its secret in the fragment (older ones: the query)
    // until the portal clears it; no event, span or breadcrumb may keep it.
    beforeSend: scrubTelemetryEvent,
    beforeSendTransaction: scrubTelemetryEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
