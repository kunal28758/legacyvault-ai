import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/loading-skeleton";

import { AssetVault } from "./_components/asset-vault";

export const metadata: Metadata = { title: "Asset Vault" };

export default function AssetsPage() {
  return (
    <Suspense fallback={<PageSkeleton stats={4} />}>
      <AssetVault />
    </Suspense>
  );
}
