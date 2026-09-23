import "server-only";

import pino, { type Logger } from "pino";

/**
 * Structured JSON logging (task T022, constitution XVI, FR-Q017).
 *
 * Nothing sensitive may be logged: no passwords, tokens, keys, cookies,
 * encrypted envelopes, document content or access-link plaintext. Redaction is
 * applied by path, and `/access` style request paths are scrubbed because the
 * emailed link carries a bearer secret in `?t=`.
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "res.headers['set-cookie']",
  "headers.authorization",
  "headers.cookie",
  "password",
  "*.password",
  "token",
  "*.token",
  "tokenHash",
  "*.tokenHash",
  "otp",
  "*.otp",
  "otpHash",
  "*.otpHash",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "credentials",
  "*.credentials",
  "recoveryInfo",
  "*.recoveryInfo",
  "identificationDetails",
  "*.identificationDetails",
  "accountNumber",
  "*.accountNumber",
  "policyNumber",
  "*.policyNumber",
  "ciphertext",
  "*.ciphertext",
  "content",
  "*.content",
];

/** `/access?t=…` and `/emergency-access/...` must never appear verbatim in a log. */
export function redactPath(pathname: string): string {
  if (/^\/(api\/v1\/)?access(\/|$|\?)/.test(pathname)) return "/access/[redacted]";
  if (/^\/(api\/v1\/)?emergency-access(\/|$|\?)/.test(pathname))
    return "/emergency-access/[redacted]";
  const [base] = pathname.split("?");
  return base;
}

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

export const logger: Logger = pino({
  level,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  base: { service: "legacyvault" },
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Request-scoped child logger; every line carries the correlation id (NFR-OBS-001). */
export function requestLogger(correlationId: string, extra?: Record<string, unknown>): Logger {
  return logger.child({ correlationId, ...extra });
}
