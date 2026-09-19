"use client";

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface QuickActionProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  href?: string;
  onClick?: () => void;
  accent?: "blue" | "purple" | "cyan" | "success" | "warning";
  disabled?: boolean;
  className?: string;
}

const accentClasses = {
  blue: "bg-brand-blue/15 text-brand-blue group-hover:bg-brand-blue group-hover:text-primary-foreground",
  purple:
    "bg-brand-purple/15 text-brand-purple group-hover:bg-brand-purple group-hover:text-primary-foreground",
  cyan: "bg-brand-cyan/15 text-brand-cyan group-hover:bg-brand-cyan group-hover:text-primary-foreground",
  success: "bg-success/15 text-success group-hover:bg-success group-hover:text-primary-foreground",
  warning: "bg-warning/15 text-warning group-hover:bg-warning group-hover:text-primary-foreground",
};

/** Compact action tile used on the dashboard and in empty states. */
export function QuickAction({
  icon: Icon,
  label,
  description,
  href,
  onClick,
  accent = "blue",
  disabled,
  className,
}: QuickActionProps) {
  const content = (
    <>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors",
          accentClasses[accent],
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </>
  );
  const classes = cn(
    "group glass-highlight flex w-full items-center gap-3 rounded-xl p-3 text-left glass motion-safe-transition outline-none hover:-translate-y-0.5 hover:shadow-glow-purple focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    className,
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes}>
      {content}
    </button>
  );
}
