"use client";

import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * Work in flight, told honestly.
 *
 * `value` is a real percentage reported by the transfer itself. When the work
 * cannot be measured — a server-side check, a single API call — leave it null:
 * the bar shows activity without a number (`role="progressbar"`, no
 * `aria-valuenow`) instead of an invented one.
 */
export function ProgressLine({
  label,
  value = null,
  className,
}: {
  /** Accessible name of the progress bar. */
  label: string;
  value?: number | null;
  className?: string;
}) {
  return (
    <Progress value={value} aria-label={label} className={className}>
      <ProgressTrack className="h-1.5">
        {/* Indeterminate: a third of the track sliding across — never a full bar,
            which would read as finished. Reduced motion: still, and faded. */}
        <ProgressIndicator className="bg-gradient-brand data-[indeterminate]:w-1/3 data-[indeterminate]:animate-progress-indeterminate data-[indeterminate]:transition-none motion-reduce:data-[indeterminate]:w-full motion-reduce:data-[indeterminate]:animate-none motion-reduce:data-[indeterminate]:opacity-40" />
      </ProgressTrack>
    </Progress>
  );
}

/** A labelled operation: what is happening, its progress, and how it ended. */
export function OperationProgress({
  label,
  value = null,
  state = "running",
  error,
  onRetry,
  onCancel,
  className,
}: {
  label: string;
  value?: number | null;
  state?: "running" | "success" | "error";
  error?: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 text-sm">
        {state === "success" && (
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        )}
        <span role="status" className="min-w-0 flex-1">
          {label}
        </span>
        {state === "running" && value !== null && (
          <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
            {value}%
          </span>
        )}
        {state === "running" && onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {state === "running" && <ProgressLine label={label} value={value} />}
      {state === "error" && error && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-2 rounded-lg border border-destructive/30 bg-background/60 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{error}</p>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry} className="ml-auto">
              <RotateCcw aria-hidden /> Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
