import type { Metadata } from "next";
import { Suspense } from "react";

import { AccessPortal } from "./_components/access-portal";

export const metadata: Metadata = {
  title: "Shared with you",
  // A link that reaches a mailbox must not reach a search index.
  robots: { index: false, follow: false },
};

/**
 * The page an access link opens (ADR-014 § 3).
 *
 * The token arrives as `?t=…`, is exchanged for a cookie immediately, and is
 * stripped from the address bar so it does not linger in history.
 */
export default function AccessPage() {
  return (
    <Suspense fallback={null}>
      <AccessPortal />
    </Suspense>
  );
}
