import "server-only";

import { getEnvGroup } from "@/lib/config/env";
import { sendEmail, type EmailProvider, type SendEmailResult } from "@/lib/email/client";
import { AccessLinkEmail } from "@/lib/email/templates/access-link-email";
import { BeneficiaryInvitationEmail } from "@/lib/email/templates/beneficiary-invitation-email";
import { DmsContactNoticeEmail } from "@/lib/email/templates/dms-contact-notice-email";
import { DmsReminderEmail } from "@/lib/email/templates/dms-reminder-email";
import { EmergencyCodeEmail } from "@/lib/email/templates/emergency-code-email";
import { EmergencyDesignationEmail } from "@/lib/email/templates/emergency-designation-email";
import { NotificationEmail } from "@/lib/email/templates/notification-email";

/**
 * The only place that turns an application event into an email.
 *
 * Every helper takes exactly what the template needs, so a caller cannot
 * accidentally hand a whole domain object — with its encrypted fields — to a
 * message body.
 *
 * Which provider carries a message is decided here and nowhere else. Every
 * message LegacyVault sends today is part of a security or release workflow —
 * invitations, access links, release codes, emergency codes and the owner's
 * warnings and alerts — so all of them use the provider whose sender is
 * verified in production (Brevo). Without Brevo configured the client falls
 * back to Resend, as it always has; removing the Brevo key is the rollback.
 */
const VERIFIED: { provider: EmailProvider } = { provider: "brevo" };
export async function sendAccessLinkEmail(input: {
  to: string;
  beneficiaryName: string;
  ownerName: string;
  link: string;
  expiresAt: string;
  grantType: "DIRECT_SHARE" | "DMS_RELEASE" | "EMERGENCY_ACCESS";
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  return sendEmail({
    to: input.to,
    subject: `${input.ownerName} shared secure access with you`,
    idempotencyKey: input.idempotencyKey,
    ...VERIFIED,
    react: AccessLinkEmail({
      beneficiaryName: input.beneficiaryName,
      ownerName: input.ownerName,
      link: input.link,
      expiresAt: input.expiresAt,
      grantType: input.grantType,
    }),
  });
}

export async function sendBeneficiaryInvitationEmail(input: {
  to: string;
  beneficiaryName: string;
  ownerName: string;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  const { APP_URL } = getEnvGroup("core");
  return sendEmail({
    to: input.to,
    subject: `${input.ownerName} named you a beneficiary`,
    idempotencyKey: input.idempotencyKey,
    ...VERIFIED,
    react: BeneficiaryInvitationEmail({
      beneficiaryName: input.beneficiaryName,
      ownerName: input.ownerName,
      appUrl: APP_URL.replace(/\/$/, ""),
    }),
  });
}

export async function sendDmsReminderEmail(input: {
  to: string;
  ownerName: string;
  stage: "REMINDER" | "GRACE" | "ESCALATING";
  deadline: string;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  const { APP_URL } = getEnvGroup("core");
  return sendEmail({
    to: input.to,
    subject:
      input.stage === "REMINDER"
        ? "Time to check in to LegacyVault"
        : input.stage === "GRACE"
          ? "Your LegacyVault check-in is overdue"
          : "LegacyVault is contacting your trusted contacts",
    idempotencyKey: input.idempotencyKey,
    ...VERIFIED,
    react: DmsReminderEmail({
      ownerName: input.ownerName,
      stage: input.stage,
      deadline: input.deadline,
      appUrl: APP_URL,
    }),
  });
}

/** A trusted contact learns the workflow started — nothing more (no link, no scope). */
export async function sendDmsContactNoticeEmail(input: {
  to: string;
  beneficiaryName: string;
  ownerName: string;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  return sendEmail({
    to: input.to,
    subject: `${input.ownerName}'s emergency release workflow has started`,
    idempotencyKey: input.idempotencyKey,
    ...VERIFIED,
    react: DmsContactNoticeEmail({
      beneficiaryName: input.beneficiaryName,
      ownerName: input.ownerName,
    }),
  });
}

/** The one-time code a trusted contact enters before a release link opens. */
export async function sendReleaseCodeEmail(input: {
  to: string;
  beneficiaryName: string;
  ownerName: string;
  code: string;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  return sendEmail({
    to: input.to,
    subject: `Your LegacyVault verification code`,
    idempotencyKey: input.idempotencyKey,
    ...VERIFIED,
    react: EmergencyCodeEmail({
      ownerName: input.ownerName,
      code: input.code,
      purpose: "release",
      beneficiaryName: input.beneficiaryName,
    }),
  });
}

export async function sendNotificationEmail(input: {
  to: string;
  title: string;
  content: string;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  const { APP_URL } = getEnvGroup("core");
  return sendEmail({
    to: input.to,
    subject: input.title,
    idempotencyKey: input.idempotencyKey,
    ...VERIFIED,
    react: NotificationEmail({ title: input.title, content: input.content, appUrl: APP_URL }),
  });
}

export async function sendEmergencyCodeEmail(input: {
  to: string;
  ownerName: string;
  code: string;
  requestId: string;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  const { APP_URL } = getEnvGroup("core");
  return sendEmail({
    to: input.to,
    subject: `Your verification code for ${input.ownerName}'s emergency access`,
    idempotencyKey: input.idempotencyKey,
    ...VERIFIED,
    react: EmergencyCodeEmail({
      ownerName: input.ownerName,
      code: input.code,
      verifyUrl: `${APP_URL.replace(/\/$/, "")}/emergency-access/verify?r=${input.requestId}`,
    }),
  });
}

export async function sendEmergencyDesignationEmail(input: {
  to: string;
  beneficiaryName: string;
  ownerName: string;
  configId: string;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  const { APP_URL } = getEnvGroup("core");
  return sendEmail({
    to: input.to,
    subject: `${input.ownerName} named you an emergency contact`,
    idempotencyKey: input.idempotencyKey,
    ...VERIFIED,
    react: EmergencyDesignationEmail({
      beneficiaryName: input.beneficiaryName,
      ownerName: input.ownerName,
      requestUrl: `${APP_URL.replace(/\/$/, "")}/emergency-access/${input.configId}`,
    }),
  });
}
