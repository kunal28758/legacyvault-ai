import type { Metadata } from "next";

import { SecurityCenterView } from "./_components/security-center-view";

export const metadata: Metadata = { title: "Security Center" };

export default function SecurityCenterPage() {
  return <SecurityCenterView />;
}
