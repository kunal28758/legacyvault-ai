import "server-only";

import { Text } from "@react-email/components";

import { EmailLayout, paragraph } from "./layout";

/**
 * Tells a beneficiary that another document was shared with them.
 *
 * It carries no link and no secret: their existing secure link follows what is
 * shared with them and already shows the new document (migration 0011 keeps it
 * the only one). Nothing about the document is named.
 */
export function DocumentSharedNoticeEmail({
  beneficiaryName,
  ownerName,
}: {
  beneficiaryName: string;
  ownerName: string;
}) {
  return (
    <EmailLayout
      preview={`${ownerName} shared another document with you`}
      heading={`${ownerName} shared another document with you`}
    >
      <Text style={paragraph}>
        Hello {beneficiaryName}, {ownerName} has shared another document with you in LegacyVault AI.
      </Text>
      <Text style={paragraph}>
        Open the secure link from the earlier email {ownerName} sent you — it now includes this
        document. This email has no link of its own, by design.
      </Text>
      <Text style={paragraph}>
        If you cannot find that email, or the link has expired, ask {ownerName} to send you a new
        one.
      </Text>
      <Text style={{ ...paragraph, fontSize: "13px", color: "#64748b" }}>
        Replies to this email do not reach {ownerName}.
      </Text>
    </EmailLayout>
  );
}
