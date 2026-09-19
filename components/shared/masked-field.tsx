"use client";

import { useState } from "react";
import { Eye, Lock, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface MaskedFieldProps {
  label: string;
  /** Masked hint such as "•••• 4821". Plaintext never reaches the client without re-verification. */
  hint?: string | null;
  present?: boolean;
  className?: string;
}

/**
 * Presents an application-encrypted field. The "Reveal" action explains the
 * re-verification gate (FR-A018, FR-G004) — the decrypt endpoint does not exist
 * in the demo workspace, so nothing is ever shown in plaintext here.
 */
export function MaskedField({ label, hint, present = true, className }: MaskedFieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <p className="flex items-center gap-1.5 font-mono text-sm">
          <Lock className="size-3.5 text-brand-cyan" aria-hidden />
          {present ? (
            (hint ?? "••••••••••")
          ) : (
            <span className="text-muted-foreground">Not provided</span>
          )}
        </p>
      </div>
      {present && (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Eye data-icon="inline-start" />
          Reveal
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-strong">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-cyan/15 text-brand-cyan">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <div className="space-y-1.5">
                <DialogTitle>Re-verification required</DialogTitle>
                <DialogDescription>
                  {label} is stored encrypted (AES-256-GCM) and is only decrypted server-side after
                  you re-verify your identity. Every reveal is written to your audit log.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
            The demo workspace holds no encrypted values, so there is nothing to reveal here. In the
            live application this opens Clerk’s step-up verification and then calls the decrypt
            endpoint.
          </p>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
