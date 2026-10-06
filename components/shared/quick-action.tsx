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
  blue: "text-primary group-hover:border-primary/50 group-hover:bg-primary/20",
  purple: "text-brand-purple group-hover:border-brand-purple/50 group-hover:bg-brand-purple/20",
  cyan: "text-brand-cyan group-hover:border-brand-cyan/50 group-hover:bg-brand-cyan/20",
  success: "text-success group-hover:border-success/50 group-hover:bg-success/20",
  warning: "text-warning group-hover:border-warning/50 group-hover:bg-warning/20",
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
        className={cn("icon-tile size-10 transition-colors duration-200", accentClasses[accent])}
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
        className="size-4 shrink-0 text-muted-foreground transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-primary"
        aria-hidden
      />
    </>
  );
  const classes = cn(
    "group glass-highlight surface-interactive flex w-full items-center gap-3 rounded-xl p-3 text-left glass outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
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
