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
  /** Masked hint such as "•••• 4821", when one is available without decrypting. */
  hint?: string | null;
  present?: boolean;
  /**
   * Fetches the plaintext from the re-verified decrypt endpoint. Resolves with
   * the value, or rejects — the message is shown in the dialog. Without it the
   * dialog only explains the gate.
   */
  onReveal?: () => Promise<string | null>;
  className?: string;
}

/**
 * Presents an application-encrypted field (FR-A018, FR-G004).
 *
 * The plaintext is never part of the surrounding data: it is fetched on demand
 * through `GET /assets/:type/:id/decrypt`, which requires Clerk step-up
 * verification and writes an audit row. It is held in local state only while
 * the dialog is open and dropped when it closes, so it never reaches the query
 * cache or a re-render of the page behind it.
 */
export function MaskedField({
  label,
  hint,
  present = true,
  onReveal,
  className,
}: MaskedFieldProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setValue(null);
      setError(null);
    }
  };

  const reveal = async () => {
    setOpen(true);
    if (!onReveal) return;
    setLoading(true);
    setError(null);
    try {
      setValue(await onReveal());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reveal this value.");
    } finally {
      setLoading(false);
    }
  };

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
        <Button variant="ghost" size="sm" onClick={() => void reveal()}>
          <Eye data-icon="inline-start" />
          Reveal
        </Button>
      )}
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="glass-strong">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-cyan/15 text-brand-cyan">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <div className="space-y-1.5">
                <DialogTitle>{label}</DialogTitle>
                <DialogDescription>
                  Stored encrypted (AES-256-GCM) and decrypted server-side only after you re-verify
                  your identity. Every reveal is written to your audit log.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {!onReveal ? (
            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
              There is nothing to reveal for this record.
            </p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Decrypting…</p>
          ) : error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : value ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm break-all">
              {value}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No value is stored for this field.</p>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
