import type { ReactNode } from "react";

import { isClerkConfigured } from "@/lib/config/public-env";

import { SiteFooter } from "./_components/site-footer";
import { SiteNavbar } from "./_components/site-navbar";

/** Public marketing shell: sticky glass navbar + footer with the legal-tech disclaimer. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-1 flex-col bg-gradient-surface">
      <SiteNavbar clerkEnabled={isClerkConfigured()} />
      <main className="flex flex-1 flex-col">{children}</main>
      <SiteFooter />
    </div>
  );
}
