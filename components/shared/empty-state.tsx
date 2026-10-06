import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

/**
 * Empty state (task T166): an icon medallion inside soft concentric rings, a
 * short message and the action that fills the space. An empty screen is an
 * invitation to act, so the CTA is the primary visual weight.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-glass-border bg-surface/40 text-center",
        compact ? "gap-3 px-6 py-10" : "gap-4 px-6 py-16",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(50%_100%_at_50%_0%,color-mix(in_oklch,var(--brand-blue)_10%,transparent),transparent)]"
      />
      <span className="relative flex items-center justify-center">
        {!compact && (
          <span
            aria-hidden
            className="absolute size-24 rounded-full border border-primary/10 bg-primary/[0.03]"
          />
        )}
        <span
          aria-hidden
          className={cn(
            "absolute rounded-full border border-primary/15",
            compact ? "size-14" : "size-[4.5rem]",
          )}
        />
        <span
          className={cn(
            "relative flex items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/20 to-primary/5 text-primary shadow-[0_8px_24px_-12px_var(--brand-blue)]",
            compact ? "size-11" : "size-12",
          )}
        >
          <Icon className={compact ? "size-5" : "size-[22px]"} aria-hidden />
        </span>
      </span>
      <div className="relative space-y-1.5">
        <p className="font-heading text-base font-semibold tracking-tight">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <div className="relative flex flex-wrap items-center justify-center gap-2 pt-1">
          {action}
        </div>
      )}
    </div>
  );
}
