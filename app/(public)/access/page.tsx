import type { Metadata } from "next";

import { AccessPortal } from "./_components/access-portal";

export const metadata: Metadata = {
  title: "Shared with you",
  // A link that reaches a mailbox must not reach a search index.
  robots: { index: false, follow: false },
};

/**
 * The page an access link opens (ADR-014 § 3).
 *
 * The token arrives in the fragment (`#t=…`), so it never reaches a server;
 * the page strips it from the address bar and history, then exchanges it in a
 * POST body for a short-lived HttpOnly cookie.
 */
export default function AccessPage() {
  return <AccessPortal />;
}
