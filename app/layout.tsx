import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
    { media: "(prefers-color-scheme: dark)", color: "#12131f" },
    { media: "(prefers-color-scheme: light)", color: "#fafafc" },
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
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
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
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#6d8dff",
          colorBackground: "#1a1c2e",
          colorForeground: "#f2f3fa",
          colorInput: "#22243a",
          colorInputForeground: "#f2f3fa",
          colorBorder: "rgba(255, 255, 255, 0.1)",
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
