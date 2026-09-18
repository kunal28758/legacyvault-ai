import {
  API_ERROR_CODES,
  type ApiEnvelope,
  type ApiErrorBody,
  type ApiMeta,
  type ReverificationLevel,
} from "@/lib/types/api";

/**
 * Typed browser client for the versioned REST API (task T013).
 *
 * - same-origin `credentials: "same-origin"` so the Clerk session cookie is sent
 * - JSON in / JSON envelope out (`{ success, data, error, meta }`)
 * - 401/403/422/429 mapped to typed errors; 429 surfaces `Retry-After`
 * - a `REVERIFICATION_REQUIRED` failure is re-thrown as `ReverificationRequiredError`
 *   so the re-auth gate (T201) can catch it and open Clerk reverification
 *
 * Never used for auth flows (Clerk components own those, ADR-003) and never
 * used by Server Components (they call services directly, constitution VIII).
 */
export const API_BASE_PATH = "/api/v1";

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, QueryValue | QueryValue[]>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string[]>;
  readonly details?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    error: ApiErrorBody,
    extra: { correlationId?: string; retryAfterSeconds?: number } = {},
  ) {
    super(error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = error.code;
    this.fields = error.fields;
    this.details = error.details;
    this.correlationId = extra.correlationId;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isValidationError(): boolean {
    return this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** 4xx errors are the caller's problem and must never be retried automatically. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** Thrown when a sensitive endpoint requires Clerk reverification (FR-A018). */
export class ReverificationRequiredError extends ApiError {
  readonly level: ReverificationLevel;

  constructor(status: number, error: ApiErrorBody, correlationId?: string) {
    super(status, error, { correlationId });
    this.name = "ReverificationRequiredError";
    const level = error.details?.level;
    this.level = level === "multi_factor" ? "multi_factor" : "strict";
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: ApiMeta;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = normalized.startsWith(API_BASE_PATH) ? normalized : `${API_BASE_PATH}${normalized}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === undefined || item === null) continue;
      params.append(key, String(item));
    }
  }
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    headers,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, {
      code: API_ERROR_CODES.NETWORK_ERROR,
      message: "The request could not be sent. Check your connection and try again.",
    });
  }

  const correlationId = response.headers.get("X-Correlation-ID") ?? undefined;

  if (response.status === 204) {
    return { data: undefined as T, meta: correlationId ? { correlationId } : undefined };
  }

  let envelope: ApiEnvelope<T> | undefined;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
      envelope = undefined;
    }
  }

  if (!envelope || typeof envelope !== "object" || !("success" in envelope)) {
    throw new ApiError(
      response.status,
      {
        code: API_ERROR_CODES.INVALID_RESPONSE,
        message: response.ok
          ? "The server returned an unexpected response."
          : `Request failed (${response.status}).`,
      },
      { correlationId },
    );
  }

  if (envelope.success) {
    return {
      data: envelope.data,
      meta: { ...envelope.meta, correlationId: envelope.meta?.correlationId ?? correlationId },
    };
  }

  const error = envelope.error;
  if (error.code === API_ERROR_CODES.REVERIFICATION_REQUIRED) {
    throw new ReverificationRequiredError(response.status, error, correlationId);
  }
  throw new ApiError(response.status, error, {
    correlationId,
    retryAfterSeconds:
      response.status === 429 ? parseRetryAfter(response.headers.get("Retry-After")) : undefined,
  });
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, "body">) =>
    request<T>("GET", path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("POST", path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("PATCH", path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("PUT", path, { ...options, body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("DELETE", path, { ...options, body }),
};

export type ApiClient = typeof apiClient;
