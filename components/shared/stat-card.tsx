import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

import { CountUp } from "@/components/shared/count-up";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  accent?: "blue" | "purple" | "cyan" | "success" | "warning" | "neutral";
  trailing?: React.ReactNode;
  className?: string;
}

const accentClasses = {
  blue: "bg-brand-blue/15 text-brand-blue",
  purple: "bg-brand-purple/15 text-brand-purple",
  cyan: "bg-brand-cyan/15 text-brand-cyan",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Stat tile — a headline number with a label and a short hint. Numbers use text
 * tokens (never a series colour); the icon chip carries the accent.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  accent = "neutral",
  trailing,
  className,
}: StatCardProps) {
  const body = (
    <CardContent className="flex h-full items-start justify-between gap-4 p-5">
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
          {typeof value === "number" ? <CountUp value={value} /> : value}
        </p>
        {hint && <p className="text-xs leading-5 text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {Icon && (
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-xl",
              accentClasses[accent],
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
        )}
        {trailing}
        {href && (
          <ArrowUpRight
            className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        )}
      </div>
    </CardContent>
  );

  const cardClass = cn(
    "glass glass-highlight h-full",
    href && "group motion-safe-transition hover:-translate-y-0.5 hover:shadow-glow-blue",
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card className={cardClass}>{body}</Card>
      </Link>
    );
  }
  return <Card className={cardClass}>{body}</Card>;
}

export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("h-full glass", className)}>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="size-10 rounded-xl" />
      </CardContent>
    </Card>
  );
}
