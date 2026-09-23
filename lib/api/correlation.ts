import { randomUUID } from "node:crypto";

/**
 * Per-request correlation id (task T023, NFR-OBS-001).
 *
 * The id ties together the response header, every log line, the audit row and
 * the `p_correlation_id` argument of the guarded database functions.
 *
 * An inbound `X-Correlation-ID` is honoured only for internal callers (cron and
 * webhook modes, authenticated by a shared secret or a provider signature).
 * Browser traffic never controls it, so a caller cannot poison or collide the
 * audit trail.
 */
export const CORRELATION_HEADER = "X-Correlation-ID";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newCorrelationId(): string {
  return randomUUID();
}

export function resolveCorrelationId(headers: Headers, trustInbound: boolean): string {
  if (!trustInbound) return newCorrelationId();
  const inbound = headers.get(CORRELATION_HEADER);
  return inbound && UUID_PATTERN.test(inbound) ? inbound.toLowerCase() : newCorrelationId();
}
