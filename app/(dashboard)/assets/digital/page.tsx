import type { Metadata } from "next";
import { Suspense } from "react";

import { AssetListView } from "@/components/data-display/asset-list-view";
import { PageSkeleton } from "@/components/shared/loading-skeleton";

export const metadata: Metadata = { title: "Digital Assets" };

export default function DigitalAssetsPage() {
  return (
    <Suspense fallback={<PageSkeleton stats={3} />}>
      <AssetListView kind="DIGITAL_ASSET" />
    </Suspense>
  );
}
