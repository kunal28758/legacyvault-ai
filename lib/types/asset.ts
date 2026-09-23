import type { Database } from "@/lib/types/database";

/**
 * Asset view models shared by the server and the browser.
 *
 * The three asset classes are one union discriminated by `kind`, matching the
 * three tables in 0001_init.sql. Encrypted columns never appear here: a normal
 * read reports only whether a value exists, and the plaintext is available
 * exclusively through the re-verified `/decrypt` endpoint.
 */
export type AssetKind = "FINANCIAL_ASSET" | "PHYSICAL_ASSET" | "DIGITAL_ASSET";
export type AssetTypeSlug = "financial" | "physical" | "digital";

export type FinancialAssetCategory = Database["public"]["Enums"]["financial_asset_category"];
export type PhysicalAssetCategory = Database["public"]["Enums"]["physical_asset_category"];
export type DigitalAssetCategory = Database["public"]["Enums"]["digital_asset_category"];

export const ASSET_SLUG_BY_KIND: Record<AssetKind, AssetTypeSlug> = {
  FINANCIAL_ASSET: "financial",
  PHYSICAL_ASSET: "physical",
  DIGITAL_ASSET: "digital",
};

export const ASSET_KIND_BY_SLUG: Record<AssetTypeSlug, AssetKind> = {
  financial: "FINANCIAL_ASSET",
  physical: "PHYSICAL_ASSET",
  digital: "DIGITAL_ASSET",
};

interface AssetBase {
  id: string;
  name: string;
  estimatedValue: number | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialAsset extends AssetBase {
  kind: "FINANCIAL_ASSET";
  category: FinancialAssetCategory;
  institution: string | null;
  /** Presence only — the ciphertext never leaves the server. */
  hasAccountNumber: boolean;
  hasPolicyNumber: boolean;
}

export interface PhysicalAsset extends AssetBase {
  kind: "PHYSICAL_ASSET";
  category: PhysicalAssetCategory;
  description: string | null;
  location: string | null;
  ownershipDetails: string | null;
}

export interface DigitalAsset extends AssetBase {
  kind: "DIGITAL_ASSET";
  category: DigitalAssetCategory;
  platform: string | null;
  username: string | null;
  hasCredentials: boolean;
  hasRecoveryInfo: boolean;
}

export type Asset = FinancialAsset | PhysicalAsset | DigitalAsset;

/** One assignment of this asset, resolved with the beneficiary's display name. */
export interface AssetAssignment {
  id: string;
  beneficiaryId: string;
  beneficiaryName: string;
  allocationPercentage: number | null;
  createdAt: string;
}

export interface AssetWithAssignments {
  asset: Asset;
  assignments: AssetAssignment[];
  /** Σ of the allocations already made against this asset. */
  allocatedPercentage: number;
  remainingPercentage: number;
}

export interface AssetListResult {
  items: AssetWithAssignments[];
  total: number;
  page: number;
  limit: number;
}

export interface AssetAssignmentsResult {
  items: AssetAssignment[];
  allocatedPercentage: number;
  remainingPercentage: number;
}

/** Returned only by `/decrypt`, only after re-verification, and always audited. */
export interface RevealedSensitiveFields {
  accountNumber?: string | null;
  policyNumber?: string | null;
  credentials?: string | null;
  recoveryInfo?: string | null;
}
