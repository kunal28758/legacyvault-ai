"use client";

import { useState } from "react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { useAssignVideo } from "@/hooks/use-videos";
import { ApiError } from "@/lib/api/client";
import type { VideoAssignment } from "@/lib/types/video";

interface AssignVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string | null;
  assignments: VideoAssignment[];
}

/**
 * Assigns a video message to a beneficiary.
 *
 * Assignment decides *who* may receive the video. Whether a given access link
 * can actually play it is a separate rule — the video's delivery condition —
 * which the database re-checks when the link is minted.
 */
export function AssignVideoDialog({
  open,
  onOpenChange,
  videoId,
  assignments,
}: AssignVideoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong sm:max-w-lg">
        {videoId && (
          <AssignForm
            key={videoId}
            videoId={videoId}
            assignments={assignments}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({
  videoId,
  assignments,
  onOpenChange,
}: {
  videoId: string;
  assignments: VideoAssignment[];
  onOpenChange: (open: boolean) => void;
}) {
  const beneficiariesQuery = useBeneficiaries();
  const assign = useAssignVideo();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const assigned = new Set(assignments.map((assignment) => assignment.beneficiaryId));
  const beneficiaries = (beneficiariesQuery.data?.items ?? []).filter(
    (beneficiary) => beneficiary.status !== "INACTIVE" && !assigned.has(beneficiary.id),
  );

  const submit = async () => {
    if (!selected) {
      setError("Choose a beneficiary");
      return;
    }
    try {
      await assign.mutateAsync({ id: videoId, beneficiaryId: selected });
      toast.success("Recipient added");
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not assign this video.");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a recipient</DialogTitle>
        <DialogDescription>
          Choose who this message is for. When they can watch it is decided by the video&rsquo;s
          delivery condition.
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
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={assign.isPending}>
          {assign.isPending ? "Saving…" : "Add recipient"}
        </Button>
      </DialogFooter>
    </>
  );
}
