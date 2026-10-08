import { describe, expect, it } from "vitest";

import {
  scrubBreadcrumb,
  scrubTelemetryEvent,
  withoutQueryOrFragment,
} from "@/lib/client/sensitive-url";

/**
 * No access-link secret may leave the app through telemetry (Sentry events,
 * transactions, breadcrumbs), whether the link carries it in the fragment
 * (`#t=`, current) or the query (`?t=`, legacy).
 */
const SECRET = "Zm9yLXRlc3Qtb25seS1ub3QtYS1yZWFsLXNlY3JldA";

describe("withoutQueryOrFragment", () => {
  it("keeps only origin and path", () => {
    expect(withoutQueryOrFragment(`https://app.test/access#t=${SECRET}`)).toBe(
      "https://app.test/access",
    );
    expect(withoutQueryOrFragment(`https://app.test/access?t=${SECRET}`)).toBe(
      "https://app.test/access",
    );
    expect(withoutQueryOrFragment(`/access?x=1#t=${SECRET}`)).toBe("/access");
    expect(withoutQueryOrFragment("/dashboard")).toBe("/dashboard");
  });
});

describe("scrubTelemetryEvent", () => {
  it("removes the secret from every place Sentry records a URL", () => {
    const event = {
      request: {
        url: `https://app.test/access#t=${SECRET}`,
        query_string: `t=${SECRET}`,
        cookies: { lv_access: "sealed" },
        headers: {
          Referer: `https://app.test/access?t=${SECRET}`,
          Cookie: "lv_access=sealed",
          "User-Agent": "test",
        },
      },
      transaction: `/access#t=${SECRET}`,
      breadcrumbs: [
        { category: "navigation", data: { from: `/access#t=${SECRET}`, to: "/access" } },
        { category: "fetch", data: { url: `https://app.test/access?t=${SECRET}`, method: "GET" } },
        { category: "console", message: `opened /access#t=${SECRET} ok` },
      ],
      spans: [
        {
          description: `GET /access?t=${SECRET}`,
          data: {
            "url.full": `https://app.test/access#t=${SECRET}`,
            "http.fragment": `t=${SECRET}`,
            "http.query": `?t=${SECRET}`,
            "http.method": "GET",
          },
        },
      ],
      contexts: { trace: { data: { url: `/access#t=${SECRET}` } } },
    };

    const scrubbed = scrubTelemetryEvent(event);

    expect(JSON.stringify(scrubbed)).not.toContain(SECRET);
    expect(scrubbed.request.url).toBe("https://app.test/access");
    expect(scrubbed.request.headers).toEqual({ "User-Agent": "test" });
    expect(scrubbed.request).not.toHaveProperty("cookies");
    expect(scrubbed.breadcrumbs[0].data).toEqual({ from: "/access", to: "/access" });
    expect(scrubbed.spans[0].data).toEqual({
      "url.full": "https://app.test/access",
      "http.method": "GET",
    });
    // Unrelated fields survive.
    expect(scrubbed.breadcrumbs[1].data?.method).toBe("GET");
  });

  it("leaves an event without URLs untouched", () => {
    const event = { message: "boom", tags: { area: "documents" } };
    expect(scrubTelemetryEvent({ ...event })).toEqual(event);
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs a navigation breadcrumb as it is recorded", () => {
    const crumb = scrubBreadcrumb({
      category: "navigation",
      data: { from: `https://app.test/access#t=${SECRET}`, to: "https://app.test/access" },
    });
    expect(JSON.stringify(crumb)).not.toContain(SECRET);
  });
});
