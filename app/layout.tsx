import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";
import { isClerkConfigured } from "@/lib/config/public-env";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

// Display face for headings and headline numbers (docs/ui/DESIGN_SYSTEM.md § 2).
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "LegacyVault AI",
    template: "%s · LegacyVault AI",
  },
  description:
    "Security-first legal-tech platform to organize, protect and transfer your digital and physical legacy to the people you trust.",
  applicationName: "LegacyVault AI",
  icons: { icon: "/favicon.ico" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#060d1a" },
    { media: "(prefers-color-scheme: light)", color: "#f8fafd" },
  ],
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout (task T017). Dark-first theme is expressed through the `data-theme`
 * attribute (managed by next-themes in <Providers>); `suppressHydrationWarning`
 * covers the attribute swap on first paint. <ClerkProvider> wraps the tree as soon
 * as the publishable key exists (T195); without it the app still boots so the
 * public landing page and local tooling work (docs/DEPLOYMENT.md § Clerk).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Per-request CSP nonce injected by proxy.ts; next-themes needs it for its inline theme script.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const shell = (
    <html
      lang="en"
      data-theme="dark"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );

  if (!isClerkConfigured()) {
    return shell;
  }

  return (
    // `dynamic` makes Clerk render its own scripts through the nonce-aware
    // server component; without it the clerk-js tag carries no nonce and the
    // strict CSP from proxy.ts (T192/T024) blocks it. Every route in this app
    // is already dynamic (ADR-001 cache safety), so nothing is given up.
    <ClerkProvider
      dynamic
      appearance={{
        variables: {
          colorPrimary: "#0ea5ff",
          colorBackground: "#0c1628",
          colorForeground: "#eaf1fb",
          colorInput: "#0f1b30",
          colorInputForeground: "#eaf1fb",
          colorBorder: "rgba(160, 190, 230, 0.14)",
          borderRadius: "0.75rem",
        },
      }}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      {shell}
    </ClerkProvider>
  );
}
