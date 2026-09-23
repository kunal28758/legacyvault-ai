import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CORRELATION_HEADER, newCorrelationId, resolveCorrelationId } from "@/lib/api/correlation";
import { ApiError, mapDatabaseError, toErrorResponse } from "@/lib/api/errors";
import { parseOrThrow, parseQuery, toFieldErrors } from "@/lib/api/validate";
import { diffForAudit, redactForAudit } from "@/lib/audit/audit.service";
import { redactPath } from "@/lib/observability/logger";

/**
 * Phase A API foundation (T021/T022/T023/T026/T027).
 *
 * The properties under test are security properties: safe error surfaces, no
 * echoing of rejected input, no sensitive values in audit metadata, and
 * correlation ids that an untrusted caller cannot choose.
 */
describe("error mapping", () => {
  it("never leaks database text, stack traces or internals to the client", () => {
    const dbError = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "beneficiaries_user_email_live_uidx"',
      details: "Key (user_id, email)=(…) already exists.",
      hint: "internal hint",
    };
    const { body, status } = toErrorResponse(dbError);

    expect(status).toBe(409);
    expect(body.error.code).toBe("DUPLICATE");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("beneficiaries_user_email_live_uidx");
    expect(serialized).not.toContain("internal hint");
    expect(serialized).not.toContain("constraint");
  });

  it("maps the guarded functions' 42501 to 403 without an existence oracle", () => {
    const forbidden = mapDatabaseError({ code: "42501", message: "FORBIDDEN" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.code).toBe("FORBIDDEN");

    const unauthenticated = mapDatabaseError({ code: "42501", message: "UNAUTHENTICATED" });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.code).toBe("UNAUTHENTICATED");

    // "missing" and "not yours" must be indistinguishable to the caller.
    expect(forbidden.message).toBe(ApiError.forbidden().message);
  });

  it("maps invariant and state-conflict SQLSTATEs to the contract's codes", () => {
    const allocation = mapDatabaseError({
      code: "LV422",
      message: "ALLOCATION_EXCEEDED",
      details: JSON.stringify({ remaining: 40 }),
    });
    expect(allocation.status).toBe(422);
    expect(allocation.code).toBe("ALLOCATION_EXCEEDED");
    expect(allocation.details).toEqual({ remaining: 40 });

    const lock = mapDatabaseError({ code: "LV409", message: "LOCK_CONFLICT" });
    expect(lock.status).toBe(409);
    expect(lock.code).toBe("LOCK_CONFLICT");

    const plan = mapDatabaseError({ code: "LV422", message: "PLAN_INCOMPLETE" });
    expect(plan.code).toBe("PLAN_INCOMPLETE");
  });

  it("treats a malformed value as 422 rather than a server fault", () => {
    // An unknown enum member / uuid reaching a column is bad input, not a bug.
    const mapped = mapDatabaseError({
      code: "22P02",
      message: 'invalid input value for enum financial_asset_category: "BOGUS"',
    });
    expect(mapped.status).toBe(422);
    expect(mapped.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(mapped.toBody())).not.toContain("financial_asset_category");
  });

  it("falls back to an opaque 500 for unknown database errors", () => {
    const mapped = mapDatabaseError({ code: "XX000", message: "internal engine detail" });
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(mapped.toBody())).not.toContain("internal engine detail");
    // The original is retained for the server-side log only.
    expect(mapped.cause).toBeDefined();
  });
});

describe("request validation", () => {
  const schema = z.object({ email: z.email(), age: z.number().int().min(18) });

  it("returns field errors without echoing the submitted value", () => {
    const secretish = "super-secret-value@example.com!!";
    try {
      parseOrThrow(schema, { email: secretish, age: 12 });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(422);
      expect(Object.keys(apiError.fields ?? {})).toEqual(expect.arrayContaining(["email", "age"]));
      expect(JSON.stringify(apiError.toBody())).not.toContain(secretish);
    }
  });

  it("collapses repeated query parameters into arrays", () => {
    const url = new URL("https://example.test/api?tag=a&tag=b&page=2");
    const parsed = parseQuery(url, z.object({ tag: z.array(z.string()), page: z.string() }));
    expect(parsed).toEqual({ tag: ["a", "b"], page: "2" });
  });

  it("names nested paths in field errors", () => {
    const nested = z.object({ profile: z.object({ city: z.string().min(1) }) });
    const result = nested.safeParse({ profile: { city: "" } });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(toFieldErrors(result.error))).toContain("profile.city");
  });
});

describe("correlation ids", () => {
  it("ignores a caller-supplied id for browser traffic", () => {
    const headers = new Headers({ [CORRELATION_HEADER]: "11111111-1111-4111-8111-111111111111" });
    expect(resolveCorrelationId(headers, false)).not.toBe("11111111-1111-4111-8111-111111111111");
  });

  it("honours a well-formed id from trusted internal callers", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const headers = new Headers({ [CORRELATION_HEADER]: id });
    expect(resolveCorrelationId(headers, true)).toBe(id);
  });

  it("rejects a malformed id even from an internal caller", () => {
    const headers = new Headers({ [CORRELATION_HEADER]: "not-a-uuid; DROP TABLE users" });
    const resolved = resolveCorrelationId(headers, true);
    expect(resolved).not.toContain("DROP");
    expect(resolved).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("generates unique ids", () => {
    expect(newCorrelationId()).not.toBe(newCorrelationId());
  });
});

describe("log and audit redaction", () => {
  it("scrubs access-link paths that carry a bearer secret", () => {
    expect(redactPath("/access?t=super-secret-token")).toBe("/access/[redacted]");
    expect(redactPath("/api/v1/access/documents/abc")).toBe("/access/[redacted]");
    expect(redactPath("/emergency-access/verify")).toBe("/emergency-access/[redacted]");
    expect(redactPath("/api/v1/beneficiaries?page=2")).toBe("/api/v1/beneficiaries");
  });

  it("never writes sensitive values into audit metadata", () => {
    const redacted = redactForAudit({
      name: "Priya",
      accountNumber: "1234567890",
      credentials: "hunter2",
      nested: { recoveryInfo: "seed phrase", token: "tok_live" },
    });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("1234567890");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("seed phrase");
    expect(serialized).not.toContain("tok_live");
    expect(serialized).toContain("Priya");
  });

  it("diffs only changed keys and masks sensitive ones", () => {
    const diff = diffForAudit(
      { name: "Old", phone: "111", accountNumber: "1111" },
      { name: "New", phone: "111", accountNumber: "2222" },
    );
    expect(diff.changed.sort()).toEqual(["accountNumber", "name"]);
    expect(diff.previous.name).toBe("Old");
    expect(diff.next.accountNumber).toBe("[encrypted]");
    expect(JSON.stringify(diff)).not.toContain("2222");
  });
});
