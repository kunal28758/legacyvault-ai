import "server-only";

import { Button, Text } from "@react-email/components";

import { EmailLayout, button, paragraph } from "./layout";

/**
 * A one-time code: for an emergency access request (FR-J003), or for opening
 * a release link (the contact proves control of this mailbox before anything
 * in the release is shown).
 *
 * The code is shown in the body. An emergency link only carries the request
 * id, and a release code is entered on the page that asked for it, so
 * forwarding the message does not hand anyone working access.
 */
export function EmergencyCodeEmail({
  ownerName,
  code,
  verifyUrl,
  purpose = "emergency",
  beneficiaryName,
}: {
  ownerName: string;
  code: string;
  verifyUrl?: string;
  purpose?: "emergency" | "release";
  beneficiaryName?: string;
}) {
  if (purpose === "release") {
    return (
      <EmailLayout preview="Your LegacyVault verification code" heading="Confirm it is you">
        <Text style={paragraph}>
          Hello {beneficiaryName}, you opened the secure link {ownerName} arranged for you in
          LegacyVault. Enter this code on that page to confirm it is you:
        </Text>
        <Text style={{ ...paragraph, fontSize: "30px", letterSpacing: "0.3em", fontWeight: 700 }}>
          {code}
        </Text>
        <Text style={paragraph}>
          The code expires in 15 minutes. Three wrong attempts end it; open the link again for a new
          code.
        </Text>
        <Text style={{ ...paragraph, fontSize: "13px", color: "#64748b" }}>
          If you did not just open that link, ignore this email. Nothing opens without the code.
        </Text>
      </EmailLayout>
    );
  }

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
      {verifyUrl && (
        <Button href={verifyUrl} style={button}>
          Enter the code
        </Button>
      )}
    </EmailLayout>
  );
}
