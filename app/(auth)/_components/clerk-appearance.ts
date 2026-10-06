import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof SignIn>["appearance"]>;

/** Glassmorphism appearance for Clerk's auth components (constitution XIII). */
export const clerkAuthAppearance: Appearance = {
  variables: {
    colorPrimary: "#0ea5ff",
    colorBackground: "transparent",
    colorForeground: "#eaf1fb",
    colorMutedForeground: "#8fa3bf",
    colorInput: "rgba(15, 27, 48, 0.85)",
    colorInputForeground: "#eaf1fb",
    colorBorder: "rgba(160, 190, 230, 0.14)",
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
      "bg-primary text-primary-foreground shadow-cta transition-[filter,box-shadow] hover:brightness-110 hover:shadow-glow-blue",
    footer: "bg-transparent",
    footerAction: "bg-transparent",
  },
};
