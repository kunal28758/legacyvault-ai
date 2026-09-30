import "server-only";

import { Button, Text } from "@react-email/components";

import { EmailLayout, button, paragraph } from "./layout";

/**
 * The one-time code for an emergency access request (FR-J003).
 *
 * The code is shown in the body and the link only carries the request id, so
 * forwarding the message does not hand anyone a working request.
 */
export function EmergencyCodeEmail({
  ownerName,
  code,
  verifyUrl,
}: {
  ownerName: string;
  code: string;
  verifyUrl: string;
}) {
  return (
    <EmailLayout
      preview={`Your verification code for ${ownerName}'s emergency access`}
      heading="Verify your emergency access request"
    >
      <Text style={paragraph}>
        You asked for emergency access to {ownerName}&apos;s LegacyVault. Enter this code to confirm
        it was you:
      </Text>
      <Text style={{ ...paragraph, fontSize: "30px", letterSpacing: "0.3em", fontWeight: 700 }}>
        {code}
      </Text>
      <Text style={paragraph}>
        The code expires in 15 minutes, and three wrong attempts end the request. After you verify,{" "}
        {ownerName} is asked to approve.
      </Text>
      <Button href={verifyUrl} style={button}>
        Enter the code
      </Button>
    </EmailLayout>
  );
}
