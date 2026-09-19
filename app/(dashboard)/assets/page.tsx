import type { Metadata } from "next";

import { AssetsOverview } from "./_components/assets-overview";

export const metadata: Metadata = { title: "Assets" };

export default function AssetsPage() {
  return <AssetsOverview />;
}
