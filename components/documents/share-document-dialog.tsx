"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  BeneficiaryChoiceNotice,
  beneficiaryChoice,
  beneficiaryChoicePlaceholder,
} from "@/components/beneficiaries/beneficiary-choice";
import { FormField } from "@/components/shared/form-field";
import { OperationProgress } from "@/components/shared/operation-progress";
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
import { ApiError } from "@/lib/client/api-client";

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
 * caller and an INACTIVE beneficiary is refused. The server then emails the
 * beneficiary a link that follows their shares, so this document — and any
 * shared later — appears in it, and unsharing removes it at once.
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
  const [failure, setFailure] = useState<string | null>(null);

  const alreadyShared = new Set((documentQuery.data?.shares ?? []).map((s) => s.beneficiaryId));
  const choice = beneficiaryChoice(beneficiariesQuery, alreadyShared);
  const beneficiaries = choice.state === "ready" ? choice.options : [];

  const submit = async () => {
    if (share.isPending) return;
    if (!selected) {
      setError("Choose a beneficiary");
      return;
    }
    setFailure(null);
    try {
      const result = await share.mutateAsync({ id: documentId, beneficiaryId: selected });
      toast.success("Document shared", {
        description: result.accessEmailSent
          ? "We emailed them a secure link to everything you have shared with them."
          : "The email could not be sent. Any link they already have shows it; otherwise send one from their Access links.",
      });
      onOpenChange(false);
    } catch (caught) {
      setFailure(caught instanceof ApiError ? caught.message : "Could not share this document.");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share document</DialogTitle>
        <DialogDescription>
          We email them a secure link to everything you have shared with them. Unsharing removes
          access straight away.
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
              disabled={share.isPending}
            >
              <SelectTrigger id={props.id} className="w-full">
                <SelectValue placeholder={beneficiaryChoicePlaceholder(choice)} />
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
        <BeneficiaryChoiceNotice
          choice={choice}
          resource="document"
          onRetry={() => void beneficiariesQuery.refetch()}
          retrying={beneficiariesQuery.isFetching}
        />
        {/* One request records the share, issues the link and sends the email;
            the browser only learns the outcome, so no stage is invented. */}
        {share.isPending && (
          <OperationProgress label="Sharing securely — recording the share and emailing a secure link…" />
        )}
        {failure && !share.isPending && (
          <OperationProgress
            state="error"
            label="The document was not shared."
            error={failure}
            onRetry={() => void submit()}
          />
        )}
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
