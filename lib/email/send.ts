import "server-only";

import { getEnvGroup } from "@/lib/config/env";
import { sendEmail, type SendEmailResult } from "@/lib/email/client";
import { AccessLinkEmail } from "@/lib/email/templates/access-link-email";
import { BeneficiaryInvitationEmail } from "@/lib/email/templates/beneficiary-invitation-email";
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
 */
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
    provider: "brevo",
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
    react: DmsReminderEmail({
      ownerName: input.ownerName,
      stage: input.stage,
      deadline: input.deadline,
      appUrl: APP_URL,
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
    react: EmergencyDesignationEmail({
      beneficiaryName: input.beneficiaryName,
      ownerName: input.ownerName,
      requestUrl: `${APP_URL.replace(/\/$/, "")}/emergency-access/${input.configId}`,
    }),
  });
}
