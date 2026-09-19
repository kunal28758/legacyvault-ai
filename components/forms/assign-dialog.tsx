"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/forms/form-field";
import { AllocationBar } from "@/components/data-display/allocation-bar";
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
import { useDemoWorkspace } from "@/hooks/use-demo-workspace";
import { assignmentsForResource, resourceName } from "@/lib/demo/selectors";
import { useDemoStore } from "@/lib/demo/store";
import type { AssignmentResourceType } from "@/lib/demo/types";

interface AssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed resource (assign a beneficiary to it) … */
  resource?: { type: AssignmentResourceType; id: string } | null;
  /** … or fixed beneficiary (choose a resource for them). */
  beneficiaryId?: string | null;
}

const RESOURCE_LABEL: Record<AssignmentResourceType, string> = {
  FINANCIAL_ASSET: "Financial asset",
  PHYSICAL_ASSET: "Physical asset",
  DIGITAL_ASSET: "Digital asset",
  DOCUMENT: "Document",
  VIDEO_MESSAGE: "Video message",
};

/**
 * Assign a beneficiary to a resource with an allocation. Mirrors
 * `assign_beneficiary()`: Σ allocation per resource ≤ 100 %, inactive
 * beneficiaries refused, explicit confirmation required.
 */
export function AssignDialog({ open, onOpenChange, resource, beneficiaryId }: AssignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong sm:max-w-lg">
        <AssignForm
          onOpenChange={onOpenChange}
          resource={resource ?? null}
          beneficiaryId={beneficiaryId ?? null}
        />
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({
  onOpenChange,
  resource,
  beneficiaryId,
}: {
  onOpenChange: (open: boolean) => void;
  resource: { type: AssignmentResourceType; id: string } | null;
  beneficiaryId: string | null;
}) {
  const { workspace: ws } = useDemoWorkspace();
  const assign = useDemoStore((s) => s.assign);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<string>(beneficiaryId ?? "");
  const [selectedResource, setSelectedResource] = useState<string>(
    resource ? `${resource.type}:${resource.id}` : "",
  );
  const [allocation, setAllocation] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const resourceOptions = useMemo(() => {
    const options: { value: string; label: string; group: string }[] = [];
    for (const asset of ws.assets)
      options.push({
        value: `${asset.kind}:${asset.id}`,
        label: asset.name,
        group: RESOURCE_LABEL[asset.kind],
      });
    for (const doc of ws.documents)
      options.push({ value: `DOCUMENT:${doc.id}`, label: doc.name, group: "Document" });
    for (const video of ws.videos)
      options.push({
        value: `VIDEO_MESSAGE:${video.id}`,
        label: video.title,
        group: "Video message",
      });
    return options;
  }, [ws]);

  const [resType, resId] = (selectedResource || ":").split(":") as [
    AssignmentResourceType | "",
    string,
  ];
  const existing = resType && resId ? assignmentsForResource(ws, resType, resId) : [];
  const used = existing.reduce((sum, a) => sum + (a.allocationPercentage ?? 0), 0);
  const remaining = Math.max(0, 100 - used);
  const supportsAllocation = resType && resType !== "DOCUMENT" && resType !== "VIDEO_MESSAGE";
  const beneficiaries = ws.beneficiaries.filter((b) => b.status !== "INACTIVE");

  const submit = () => {
    if (!selectedBeneficiary) return setError("Choose a beneficiary");
    if (!resType || !resId) return setError("Choose a resource");
    let pct: number | null = null;
    if (supportsAllocation && allocation.trim() !== "") {
      pct = Number(allocation);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        return setError("Enter a percentage between 0 and 100");
    }
    const result = assign(selectedBeneficiary, resType, resId, pct);
    if (!result.ok) {
      setError(result.message ?? "Could not assign");
      return;
    }
    toast.success("Assignment saved");
    onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Assign beneficiary</DialogTitle>
        <DialogDescription>
          {resource
            ? `Assign someone to ${resourceName(ws, resource.type, resource.id)}.`
            : "Choose a resource and, for assets, the share this person receives."}{" "}
          Allocations per resource cannot exceed 100 %.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {!beneficiaryId && (
          <FormField label="Beneficiary" required>
            {(props) => (
              <Select
                value={selectedBeneficiary || null}
                onValueChange={(v) => setSelectedBeneficiary(String(v ?? ""))}
                items={beneficiaries.map((b) => ({ value: b.id, label: b.name }))}
              >
                <SelectTrigger id={props.id} className="w-full">
                  <SelectValue placeholder="Choose a beneficiary" />
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
        )}
        {!resource && (
          <FormField label="Resource" required>
            {(props) => (
              <Select
                value={selectedResource || null}
                onValueChange={(v) => setSelectedResource(String(v ?? ""))}
                items={resourceOptions.map((o) => ({ value: o.value, label: o.label }))}
              >
                <SelectTrigger id={props.id} className="w-full">
                  <SelectValue placeholder="Choose an asset, document or video" />
                </SelectTrigger>
                <SelectContent>
                  {resourceOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="text-muted-foreground">{o.group} · </span>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        )}
        {resType && resId && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground">Current allocation</p>
            <AllocationBar
              segments={existing
                .filter((a) => a.allocationPercentage)
                .map((a) => ({
                  id: a.id,
                  label:
                    ws.beneficiaries.find((b) => b.id === a.beneficiaryId)?.name ?? "Beneficiary",
                  value: a.allocationPercentage ?? 0,
                }))}
            />
          </div>
        )}
        {supportsAllocation ? (
          <FormField
            label="Allocation"
            hint={`${remaining}% still unallocated. Leave empty to assign without a percentage.`}
            optional
          >
            {(props) => (
              <div className="relative">
                <Input
                  {...props}
                  type="number"
                  min={0}
                  max={remaining}
                  step={1}
                  value={allocation}
                  onChange={(e) => setAllocation(e.target.value)}
                  className="pr-8"
                />
                <span className="absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  %
                </span>
              </div>
            )}
          </FormField>
        ) : resType ? (
          <p className="text-xs text-muted-foreground">
            Documents and videos are shared without a percentage.
          </p>
        ) : null}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={submit}>Confirm assignment</Button>
      </DialogFooter>
    </>
  );
}
