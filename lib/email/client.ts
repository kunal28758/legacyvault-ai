import "server-only";

import { render } from "@react-email/components";
import { Resend } from "resend";

import { getEnvGroup } from "@/lib/config/env";
import { logger } from "@/lib/observability/logger";

/**
 * Transactional email (ADR-009).
 *
 * Every message LegacyVault sends is a notification or a link — never the
 * contents of a vault. A plan, an asset, a credential or a document body must
 * not appear in an email, because email is neither encrypted at rest on the
 * recipient's side nor under our control once sent.
 *
 * Two providers sit behind `sendEmail()`. Resend carries every message unless
 * the caller asks for Brevo; Brevo is used when `BREVO_API_KEY` and
 * `BREVO_EMAIL_FROM` are set and otherwise the message falls back to Resend, so
 * removing the key is the rollback. Each provider sends from its own verified
 * sender: `EMAIL_FROM` for Resend, `BREVO_EMAIL_FROM` for Brevo. Both are asked
 * to deduplicate on `idempotencyKey`, so a job that retries after a network
 * timeout does not send the message twice.
 */
export type EmailProvider = "resend" | "brevo";

export interface SendEmailInput {
  to: string;
  subject: string;
  react: React.ReactElement;
  /** Stable per logical message; retries of the same job reuse it. */
  idempotencyKey: string;
  replyTo?: string;
  /** Who carries the message: Resend unless the caller opts into Brevo. */
  provider?: EmailProvider;
}

export interface SendEmailResult {
  providerMessageId: string;
  /** Who actually carried it (a Brevo request falls back to Resend when Brevo is not set up). */
  provider: EmailProvider;
}

let client: Resend | null = null;

function resend(): Resend {
  if (!client) {
    const { RESEND_API_KEY } = getEnvGroup("email");
    client = new Resend(RESEND_API_KEY);
  }
  return client;
}

function resendConfigured(): boolean {
  try {
    getEnvGroup("email");
    return true;
  } catch {
    return false;
  }
}

function brevoSettings(): { apiKey: string; from: string } | null {
  try {
    const { BREVO_API_KEY, BREVO_EMAIL_FROM } = getEnvGroup("brevo");
    return BREVO_API_KEY && BREVO_EMAIL_FROM
      ? { apiKey: BREVO_API_KEY, from: BREVO_EMAIL_FROM }
      : null;
  } catch {
    return null;
  }
}

/** True when at least one provider can send. */
export function emailConfigured(): boolean {
  return resendConfigured() || brevoSettings() !== null;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (input.provider === "brevo") {
    const brevo = brevoSettings();
    if (brevo) return sendWithBrevo(input, brevo);
  }
  return sendWithResend(input);
}

async function sendWithResend(input: SendEmailInput): Promise<SendEmailResult> {
  const { EMAIL_FROM } = getEnvGroup("email");

  const { data, error } = await resend().emails.send(
    {
      from: EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      react: input.react,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (error || !data) failed("resend", error?.name ?? "no_response", error?.statusCode ?? null);
  return { providerMessageId: data.id, provider: "resend" };
}

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const BREVO_EVENTS_ENDPOINT = "https://api.brevo.com/v3/smtp/statistics/events";
const BREVO_TIMEOUT_MS = 15_000;

async function sendWithBrevo(
  input: SendEmailInput,
  { apiKey, from }: { apiKey: string; from: string },
): Promise<SendEmailResult> {
  const sender = parseSender(from);
  if (!sender) failed("brevo", "invalid_sender", null);

  // Brevo takes markup, not a React element: the same template, rendered here.
  const [htmlContent, textContent] = await Promise.all([
    render(input.react),
    render(input.react, { plainText: true }),
  ]);

  let response: Response;
  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent,
        textContent,
        ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
        headers: { "Idempotency-Key": input.idempotencyKey },
      }),
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    failed("brevo", timedOut ? "timeout" : "network_error", null);
  }

  const body = (await response.json().catch(() => null)) as {
    messageId?: unknown;
    code?: unknown;
  } | null;
  const messageId = body?.messageId;
  if (!response.ok || typeof messageId !== "string") {
    // Brevo's codes are a fixed list; anything else is not trusted into a log.
    const code =
      typeof body?.code === "string" && /^[\w .-]{1,80}$/.test(body.code)
        ? body.code
        : response.ok
          ? "no_message_id"
          : "unknown_error";
    failed("brevo", code, response.status);
  }
  return { providerMessageId: messageId, provider: "brevo" };
}

