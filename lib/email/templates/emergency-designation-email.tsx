import { Button, Text } from "@react-email/components";

import { EmailLayout, button, paragraph } from "./layout";

/** Tells a beneficiary they are an emergency contact, and where to ask (FR-J001). */
export function EmergencyDesignationEmail({
  beneficiaryName,
  ownerName,
  requestUrl,
}: {
  beneficiaryName: string;
  ownerName: string;
  requestUrl: string;
}) {
  return (
    <EmailLayout
      preview={`${ownerName} named you an emergency contact`}
      heading={`${ownerName} named you an emergency contact`}
    >
      <Text style={paragraph}>
        Hello {beneficiaryName}, {ownerName} has chosen you as someone who may ask for access to
        part of their LegacyVault in an emergency.
      </Text>
      <Text style={paragraph}>
        There is nothing to do now. Keep this message: if the day comes, this is where you ask. You
        will verify a one-time code, and {ownerName} decides.
      </Text>
      <Button href={requestUrl} style={button}>
        Request emergency access
      </Button>
    </EmailLayout>
  );
}
