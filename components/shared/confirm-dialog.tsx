"use client";

import { useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  /** When set, the user must tick this acknowledgement before confirming. */
  acknowledgement?: string;
  /** Explains that the real operation requires Clerk re-verification (FR-A018). */
  requiresReverification?: boolean;
  onConfirm: () => void | Promise<void>;
  children?: React.ReactNode;
}

/**
 * Confirmation for destructive / authoritative actions (task T167). Authoritative
 * changes in LegacyVault always require an explicit confirmation (constitution V).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  acknowledgement,
  requiresReverification,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) setAcknowledged(false);
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      handleOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const Icon = variant === "destructive" ? AlertTriangle : ShieldAlert;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="glass-strong sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "icon-tile size-10 rounded-xl",
                variant === "destructive"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-primary/12 text-primary",
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="space-y-1.5">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {children}
        {requiresReverification && (
          <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
            In the live application this step asks you to re-verify with Clerk before it takes
            effect, and the action is written to your audit log.
          </p>
        )}
        {acknowledgement && (
          <Label className="items-start gap-3 rounded-lg border border-border p-3 font-normal">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(Boolean(value))}
              className="mt-0.5"
            />
            <span className="text-sm leading-5">{acknowledgement}</span>
          </Label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={handleConfirm}
            loading={busy}
            disabled={Boolean(acknowledgement) && !acknowledged}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
