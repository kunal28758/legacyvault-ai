"use client";

import Link from "next/link";
import { ArrowRight, EyeOff, RotateCcw } from "lucide-react";

import { PriorityBadge, SystemDetectedBadge } from "@/components/legacy/action-list";
import { Button } from "@/components/ui/button";
import type { Finding } from "@/lib/client/intelligence";
import { cn } from "@/lib/utils";

export { SystemDetectedBadge };

const RAIL: Record<Finding["severity"], string> = {
  CRITICAL: "bg-destructive",
  IMPORTANT: "bg-warning",
  UPCOMING: "bg-primary",
  RECOMMENDED: "bg-muted-foreground/50",
};

/** One finding: what, why, which records, which rule, and the next step. */
export function FindingItem({
  finding,
  compact = false,
  onDismiss,
  onRestore,
  busy,
  extra,
}: {
  finding: Finding;
  compact?: boolean;
  onDismiss?: () => void;
  onRestore?: () => void;
  busy?: boolean;
  /** An inline control for this finding (e.g. "Link to asset"). */
  extra?: React.ReactNode;
}) {
  const dismissed = finding.status === "dismissed";
  const records = finding.sourceRecords.filter((record) => record.href);
  return (
    <li
      className={cn(
        "relative flex gap-3 overflow-hidden rounded-xl border border-border bg-surface/40 py-3 pr-3 pl-4",
        dismissed && "opacity-70",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-[3px]", RAIL[finding.severity])}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium">{finding.title}</p>
        {!compact && (
          <p className="text-[13px] leading-5 text-muted-foreground">{finding.explanation}</p>
        )}
        {!compact && records.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <span>Records:</span>
            {records.map((record) => (
              <Link
                key={`${record.kind}:${record.id}`}
                href={record.href}
                className="max-w-full truncate rounded underline decoration-border underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {record.label}
              </Link>
            ))}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-muted-foreground">
          <PriorityBadge tone={finding.severity} />
          <SystemDetectedBadge />
          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px]">
            {finding.ruleId}
          </span>
        </div>
        {!compact && (extra || onDismiss || onRestore) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {extra}
            {onDismiss && finding.dismissible && !dismissed && (
              <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>
                <EyeOff data-icon="inline-start" />
                Dismiss<span className="sr-only">: {finding.title}</span>
              </Button>
            )}
            {onRestore && dismissed && (
              <Button variant="ghost" size="sm" onClick={onRestore} disabled={busy}>
                <RotateCcw data-icon="inline-start" />
                Restore<span className="sr-only">: {finding.title}</span>
              </Button>
            )}
          </div>
        )}
      </div>
      {!dismissed && (
        <Link
          href={finding.destination}
          className="flex h-8 shrink-0 items-center gap-1 self-start rounded-lg px-2.5 text-xs font-semibold text-primary transition-colors outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`${finding.recommendedAction}: ${finding.title}`}
        >
          <span className="hidden max-w-40 truncate sm:inline">{finding.recommendedAction}</span>
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </li>
  );
}
