"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  correlationId?: string;
  className?: string;
}

/** Inline error state — informative, actionable, never leaks internals (constitution X, UX-013). */
export function ErrorState({
  title = "Something went wrong",
  description = "We could not load this section. Your data is safe — try again in a moment.",
  onRetry,
  retryLabel = "Try again",
  correlationId,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <p className="text-base font-semibold">{title}</p>
        <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
        {correlationId && (
          <p className="font-mono text-[11px] text-muted-foreground">Reference: {correlationId}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RotateCcw data-icon="inline-start" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
