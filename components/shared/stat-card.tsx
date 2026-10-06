import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

import { CountUp } from "@/components/shared/count-up";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatAccent = "blue" | "purple" | "cyan" | "success" | "warning" | "danger" | "neutral";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  /** Semantic accent of the icon tile: blue = product, purple = AI only, green = healthy. */
  accent?: StatAccent;
  trailing?: React.ReactNode;
  className?: string;
}

export const accentText: Record<StatAccent, string> = {
  blue: "text-primary",
  purple: "text-brand-purple",
  cyan: "text-brand-cyan",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};

/**
 * KPI tile — a headline number with a label and a short hint. Numbers use text
 * tokens (never a series colour); the icon tile carries the semantic accent.
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
    <CardContent className="flex h-full flex-col gap-3 p-4 sm:gap-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span
            className={cn(
              "icon-tile size-9 transition-transform duration-300 ease-out group-hover:scale-105",
              accentText[accent],
            )}
          >
            <Icon className="size-[18px]" aria-hidden />
          </span>
        )}
      </div>
      <div className="mt-auto space-y-1.5">
        <div className="flex items-end justify-between gap-3">
          <p className="font-heading text-2xl leading-none font-semibold tracking-tight tabular-nums sm:text-3xl">
            {typeof value === "number" ? <CountUp value={value} /> : value}
          </p>
          {trailing}
          {href && (
            <ArrowUpRight
              className="size-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary group-hover:opacity-100"
              aria-hidden
            />
          )}
        </div>
        {hint && <p className="text-xs leading-5 text-muted-foreground">{hint}</p>}
      </div>
    </CardContent>
  );

  const cardClass = cn(
    "glass glass-highlight h-full py-0",
    href && "group surface-interactive",
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Card className={cardClass}>{body}</Card>
      </Link>
    );
  }
  return <Card className={cardClass}>{body}</Card>;
}

export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("h-full py-0 glass", className)}>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="size-9 rounded-lg" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
      </CardContent>
    </Card>
  );
}
