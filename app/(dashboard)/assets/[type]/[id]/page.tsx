import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AssetDetailView } from "@/components/assets/asset-detail-view";
import { ASSET_KIND_BY_SLUG, type AssetTypeSlug } from "@/lib/types/asset";

export const metadata: Metadata = { title: "Asset" };

/**
 * One asset. The id is only ever resolved through the owner-scoped asset API,
 * so an id that is not the caller's renders the same "not found" state as one
 * that does not exist.
 */
export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  if (!Object.hasOwn(ASSET_KIND_BY_SLUG, type)) notFound();
  return <AssetDetailView kind={ASSET_KIND_BY_SLUG[type as AssetTypeSlug]} id={id} />;
}
