/**
 * Owner-maintained asset profile: the legacy facts about an asset that the
 * three asset tables do not have columns for. Stored under the asset row's
 * `metadata.profile` — the owner's existing Class A metadata write (column
 * grant + RLS in 0002) — so no migration is needed, and the beneficiary portal
 * never sees it (`assetView()` selects named columns only).
 *
 * Secrets never belong here. `instructions` describes where or how a
 * credential is managed ("in my password manager under Bank"), never the
 * credential itself; the validator refuses text that looks like a private key
 * or a recovery phrase.
 *
 * Dependency-free so the browser can use it without pulling in zod; the schema
 * that validates writes lives in lib/validators/asset-profile.
 */
export const ASSET_STATUSES = ["ACTIVE", "SOLD", "CLOSED", "TRANSFERRED"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  ACTIVE: "Active",
  SOLD: "Sold",
  CLOSED: "Closed",
  TRANSFERRED: "Transferred",
};

export interface AssetNominee {
  name: string;
  relationship?: string | null;
  /** Set when the nominee is one of the owner's beneficiaries. */
  beneficiaryId?: string | null;
}

export interface AssetProfile {
  /** Absent means ACTIVE: the owner still holds the asset. */
  status?: AssetStatus | null;
  /** YYYY-MM-DD. */
  acquiredOn?: string | null;
  /** When the owner wants to look at this asset again, YYYY-MM-DD. */
  reviewOn?: string | null;
  /** When it lapses or renews — a policy, a lease, a domain — YYYY-MM-DD. */
  expiresOn?: string | null;
  /** The last time the owner confirmed this record is current, YYYY-MM-DD. */
  lastReviewedOn?: string | null;
  /** The nominee registered with the institution, if any. */
  nominee?: AssetNominee | null;
  /** What should happen to it, and where its access details are kept. */
  instructions?: string | null;
}

/** Whether the owner still holds the asset (rules about coverage only apply then). */
export function isHeld(profile: AssetProfile | null | undefined): boolean {
  return (profile?.status ?? "ACTIVE") === "ACTIVE";
}
