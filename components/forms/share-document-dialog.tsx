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
import { useDocument, useShareDocument } from "@/hooks/use-documents";
import { ApiError } from "@/lib/api/client";

interface ShareDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string | null;
}

/**
 * Shares a vault document with a beneficiary.
 *
 * A share is a `beneficiary_assignments` row, so it runs through
 * `assign_beneficiary()` and inherits its checks: both sides must belong to the
 * caller and an INACTIVE beneficiary is refused. Sharing does **not** hand out
 * a link — it makes the document eligible to appear in the scope of one.
 */
export function ShareDocumentDialog({ open, onOpenChange, documentId }: ShareDocumentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong sm:max-w-lg">
        {documentId && (
          <ShareForm key={documentId} documentId={documentId} onOpenChange={onOpenChange} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ShareForm({
  documentId,
  onOpenChange,
}: {
  documentId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const beneficiariesQuery = useBeneficiaries();
  const documentQuery = useDocument(documentId);
  const share = useShareDocument();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const alreadyShared = new Set((documentQuery.data?.shares ?? []).map((s) => s.beneficiaryId));
  const beneficiaries = (beneficiariesQuery.data?.items ?? []).filter(
    (beneficiary) => beneficiary.status !== "INACTIVE" && !alreadyShared.has(beneficiary.id),
  );

  const submit = async () => {
    if (!selected) {
      setError("Choose a beneficiary");
      return;
    }
    try {
      await share.mutateAsync({ id: documentId, beneficiaryId: selected });
      toast.success("Document shared", {
        description: "They can open it through a scoped access link you issue.",
      });
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not share this document.");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share document</DialogTitle>
        <DialogDescription>
          Sharing makes this document eligible for a beneficiary&rsquo;s access link. It does not
          send anything on its own.
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
        <Button onClick={() => void submit()} disabled={share.isPending}>
          {share.isPending ? "Sharing…" : "Share document"}
        </Button>
      </DialogFooter>
    </>
  );
}
