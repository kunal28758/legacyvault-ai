import type { Asset, AssetKind } from "@/lib/types/asset";
import { titleCase } from "@/lib/format";

/**
 * Presentation metadata for the three asset classes.
 *
 * Lifted out of the demo layer so the asset and plan UI no longer import it;
 * the values themselves are unchanged, which keeps the colour tokens on the
 * charts and cards stable.
 */
export const ASSET_KIND_META: Record<
  AssetKind,
  { label: string; plural: string; href: string; vizToken: "viz-1" | "viz-2" | "viz-3" }
> = {
  FINANCIAL_ASSET: {
    label: "Financial",
    plural: "Financial assets",
    href: "/assets/financial",
    vizToken: "viz-1",
  },
  PHYSICAL_ASSET: {
    label: "Physical",
    plural: "Physical assets",
    href: "/assets/physical",
    vizToken: "viz-2",
  },
  DIGITAL_ASSET: {
    label: "Digital",
    plural: "Digital assets",
    href: "/assets/digital",
    vizToken: "viz-3",
  },
};

export function assetSubtitle(asset: Asset): string {
  if (asset.kind === "FINANCIAL_ASSET")
    return [titleCase(asset.category), asset.institution].filter(Boolean).join(" · ");
  if (asset.kind === "PHYSICAL_ASSET")
    return [titleCase(asset.category), asset.location].filter(Boolean).join(" · ");
  return [titleCase(asset.category), asset.platform].filter(Boolean).join(" · ");
}

/** Whether this asset holds any application-encrypted value. */
export function hasSensitiveFields(asset: Asset): boolean {
  if (asset.kind === "FINANCIAL_ASSET") return asset.hasAccountNumber || asset.hasPolicyNumber;
  if (asset.kind === "DIGITAL_ASSET") return asset.hasCredentials || asset.hasRecoveryInfo;
  return false;
}

export function assetTotal(assets: readonly Asset[]): number {
  return assets.reduce((sum, asset) => sum + (asset.estimatedValue ?? 0), 0);
}
