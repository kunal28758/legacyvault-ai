"use client";

import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";

import { useNow } from "@/hooks/use-now";
import {
  PRIORITY_LABELS,
  type ActionPriority,
  type LegacyAction,
} from "@/lib/client/action-centre";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = ActionPriority | "COMPLETED";

const TONE: Record<Tone, { icon: LucideIcon; text: string; chip: string; rail: string }> = {
  CRITICAL: {
    icon: AlertOctagon,
    text: "text-destructive",
    chip: "border-destructive/30 bg-destructive/10 text-destructive",
    rail: "bg-destructive",
  },
  IMPORTANT: {
    icon: AlertTriangle,
    text: "text-warning",
    chip: "border-warning/30 bg-warning/10 text-warning",
    rail: "bg-warning",
  },
  UPCOMING: {
    icon: CalendarClock,
    text: "text-primary",
    chip: "border-primary/30 bg-primary/10 text-primary",
    rail: "bg-primary",
  },
  RECOMMENDED: {
    icon: Lightbulb,
    text: "text-muted-foreground",
    chip: "border-border bg-muted/50 text-muted-foreground",
    rail: "bg-muted-foreground/50",
  },
  COMPLETED: {
    icon: CheckCircle2,
    text: "text-success",
    chip: "border-success/30 bg-success/10 text-success",
    rail: "bg-success",
  },
};

/** Priority pill: colour, icon and word together — never colour alone. */
export function PriorityBadge({ tone, className }: { tone: Tone; className?: string }) {
  const { icon: Icon, chip } = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10.5px] font-semibold tracking-wide uppercase",
        chip,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {PRIORITY_LABELS[tone]}
    </span>
  );
}

/** One action: what, why, where it came from, by when, and the next step. */
export function ActionItem({
  action,
  compact = false,
}: {
  action: LegacyAction;
  compact?: boolean;
}) {
  const now = useNow();
  const tone: Tone = action.completed ? "COMPLETED" : action.priority;
  const { icon: Icon, text, rail } = TONE[tone];
  const overdue = action.deadline ? Date.parse(action.deadline) < now : false;
  return (
    <li
      className={cn(
        "group relative flex gap-3 overflow-hidden rounded-xl border border-border bg-surface/40 py-3 pr-3 pl-4 transition-[border-color,background-color] duration-200",
        !action.completed && "hover:border-primary/30 hover:bg-primary/[0.04]",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", rail)} />
      <span className={cn("mt-0.5 icon-tile size-8", text)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p
            className={cn(
              "text-sm font-medium",
              action.completed &&
                "text-muted-foreground line-through decoration-muted-foreground/40",
            )}
          >
            {action.title}
          </p>
        </div>
        {!compact && (
          <p className="text-[13px] leading-5 text-muted-foreground">{action.explanation}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-muted-foreground">
          <PriorityBadge tone={tone} />
          <span className="rounded-full border border-border px-2 py-0.5">{action.source}</span>
          {action.deadline && !action.completed && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                overdue ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              <CalendarClock className="size-3" aria-hidden />
              {overdue ? "Overdue · " : "Due "}
              {formatRelative(action.deadline, now)}
            </span>
          )}
        </div>
      </div>
      {!action.completed && (
        <Link
          href={action.href}
          className="flex h-8 shrink-0 items-center gap-1 self-center rounded-lg px-2.5 text-xs font-semibold text-primary transition-colors outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`${action.cta}: ${action.title}`}
        >
          <span className="hidden sm:inline">{action.cta}</span>
          <ArrowRight
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      )}
    </li>
  );
}

export function ActionList({
  actions,
  compact,
  label,
}: {
  actions: LegacyAction[];
  compact?: boolean;
  label: string;
}) {
  return (
    <ul className="space-y-2" aria-label={label}>
      {actions.map((action) => (
        <ActionItem key={action.id} action={action} compact={compact} />
      ))}
    </ul>
  );
}
