import "server-only";

import { Text } from "@react-email/components";

import { EmailLayout, paragraph } from "./layout";

/**
 * Tells a trusted contact that an owner's emergency release workflow started.
 *
 * It claims nothing about why: no recent activity is not proof of anything.
 * It carries no link, no scope and nothing from the vault — only that the
 * workflow started, that the owner can stop it, and what would come next.
 */
export function DmsContactNoticeEmail({
  beneficiaryName,
  ownerName,
}: {
  beneficiaryName: string;
  ownerName: string;
}) {
  return (
    <EmailLayout
      preview={`${ownerName}'s emergency release workflow has started`}
      heading={`${ownerName}'s emergency release workflow has started`}
    >
      <Text style={paragraph}>
        Hello {beneficiaryName}, {ownerName} keeps an emergency release plan in LegacyVault AI and
        chose you as a trusted contact.
      </Text>
      <Text style={paragraph}>
        The workflow started because no recent activity was detected on their account. That does not
        mean anything has happened to them, and nothing has been shared with you.
      </Text>
      <Text style={paragraph}>
        If you can, please contact {ownerName} and ask them to sign in to LegacyVault. Signing in
        and checking in stops the workflow.
      </Text>
      <Text style={paragraph}>
        If the workflow completes, LegacyVault will send a separate email with a personal, secure
        link. You will be asked for a code sent to this address before anything opens.
      </Text>
      <Text style={{ ...paragraph, fontSize: "13px", color: "#64748b" }}>
        Replies to this email do not reach {ownerName}.
      </Text>
    </EmailLayout>
  );
}
