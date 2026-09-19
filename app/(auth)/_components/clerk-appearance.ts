import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof SignIn>["appearance"]>;

/** Glassmorphism appearance for Clerk's auth components (constitution XIII). */
export const clerkAuthAppearance: Appearance = {
  variables: {
    colorPrimary: "#6d8dff",
    colorBackground: "transparent",
    colorForeground: "#f2f3fa",
    colorMutedForeground: "#a9adc4",
    colorInput: "rgba(34, 36, 58, 0.8)",
    colorInputForeground: "#f2f3fa",
    colorBorder: "rgba(255, 255, 255, 0.12)",
    borderRadius: "0.75rem",
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none",
    card: "glass glass-highlight rounded-2xl p-6 sm:p-8",
    headerTitle: "text-xl font-semibold tracking-tight",
    headerSubtitle: "text-muted-foreground",
    formButtonPrimary:
      "bg-gradient-brand text-primary-foreground shadow-glow-blue hover:opacity-90",
    footer: "bg-transparent",
    footerAction: "bg-transparent",
  },
};
