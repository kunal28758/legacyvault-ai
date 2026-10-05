"use client";

import { Button } from "@/components/ui/button";
import type { BeneficiaryListResult, BeneficiaryWithRoles } from "@/lib/types/beneficiary";

/**
 * Who can be picked in an assignment dialog — and, when nobody can, why.
 *
 * Eligibility mirrors `assign_beneficiary()`: anyone who is not INACTIVE (so a
 * PENDING beneficiary qualifies) and does not already hold this resource. The
 * server still decides; this only keeps an empty list from being described as
 * "no eligible beneficiaries" when the truth is a failed load, an empty roster,
 * everyone already assigned, or only inactive people.
 */
export type BeneficiaryChoice =
  | { state: "loading" }
  | { state: "error" }
  | { state: "none" }
  | { state: "all-assigned" }
  | { state: "only-inactive" }
  | { state: "ready"; options: BeneficiaryWithRoles[] };

export function beneficiaryChoice(
  query: { data?: BeneficiaryListResult; isError: boolean },
  alreadyAssigned: ReadonlySet<string>,
): BeneficiaryChoice {
  const items = query.data?.items;
  if (!items) return query.isError ? { state: "error" } : { state: "loading" };
  if (items.length === 0) return { state: "none" };

  const assignable = items.filter((beneficiary) => beneficiary.status !== "INACTIVE");
  if (assignable.length === 0) return { state: "only-inactive" };

  const options = assignable.filter((beneficiary) => !alreadyAssigned.has(beneficiary.id));
  if (options.length === 0) return { state: "all-assigned" };
  return { state: "ready", options };
}

const PLACEHOLDER: Record<BeneficiaryChoice["state"], string> = {
  loading: "Loading beneficiaries…",
  error: "Beneficiaries could not be loaded",
  none: "No beneficiaries yet",
  "all-assigned": "Everyone eligible already has this",
  "only-inactive": "Only inactive beneficiaries",
  ready: "Choose a beneficiary",
};

export function beneficiaryChoicePlaceholder(choice: BeneficiaryChoice): string {
  return PLACEHOLDER[choice.state];
}

/** The explanation under the picker; nothing while loading or when there is a choice. */
export function BeneficiaryChoiceNotice({
  choice,
  resource,
  onRetry,
  retrying,
}: {
  choice: BeneficiaryChoice;
  /** What is being assigned, e.g. "document" — used in "already has this …". */
  resource: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  switch (choice.state) {
    case "error":
      return (
        <div role="alert" className="flex items-center justify-between gap-3 text-sm">
          <span className="text-destructive">Your beneficiaries could not be loaded.</span>
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      );
    case "none":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          You have no beneficiaries yet. Add one on the Beneficiaries page first.
        </p>
      );
    case "all-assigned":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Every active or pending beneficiary already has this {resource}.
        </p>
      );
    case "only-inactive":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          All your beneficiaries are inactive. Reactivate one on the Beneficiaries page to choose
          them here.
        </p>
      );
    default:
      return null;
  }
}
