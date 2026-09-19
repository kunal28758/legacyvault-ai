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

/** Empty state with an icon medallion, a message and an optional CTA (task T166). */
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
        "glass-highlight flex flex-col items-center justify-center rounded-2xl border border-dashed border-glass-border text-center glass",
        compact ? "gap-3 px-6 py-10" : "gap-4 px-6 py-16",
        className,
      )}
    >
      <span className="relative flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <span
          aria-hidden
          className="absolute inset-0 rounded-2xl bg-gradient-brand opacity-20 blur-md"
        />
        <Icon className="relative size-6" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <p className="text-base font-semibold">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{action}</div>
      )}
    </div>
  );
}
