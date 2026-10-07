import "server-only";

import type { ApiErrorBody, ApiFailure, ApiMeta } from "@/lib/types/api";

/**
 * Safe API errors (task T021, constitution X, FR-Q016).
 *
 * Nothing that reaches the client may contain a stack trace, a database
 * message, a file path, an internal identifier or any user input echoed back.
 * The full error is logged server-side against the correlation id instead.
 */
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "DUPLICATE"
  | "RATE_LIMITED"
  | "REVERIFICATION_REQUIRED"
  | "INVALID_TRANSITION"
  | "LOCK_CONFLICT"
  | "PLAN_INCOMPLETE"
  | "PERSONAL_DETAILS_REQUIRED"
  | "ALLOCATION_EXCEEDED"
  | "SCOPE_NOT_ASSIGNED"
  | "DELIVERY_CONDITION_MISMATCH"
  | "INVALID_ENCRYPTION_ENVELOPE"
  | "BENEFICIARY_INACTIVE"
  | "FILE_TYPE_MISMATCH"
  | "FILE_TOO_LARGE"
  | "AI_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields?: Record<string, string[]>;
  readonly details?: Record<string, unknown>;
  /** Internal-only context: logged and sent to Sentry, never serialized to the client. */
  readonly cause?: unknown;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: {
      fields?: Record<string, string[]>;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.details = options.details;
    this.cause = options.cause;
  }

  static unauthenticated(message = "You need to sign in to continue.") {
    return new ApiError(401, "UNAUTHENTICATED", message);
  }

  static forbidden(message = "You do not have access to this resource.") {
    return new ApiError(403, "FORBIDDEN", message);
  }

  /** Missing and not-yours are deliberately indistinguishable (no existence oracle). */
  static notFound(message = "This resource does not exist or is not available to you.") {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static validation(
    fields: Record<string, string[]>,
    message = "Some fields need your attention.",
  ) {
    return new ApiError(422, "VALIDATION_ERROR", message, { fields });
  }

  static conflict(
    code: Extract<ApiErrorCode, "CONFLICT" | "DUPLICATE" | "LOCK_CONFLICT">,
    message: string,
  ) {
    return new ApiError(409, code, message);
  }

  static invariant(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    return new ApiError(422, code, message, { details });
  }

  static rateLimited(retryAfterSeconds: number) {
    return new ApiError(429, "RATE_LIMITED", "Too many requests. Please slow down and try again.", {
      details: { retryAfterSeconds },
    });
  }

  static reverificationRequired(level: "strict" | "multi_factor") {
    return new ApiError(
      403,
      "REVERIFICATION_REQUIRED",
      "Please re-verify your identity to continue.",
      {
        details: { level },
      },
    );
  }

  static internal(cause?: unknown) {
    return new ApiError(
      500,
      "INTERNAL_ERROR",
      "Something went wrong on our side. Please try again.",
      {
        cause,
      },
    );
  }

  toBody(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.fields ? { fields: this.fields } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/* ── PostgreSQL / PostgREST mapping ──────────────────────────────────────── */

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** Errors raised by the guarded functions (0003_functions.sql § error convention). */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
const SQLSTATE_INVARIANT = "LV422";
const SQLSTATE_STATE_CONFLICT = "LV409";
const SQLSTATE_UNIQUE_VIOLATION = "23505";
const SQLSTATE_CHECK_VIOLATION = "23514";
const SQLSTATE_FK_VIOLATION = "23503";
/** A value that is not a valid enum member / number / uuid for its column. */
const SQLSTATE_INVALID_TEXT = "22P02";

const INVARIANT_MESSAGES: Partial<Record<string, { code: ApiErrorCode; message: string }>> = {
  PLAN_INCOMPLETE: {
    code: "PLAN_INCOMPLETE",
    message: "Some sections are incomplete. Acknowledge them to finalize anyway.",
  },
  PERSONAL_DETAILS_REQUIRED: {
    code: "PERSONAL_DETAILS_REQUIRED",
    message: "Personal details must be complete before a plan can be finalized.",
  },
  ALLOCATION_EXCEEDED: {
    code: "ALLOCATION_EXCEEDED",
    message: "That allocation would take this resource above 100%.",
  },
  SCOPE_NOT_ASSIGNED: {
    code: "SCOPE_NOT_ASSIGNED",
    message: "Everything you share must already be assigned to that beneficiary.",
  },
  DELIVERY_CONDITION_MISMATCH: {
    code: "DELIVERY_CONDITION_MISMATCH",
    message: "A video's delivery condition does not allow this kind of access.",
  },
  INVALID_ENCRYPTION_ENVELOPE: {
    code: "INVALID_ENCRYPTION_ENVELOPE",
    message: "That value could not be stored securely. Please try again.",
  },
  BENEFICIARY_INACTIVE: {
    code: "BENEFICIARY_INACTIVE",
    message: "Inactive beneficiaries cannot receive assignments or access.",
  },
  WARNING_WINDOW_INVALID: {
    code: "VALIDATION_ERROR",
    message: "Your check-in interval must be shorter than the inactivity threshold.",
  },
  CONTACTS_REQUIRED: {
    code: "VALIDATION_ERROR",
    message: "Choose at least one trusted contact.",
  },
  CONTACT_NOT_ELIGIBLE: {
    code: "VALIDATION_ERROR",
    message: "Trusted contacts must be your own active or invited beneficiaries.",
  },
  SCOPE_EMPTY: {
    code: "VALIDATION_ERROR",
    message: "Choose at least one resource to include.",
  },
  UNAUTHENTICATED: { code: "UNAUTHENTICATED", message: "You need to sign in to continue." },
  FORBIDDEN: { code: "FORBIDDEN", message: "You do not have access to this resource." },
};

const CONFLICT_MESSAGES: Partial<Record<string, { code: ApiErrorCode; message: string }>> = {
  INVALID_TRANSITION: {
    code: "INVALID_TRANSITION",
    message: "That change is not allowed from the current state.",
  },
  LOCK_CONFLICT: {
    code: "LOCK_CONFLICT",
    message: "This was changed somewhere else. Reload and try again.",
  },
  DUPLICATE: { code: "DUPLICATE", message: "That record already exists." },
  DRAFT_EXISTS: { code: "CONFLICT", message: "You already have a draft in progress." },
  TOKEN_ALREADY_LIVE: {
    code: "CONFLICT",
    message: "A live access link already exists for this grant.",
  },
};

function isPostgrestError(value: unknown): value is PostgrestLikeError {
  return typeof value === "object" && value !== null && ("code" in value || "message" in value);
}

/**
 * Translates a database error into a safe `ApiError`.
 *
 * The guarded functions signal intent through SQLSTATE and put a machine code in
 * MESSAGE; the human wording is chosen here so database text never reaches a
 * client. Unrecognised database errors become a generic 500 with the original
 * kept only as `cause` for the log.
 */
export function mapDatabaseError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!isPostgrestError(error)) return ApiError.internal(error);

  const sqlstate = error.code ?? "";
  const raw = (error.message ?? "").trim();
  const machineCode = raw.split(/[\s:]/)[0]?.toUpperCase() ?? "";

  if (sqlstate === SQLSTATE_INSUFFICIENT_PRIVILEGE) {
    // The function could not prove ownership, or the caller has no grant at all.
    if (machineCode === "UNAUTHENTICATED") return ApiError.unauthenticated();
    return ApiError.forbidden();
  }

  if (sqlstate === SQLSTATE_INVARIANT) {
    const known = INVARIANT_MESSAGES[machineCode];
    const details = parseErrorDetail(error.details);
    return new ApiError(
      422,
      known?.code ?? "VALIDATION_ERROR",
      known?.message ?? "That change is not allowed.",
      {
        details,
        cause: error,
      },
    );
  }

  if (sqlstate === SQLSTATE_STATE_CONFLICT) {
    const known = CONFLICT_MESSAGES[machineCode];
    return new ApiError(
      409,
      known?.code ?? "CONFLICT",
      known?.message ?? "That change conflicts with the current state.",
      {
        details: parseErrorDetail(error.details),
        cause: error,
      },
    );
  }

  if (sqlstate === SQLSTATE_UNIQUE_VIOLATION) {
    return new ApiError(409, "DUPLICATE", "That record already exists.", { cause: error });
  }

  if (
    sqlstate === SQLSTATE_CHECK_VIOLATION ||
    sqlstate === SQLSTATE_FK_VIOLATION ||
    sqlstate === SQLSTATE_INVALID_TEXT
  ) {
    return new ApiError(422, "VALIDATION_ERROR", "Some of that information is not valid.", {
      cause: error,
    });
  }

  return ApiError.internal(error);
}

/** Guarded functions put a small JSON object in DETAIL; anything else is dropped. */
function parseErrorDetail(detail: string | null | undefined): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  try {
    const parsed: unknown = JSON.parse(detail);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Serializes any error into the failure envelope from the API contract. */
export function toErrorResponse(
  error: unknown,
  meta?: ApiMeta,
): { body: ApiFailure; status: number } {
  const apiError = error instanceof ApiError ? error : mapDatabaseError(error);
  return {
    status: apiError.status,
    body: { success: false, error: apiError.toBody(), ...(meta ? { meta } : {}) },
  };
}
