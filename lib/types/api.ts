/**
 * Shared API envelope types (contracts/api-contracts.md § Common Response Format).
 * Used by the browser client (lib/api/client.ts) and, from T021/T030 on, by the
 * server-side `withApi()` pipeline so both sides agree on one shape.
 */
export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  correlationId?: string;
  [key: string]: unknown;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  /** Zod field errors: `{ "path.to.field": ["message", ...] }` (422). */
  fields?: Record<string, string[]>;
  /** Small, safe, code-specific details (e.g. `{ level: "strict" }` for reverification). */
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta?: ApiMeta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Error codes the client treats specially (contracts § Authentication / Rate limiting). */
export const API_ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  REVERIFICATION_REQUIRED: "REVERIFICATION_REQUIRED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  NETWORK_ERROR: "NETWORK_ERROR",
  INVALID_RESPONSE: "INVALID_RESPONSE",
} as const;

export type ReverificationLevel = "strict" | "multi_factor";
