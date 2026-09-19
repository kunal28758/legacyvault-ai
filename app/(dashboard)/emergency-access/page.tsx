import type { Metadata } from "next";

import { EmergencyAccessView } from "./_components/emergency-access-view";

export const metadata: Metadata = { title: "Emergency Access" };

export default function EmergencyAccessPage() {
  return <EmergencyAccessView />;
}
