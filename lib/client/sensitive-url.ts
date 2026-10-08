/**
 * Telemetry must never carry an access-link secret.
 *
 * Access links carry their secret in the fragment (`/access#t=…`), older ones in
 * the query (`?t=…`). Sentry records page URLs, navigation breadcrumbs
 * (from → to), fetch/XHR URLs, span attributes (`http.query`, `http.fragment`)
 * and the Referer header — any of which can hold it for the instant before the
 * portal clears the address bar. Every URL that leaves through telemetry loses
 * its query and fragment, so neither an access secret nor any future
 * sensitive parameter can ride along.
 *
 * Browser-safe and dependency-free: used by both Sentry configurations.
 */
export function withoutQueryOrFragment(url: string): string {
  return url.split(/[?#]/, 1)[0];
}

type Bag = Record<string, unknown>;

const URL_KEY = /(url|href|^from$|^to$)/i;
const DROPPED_KEY = /(^|\.)(query|fragment|query_string)$/i;
const SECRET_IN_TEXT = /([?#&]t=)[^&#\s"']*/g;

function scrubBag(bag: Bag | undefined): void {
  if (!bag) return;
  for (const [key, value] of Object.entries(bag)) {
    if (DROPPED_KEY.test(key)) delete bag[key];
    else if (typeof value === "string" && URL_KEY.test(key))
      bag[key] = withoutQueryOrFragment(value);
  }
}

const SENSITIVE_HEADERS = ["referer", "cookie", "authorization", "set-cookie"];

interface TelemetryEventShape {
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
  };
  breadcrumbs?: { data?: Bag; message?: string }[];
  spans?: { data?: Bag; description?: string }[];
  contexts?: { trace?: { data?: Bag } } & Record<string, unknown>;
  transaction?: string;
}

/** Error and transaction events: URLs stripped, secret-bearing fields dropped. */
export function scrubTelemetryEvent<T>(event: T): T {
  const e = event as TelemetryEventShape;
  if (e.request) {
    if (typeof e.request.url === "string") e.request.url = withoutQueryOrFragment(e.request.url);
    delete e.request.query_string;
    delete e.request.cookies;
    for (const name of Object.keys(e.request.headers ?? {})) {
      if (SENSITIVE_HEADERS.includes(name.toLowerCase())) delete e.request.headers![name];
    }
  }
  for (const crumb of e.breadcrumbs ?? []) scrubBreadcrumb(crumb);
  for (const span of e.spans ?? []) {
    scrubBag(span.data);
    if (typeof span.description === "string") {
      span.description = span.description.replace(SECRET_IN_TEXT, "$1[redacted]");
    }
  }
  scrubBag(e.contexts?.trace?.data);
  if (typeof e.transaction === "string") e.transaction = withoutQueryOrFragment(e.transaction);
  return event;
}

/** Breadcrumbs as they are recorded (navigation, fetch, XHR, console). */
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  const b = breadcrumb as { data?: Bag; message?: string };
  scrubBag(b.data);
  if (typeof b.message === "string") b.message = b.message.replace(SECRET_IN_TEXT, "$1[redacted]");
  return breadcrumb;
}
