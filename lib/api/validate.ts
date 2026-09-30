import "server-only";

import type { z } from "zod";

import { ApiError } from "@/lib/api/errors";

/**
 * Server-side request validation (task T026, constitution X, FR-Q009).
 *
 * All untrusted input — body, query and path parameters — is parsed with Zod
 * before a service ever sees it. Client-side validation is a UX affordance only
 * and is never relied upon here.
 *
 * Failures return 422 with field-level messages and **never echo the submitted
 * value**, so a rejected payload cannot leak back through an error response.
 */
export type FieldErrors = Record<string, string[]>;

export function toFieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".") || "_";
    (fields[path] ??= []).push(issue.message);
  }
  return fields;
}

/** Parses a value or throws the contract's 422. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw ApiError.validation(toFieldErrors(result.error));
  return result.data;
}

/** Reads and validates a JSON body; a malformed body is a validation error, not a 500. */
export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw ApiError.validation({ _: ["Expected a JSON request body."] });
  }
  return parseOrThrow(schema, raw);
}

/** Validates query parameters, collapsing repeated keys into arrays. */
export function parseQuery<T>(url: URL, schema: z.ZodType<T>): T {
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }
  return parseOrThrow(schema, params);
}
