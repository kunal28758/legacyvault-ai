import { Button, Text } from "@react-email/components";

import { EmailLayout, button, paragraph } from "./layout";

/**
 * The email that carries a beneficiary's access link.
 *
 * It says what was shared in the abstract — counts, not contents — and nothing
 * about the owner's estate. The link itself is the only sensitive element, and
 * it expires.
 */
export function AccessLinkEmail({
  beneficiaryName,
  ownerName,
  link,
  expiresAt,
  grantType,
}: {
  beneficiaryName: string;
  ownerName: string;
  link: string;
  expiresAt: string;
  grantType: "DIRECT_SHARE" | "DMS_RELEASE" | "EMERGENCY_ACCESS";
}) {
  const reason =
    grantType === "DMS_RELEASE"
      ? `${ownerName} set up LegacyVault to release information to you if they became unreachable. That has now happened.`
      : grantType === "EMERGENCY_ACCESS"
        ? `Your emergency access request for ${ownerName}'s LegacyVault has been approved.`
        : `${ownerName} has shared part of their LegacyVault with you.`;

  return (
    <EmailLayout
      preview={`${ownerName} shared secure access with you`}
      heading={`Access for ${beneficiaryName}`}
    >
      <Text style={paragraph}>{reason}</Text>
      <Text style={paragraph}>
        Open the secure link below. It is personal to you, works only for what was shared, and
        expires on {new Date(expiresAt).toUTCString()}.
      </Text>
      <Button href={link} style={button}>
        Open secure access
      </Button>
      <Text style={{ ...paragraph, marginTop: "20px", fontSize: "13px", color: "#64748b" }}>
        Do not forward this email. Anyone with the link can open what was shared with you until it
        expires.
      </Text>
    </EmailLayout>
  );
}
