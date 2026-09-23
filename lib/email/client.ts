import "server-only";

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
 * Resend is asked to deduplicate on `idempotencyKey`, so a job that retries
 * after a network timeout does not send the message twice.
 */
export interface SendEmailInput {
  to: string;
  subject: string;
  react: React.ReactElement;
  /** Stable per logical message; retries of the same job reuse it. */
  idempotencyKey: string;
  replyTo?: string;
}

export interface SendEmailResult {
  providerMessageId: string;
}

let client: Resend | null = null;

function resend(): Resend {
  if (!client) {
    const { RESEND_API_KEY } = getEnvGroup("email");
    client = new Resend(RESEND_API_KEY);
  }
  return client;
}

export function emailConfigured(): boolean {
  try {
    getEnvGroup("email");
    return true;
  } catch {
    return false;
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
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

  if (error || !data) {
    // The message, never the recipient's data, and never the link.
    logger.error({ err: error, subject: input.subject }, "email send failed");
    throw new Error(error?.message ?? "email send failed");
  }
  return { providerMessageId: data.id };
}
