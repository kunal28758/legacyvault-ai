"use client";

import { useState } from "react";
import { toast } from "sonner";

import { AllocationBar } from "@/components/data-display/allocation-bar";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssignBeneficiary } from "@/hooks/use-assets";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { ApiError } from "@/lib/api/client";
import type { AssetAssignment, AssetKind } from "@/lib/types/asset";

interface AssignAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: AssetKind;
  assetId: string | null;
  assetName?: string;
  assignments: AssetAssignment[];
  remainingPercentage: number;
}

/**
 * Assign a beneficiary to an asset (FR-D005).
 *
 * The dialog mirrors `assign_beneficiary()` rather than duplicating it: the
 * allocation hint is advisory, and the Σ ≤ 100 rule, the INACTIVE-beneficiary
 * rule and the duplicate check are all decided by the function inside a
 * transaction. Errors it raises are shown here verbatim from the API.
 */
export function AssignAssetDialog(props: AssignAssetDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="glass-strong sm:max-w-lg">
        {props.assetId && <AssignForm key={props.assetId} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({
  onOpenChange,
  kind,
  assetId,
  assetName,
  assignments,
  remainingPercentage,
}: AssignAssetDialogProps) {
  const beneficiariesQuery = useBeneficiaries();
  const assign = useAssignBeneficiary(kind);
  const [selected, setSelected] = useState("");
  const [allocation, setAllocation] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Already-assigned people cannot be assigned twice (409 ALREADY_ASSIGNED).
  const assignedIds = new Set(assignments.map((assignment) => assignment.beneficiaryId));
  const beneficiaries = (beneficiariesQuery.data?.items ?? []).filter(
    (beneficiary) => beneficiary.status !== "INACTIVE" && !assignedIds.has(beneficiary.id),
  );

  const submit = async () => {
    if (!assetId) return;
    if (!selected) {
      setError("Choose a beneficiary");
      return;
    }
    let percentage: number | null = null;
    if (allocation.trim() !== "") {
      percentage = Number(allocation);
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        setError("Enter a percentage between 0 and 100");
        return;
      }
    }

    try {
      await assign.mutateAsync({
        id: assetId,
        beneficiaryId: selected,
        allocationPercentage: percentage,
      });
      toast.success("Assignment saved");
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save this assignment.");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Assign beneficiary</DialogTitle>
        <DialogDescription>
          {assetName ? `Assign someone to ${assetName}.` : "Assign someone to this asset."}{" "}
          Allocations per asset cannot exceed 100%.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <FormField label="Beneficiary" required error={error ?? undefined}>
          {(props) => (
            <Select
              value={selected || null}
              onValueChange={(value) => {
                setSelected(String(value ?? ""));
                setError(null);
              }}
              items={beneficiaries.map((b) => ({ value: b.id, label: b.name }))}
            >
              <SelectTrigger id={props.id} className="w-full">
                <SelectValue
                  placeholder={
                    beneficiariesQuery.isPending
                      ? "Loading beneficiaries…"
                      : beneficiaries.length === 0
                        ? "No eligible beneficiaries"
                        : "Choose a beneficiary"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {beneficiaries.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} · {b.relationship}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>

        {assignments.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground">Current allocation</p>
            <AllocationBar
              segments={assignments
                .filter((assignment) => assignment.allocationPercentage)
                .map((assignment) => ({
                  id: assignment.id,
                  label: assignment.beneficiaryName,
                  value: assignment.allocationPercentage ?? 0,
                }))}
            />
          </div>
        )}

        <FormField
          label="Allocation"
          optional
          hint={`${remainingPercentage}% still unallocated. Leave empty to assign without a percentage.`}
        >
          {(props) => (
            <div className="relative">
              <Input
                {...props}
                type="number"
                min={0}
                max={100}
                step={1}
                value={allocation}
                onChange={(event) => setAllocation(event.target.value)}
                className="pr-8"
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                %
              </span>
            </div>
          )}
        </FormField>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={assign.isPending}>
          {assign.isPending ? "Saving…" : "Confirm assignment"}
        </Button>
      </DialogFooter>
    </>
  );
}
