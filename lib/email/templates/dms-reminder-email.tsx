import { Button, Text } from "@react-email/components";

import { EmailLayout, button, paragraph } from "./layout";

/** Check-in reminder and escalation warning for the owner (FR-I004). */
export function DmsReminderEmail({
  ownerName,
  stage,
  deadline,
  appUrl,
}: {
  ownerName: string;
  stage: "REMINDER" | "GRACE" | "ESCALATING";
  deadline: string;
  appUrl: string;
}) {
  const heading =
    stage === "REMINDER"
      ? "Time to check in"
      : stage === "GRACE"
        ? "Your check-in is overdue"
        : "Your trusted contacts are being notified";

  const body =
    stage === "REMINDER"
      ? "Your Dead Man's Switch is waiting for a check-in. One click keeps everything exactly as it is."
      : stage === "GRACE"
        ? "You are inside the grace period. If you do not check in, LegacyVault will start contacting the people you nominated."
        : "LegacyVault has begun contacting your trusted contacts. You can still stop this by checking in now.";

  return (
    <EmailLayout preview={heading} heading={heading}>
      <Text style={paragraph}>Hello {ownerName},</Text>
      <Text style={paragraph}>{body}</Text>
      <Text style={paragraph}>Next step scheduled for {new Date(deadline).toUTCString()}.</Text>
      <Button href={`${appUrl}/dead-man-switch`} style={button}>
        Check in now
      </Button>
    </EmailLayout>
  );
}
