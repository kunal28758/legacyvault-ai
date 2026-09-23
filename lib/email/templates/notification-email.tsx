import { Button, Text } from "@react-email/components";

import { EmailLayout, button, paragraph } from "./layout";

/** Delivers an in-app notification by email (FR-L003). */
export function NotificationEmail({
  title,
  content,
  appUrl,
}: {
  title: string;
  content: string;
  appUrl: string;
}) {
  return (
    <EmailLayout preview={title} heading={title}>
      <Text style={paragraph}>{content}</Text>
      <Button href={`${appUrl}/notifications`} style={button}>
        Open LegacyVault
      </Button>
    </EmailLayout>
  );
}
