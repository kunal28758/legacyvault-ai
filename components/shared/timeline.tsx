"use client";

import type { LucideIcon } from "lucide-react";

import { useNow } from "@/hooks/use-now";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  timestamp: string;
  icon?: LucideIcon;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}

const toneDot: Record<NonNullable<TimelineItem["tone"]>, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-primary",
};

const toneRing: Record<NonNullable<TimelineItem["tone"]>, string> = {
  neutral: "ring-muted-foreground/20",
  success: "ring-success/25",
  warning: "ring-warning/25",
  danger: "ring-destructive/25",
  info: "ring-primary/25",
};

/** Vertical timeline with tone-coded markers; timestamps show relative + absolute. */
export function Timeline({
  items,
  className,
  dense,
}: {
  items: TimelineItem[];
  className?: string;
  dense?: boolean;
}) {
  const now = useNow();
  return (
    <ol className={cn("relative space-y-0", className)}>
      {items.map((item, index) => {
        const Icon = item.icon;
        const tone = item.tone ?? "neutral";
        const last = index === items.length - 1;
        return (
          <li
            key={item.id}
            className={cn("relative flex gap-4", dense ? "pb-4" : "pb-6", last && "pb-0")}
          >
            {!last && (
              <span
                aria-hidden
                className="absolute top-9 bottom-1 left-[15.5px] w-px bg-gradient-to-b from-border to-transparent"
              />
            )}
            <span
              className={cn(
                "relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-card ring-4",
                toneRing[tone],
              )}
            >
              {Icon ? (
                <Icon
                  className={cn(
                    "size-4",
                    tone === "neutral"
                      ? "text-muted-foreground"
                      : toneDot[tone].replace("bg-", "text-"),
                  )}
                  aria-hidden
                />
              ) : (
                <span className={cn("size-2.5 rounded-full", toneDot[tone])} aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium">{item.title}</p>
                <time
                  dateTime={item.timestamp}
                  title={formatDateTime(item.timestamp)}
                  className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                >
                  {formatRelative(item.timestamp, now)}
                </time>
              </div>
              {item.description && (
                <p className="text-sm leading-5 text-muted-foreground">{item.description}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
