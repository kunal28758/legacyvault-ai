import "server-only";

import { Link, Text } from "@react-email/components";

import { EmailLayout, paragraph } from "./layout";

/**
 * Tells a person they were named a beneficiary (api-contracts.md § Beneficiaries).
 *
 * A notification only. Nothing is shared by being named — access arrives later,
 * if ever, as a separate access-link email — so this message carries no link
 * that could be mistaken for access, no sign-up prompt (FR-D011), and nothing
 * about the owner's estate.
 */
export function BeneficiaryInvitationEmail({
  beneficiaryName,
  ownerName,
  appUrl,
}: {
  beneficiaryName: string;
  ownerName: string;
  appUrl: string;
}) {
  return (
    <EmailLayout
      preview={`${ownerName} named you a beneficiary`}
      heading={`${ownerName} named you a beneficiary`}
    >
      <Text style={paragraph}>
        Hello {beneficiaryName}, {ownerName} has named you as a beneficiary in LegacyVault AI, where
        they keep their estate planning information for the people they trust.
      </Text>
      <Text style={paragraph}>
        This is a notification only. It does not give you access to anything, and there is nothing
        you need to do now. If {ownerName} shares something with you, LegacyVault will send a
        separate email with a personal, secure link at that time.
      </Text>
      <Text style={paragraph}>
        If you have questions, please contact {ownerName} directly — replies to this email do not
        reach them.
      </Text>
      <Text style={paragraph}>
        You can learn more about LegacyVault AI at <Link href={appUrl}>{appUrl}</Link>.
      </Text>
    </EmailLayout>
  );
}
