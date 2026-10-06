import type { Metadata } from "next";

import { ActionCentreView } from "./_components/action-centre-view";

export const metadata: Metadata = { title: "Action Centre" };

export default function ActionCentrePage() {
  return <ActionCentreView />;
}
