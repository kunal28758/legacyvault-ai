import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * Shared shell for every LegacyVault email.
 *
 * Plain, high-contrast and text-first: these messages are read in clients that
 * strip CSS, and several of them are time-critical.
 */
export function EmailLayout({
  preview,
  heading,
  children,
}: {
  preview: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#0b1020", fontFamily: "Segoe UI, Helvetica, sans-serif" }}>
        <Container
          style={{
            margin: "32px auto",
            maxWidth: "560px",
            backgroundColor: "#ffffff",
            borderRadius: "16px",
            padding: "32px",
          }}
        >
          <Text style={{ margin: 0, fontSize: "13px", letterSpacing: "0.08em", color: "#6366f1" }}>
            LEGACYVAULT AI
          </Text>
          <Heading style={{ fontSize: "22px", lineHeight: "30px", color: "#0f172a" }}>
            {heading}
          </Heading>
          <Section>{children}</Section>
          <Text
            style={{ marginTop: "28px", fontSize: "12px", lineHeight: "18px", color: "#64748b" }}
          >
            LegacyVault AI never includes the contents of your vault in an email. If you were not
            expecting this message you can ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const paragraph = {
  fontSize: "15px",
  lineHeight: "24px",
  color: "#334155",
} as const;

export const button = {
  display: "inline-block",
  padding: "12px 20px",
  borderRadius: "10px",
  backgroundColor: "#4f46e5",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  textDecoration: "none",
} as const;
