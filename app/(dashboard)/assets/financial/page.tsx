import type { Metadata } from "next";
import { Suspense } from "react";

import { AssetListView } from "@/components/assets/asset-list-view";
import { PageSkeleton } from "@/components/shared/loading-skeleton";

export const metadata: Metadata = { title: "Financial Assets" };

export default function FinancialAssetsPage() {
  return (
    <Suspense fallback={<PageSkeleton stats={3} />}>
      <AssetListView kind="FINANCIAL_ASSET" />
    </Suspense>
  );
}