/**
 * What the provider knows about a message it accepted.
 *
 * `delivered` means the recipient's mail server accepted it — the strongest
 * delivery evidence either provider offers (opens are not required: images
 * are blocked and proxies preload them). `bounced` and `failed` mean it did
 * not arrive; `pending` means no outcome yet. Anything unrecognised is
 * `pending`, never `delivered`, and an unreachable provider throws, so a
 * caller can only ever under-claim a delivery.
 */
export type DeliveryOutcome = "delivered" | "bounced" | "failed" | "pending";

const RESEND_OUTCOME: Partial<Record<string, DeliveryOutcome>> = {
  delivered: "delivered",
  opened: "delivered",
  clicked: "delivered",
  bounced: "bounced",
  complained: "failed",
  failed: "failed",
  canceled: "failed",
  suppressed: "failed",
};

/** Brevo's transactional event names, lower-cased, singular or plural. */
const BREVO_DELIVERED = new Set([
  "delivered",
  "opened",
  "uniqueopened",
  "click",
  "clicks",
  "loadedbyproxy",
]);
const BREVO_BOUNCED = new Set([
  "hardbounce",
  "hardbounces",
  "softbounce",
  "softbounces",
  "bounce",
  "bounces",
]);
const BREVO_FAILED = new Set(["blocked", "invalid", "invalid_email", "spam", "complaint", "error"]);

/** Reduces Brevo's event log for one message to an outcome (exported for tests). */
export function brevoOutcome(
  events: { event?: unknown; messageId?: unknown }[],
  messageId: string,
): DeliveryOutcome {
  // Only events for this message: a mis-scoped answer must never confirm it.
  const names = events
    .filter((item) => item.messageId === messageId && typeof item.event === "string")
    .map((item) => (item.event as string).toLowerCase());
  if (names.some((name) => BREVO_FAILED.has(name))) return "failed";
  if (names.some((name) => BREVO_DELIVERED.has(name))) return "delivered";
  // A soft bounce is often retried by Brevo; only a hard one is final.
  if (names.some((name) => name === "hardbounce" || name === "hardbounces")) return "bounced";
  if (names.some((name) => BREVO_BOUNCED.has(name))) return "pending";
  return "pending";
}

export async function lookupDelivery(
  provider: EmailProvider,
  messageId: string,
): Promise<DeliveryOutcome> {
  if (provider === "resend") {
    const { data, error } = await resend().emails.get(messageId);
    if (error || !data) failed("resend", error?.name ?? "no_response", error?.statusCode ?? null);
    return RESEND_OUTCOME[data.last_event] ?? "pending";
  }

  const brevo = brevoSettings();
  if (!brevo) failed("brevo", "not_configured", null);
  const query = new URLSearchParams({ messageId, days: "30", limit: "100", sort: "desc" });
  let response: Response;
  try {
    response = await fetch(`${BREVO_EVENTS_ENDPOINT}?${query.toString()}`, {
      headers: { "api-key": brevo.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    failed("brevo", timedOut ? "timeout" : "network_error", null);
  }
  if (!response.ok) failed("brevo", "events_lookup_failed", response.status);
  const body = (await response.json().catch(() => null)) as { events?: unknown } | null;
  const events = Array.isArray(body?.events)
    ? (body.events as { event?: unknown; messageId?: unknown }[])
    : [];
  return brevoOutcome(events, messageId);
}

/** `Name <address>` or a bare address — the form the sender variables are written in. */
function parseSender(from: string): { name?: string; email: string } | null {
  const named = /^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  if (named) return named[1] ? { name: named[1], email: named[2] } : { email: named[2] };
  const bare = from.trim();
  return /^[^<>\s]+@[^<>\s]+$/.test(bare) ? { email: bare } : null;
}

/**
 * The provider's error code and status only. Its message can quote an address —
 * the account owner's, when Resend's testing sender is refused — and the
 * subject carries people's names; callers log and persist what is thrown here,
 * so neither leaves this module.
 */
function failed(transport: EmailProvider, code: string, statusCode: number | null): never {
  logger.error({ provider: code, statusCode, transport }, "email send failed");
  throw new Error(`email send failed: ${code}`);
}
