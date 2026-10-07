import type {
  Asset,
  AssetKind,
  DigitalAssetCategory,
  FinancialAssetCategory,
  PhysicalAssetCategory,
} from "@/lib/types/asset";
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

/**
 * The asset types the vault records, per class. Zod-free so browser-only
 * modules (dashboard, palette, intelligence) can read labels without pulling in
 * the validators; `asset.validators.ts` builds its enums from these lists.
 */
export const FINANCIAL_CATEGORIES: { value: FinancialAssetCategory; label: string }[] = [
  { value: "BANK_ACCOUNT", label: "Bank account" },
  { value: "FIXED_DEPOSIT", label: "Fixed deposit" },
  { value: "MUTUAL_FUND", label: "Mutual fund" },
  { value: "STOCK", label: "Stocks / shares" },
  { value: "INVESTMENT", label: "Other investment" },
  { value: "INSURANCE", label: "Insurance policy" },
  { value: "RETIREMENT", label: "Pension / retirement" },
  { value: "CRYPTOCURRENCY", label: "Cryptocurrency" },
  { value: "OTHER", label: "Other financial asset" },
];

export const PHYSICAL_CATEGORIES: { value: PhysicalAssetCategory; label: string }[] = [
  { value: "REAL_ESTATE", label: "Real estate" },
  { value: "VEHICLE", label: "Vehicle" },
  { value: "GOLD_JEWELRY", label: "Gold & jewellery" },
  { value: "PERSONAL_PROPERTY", label: "Valuables & personal property" },
  { value: "BUSINESS_ASSET", label: "Business ownership" },
  { value: "OTHER", label: "Other physical asset" },
];

export const DIGITAL_CATEGORIES: { value: DigitalAssetCategory; label: string }[] = [
  { value: "ONLINE_ACCOUNT", label: "Online / cloud account" },
  { value: "DOMAIN", label: "Domain" },
  { value: "WEBSITE", label: "Website" },
  { value: "SUBSCRIPTION", label: "Software / subscription" },
  { value: "SOCIAL_MEDIA", label: "Social account" },
  { value: "DIGITAL_BUSINESS", label: "Digital business" },
  { value: "INTELLECTUAL_PROPERTY", label: "Intellectual property" },
  { value: "CRYPTO_WALLET", label: "Crypto wallet" },
  { value: "OTHER", label: "Other digital asset" },
];

export const CATEGORIES_BY_KIND: Record<AssetKind, { value: string; label: string }[]> = {
  FINANCIAL_ASSET: FINANCIAL_CATEGORIES,
  PHYSICAL_ASSET: PHYSICAL_CATEGORIES,
  DIGITAL_ASSET: DIGITAL_CATEGORIES,
};

export function categoryLabel(kind: AssetKind, category: string): string {
  return (
    CATEGORIES_BY_KIND[kind].find((entry) => entry.value === category)?.label ?? titleCase(category)
  );
}

export function assetSubtitle(asset: Asset): string {
  const label = categoryLabel(asset.kind, asset.category);
  if (asset.kind === "FINANCIAL_ASSET")
    return [label, asset.institution].filter(Boolean).join(" · ");
  if (asset.kind === "PHYSICAL_ASSET") return [label, asset.location].filter(Boolean).join(" · ");
  return [label, asset.platform].filter(Boolean).join(" · ");
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
