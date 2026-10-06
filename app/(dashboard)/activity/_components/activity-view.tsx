"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";

import { humanize, iconFor, toneFor } from "@/components/shared/activity-feed";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useActivity } from "@/hooks/use-activity";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/client/api-client";
import { formatDateTime, formatRelative, titleCase } from "@/lib/format";
import type { ActivityEntry } from "@/lib/types/activity";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

/** Filter groups over the audit action's domain prefix (`document.uploaded` → document). */
const GROUPS = {
  all: { label: "All", prefixes: [] as string[] },
  documents: { label: "Documents", prefixes: ["document.", "upload.", "folder.", "video."] },
  people: { label: "Beneficiaries", prefixes: ["beneficiary.", "assignment."] },
  access: { label: "Access & sharing", prefixes: ["access.", "ea."] },
  protection: { label: "Dead Man’s Switch", prefixes: ["dms."] },
  plan: { label: "Will & assets", prefixes: ["plan.", "asset."] },
  ai: { label: "AI", prefixes: ["ai."] },
  account: {
    label: "Account & security",
    prefixes: ["user.", "auth.", "session.", "notification."],
  },
} as const;
type Group = keyof typeof GROUPS;

const OUTCOME: Record<ActivityEntry["outcome"], { tone: StatusTone; label: string }> = {
  SUCCESS: { tone: "success", label: "Success" },
  FAILURE: { tone: "danger", label: "Failed" },
  DENIED: { tone: "warning", label: "Denied" },
};

const TONE_TILE = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-primary",
} as const;

function dayLabel(iso: string, now: number): string {
  const day = new Date(iso);
  const today = new Date(now);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(day)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: day.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(day);
}

/**
 * Activity Log: the owner's own append-only audit trail (`/users/me/activity`),
 * grouped by day. Every row is a real audit record — action, resource, outcome
 * and time; nothing here is summarised or invented.
 */
export function ActivityView() {
  const now = useNow();
  const [page, setPage] = useState(1);
  const [group, setGroup] = useState<Group>("all");
  const query = useActivity(PAGE_SIZE, page);

  const items = (query.data?.items ?? []).filter(
    (item) =>
      group === "all" || GROUPS[group].prefixes.some((prefix) => item.action.startsWith(prefix)),
  );
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const days: { label: string; entries: ActivityEntry[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.createdAt, now);
    const last = days.at(-1);
    if (last?.label === label) last.entries.push(item);
    else days.push({ label, entries: [item] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Activity log"
        description="An append-only record of what happened in your account — what was done, to which resource, when, and with which outcome."
        actions={
          total > 0 ? (
            <span className="text-sm text-muted-foreground tabular-nums">
              {total.toLocaleString("en-IN")} events recorded
            </span>
          ) : null
        }
      />

      <div
        role="group"
        aria-label="Filter activity"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {(Object.keys(GROUPS) as Group[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={group === key}
            onClick={() => setGroup(key)}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              group === key
                ? "border-primary/40 bg-primary/15 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}
          >
            {GROUPS[key].label}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <CardSkeleton rows={8} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load your activity"
          description="Your audit trail is intact — this view just couldn’t reach it. Try again in a moment."
          correlationId={query.error instanceof ApiError ? query.error.correlationId : undefined}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={group === "all" ? "No activity yet" : "Nothing in this category"}
          description={
            group === "all"
              ? "Uploads, invitations, shares, access links and security changes will appear here as they happen."
              : "Try another filter, or look at an earlier page."
          }
        />
      ) : (
        <div className="space-y-6" aria-busy={query.isFetching}>
          {days.map((day) => (
            <section key={day.label} aria-label={day.label} className="space-y-2">
              <h2 className="sticky top-16 z-10 -mx-1 bg-background/80 px-1 py-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase backdrop-blur">
                {day.label}
              </h2>
              <Card className="glass">
                <CardContent className="p-0">
                  <ol className="divide-y divide-border/60">
                    {day.entries.map((item) => {
                      const Icon = iconFor(item.action);
                      const tone = toneFor(item) ?? "neutral";
                      const outcome = OUTCOME[item.outcome];
                      return (
                        <li
                          key={item.id}
                          className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-primary/[0.03] sm:items-center sm:px-5"
                        >
                          <span className={cn("mt-0.5 icon-tile size-9 sm:mt-0", TONE_TILE[tone])}>
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{humanize(item.action)}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {titleCase(item.resourceType.replace(/_/g, " "))}
                              <span className="font-mono tracking-wide uppercase">
                                {" · "}
                                {item.action}
                              </span>
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-4">
                            <StatusBadge tone={outcome.tone} className="h-5 px-2 text-[11px]">
                              {outcome.label}
                            </StatusBadge>
                            <time
                              dateTime={item.createdAt}
                              title={formatDateTime(item.createdAt)}
                              className="w-24 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                            >
                              {formatRelative(item.createdAt, now)}
                            </time>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Activity pages" className="flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1 || query.isFetching}
            onClick={() => setPage((current) => current - 1)}
          >
            <ChevronLeft data-icon="inline-start" />
            Newer
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            Page {page} of {pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pages || query.isFetching}
            onClick={() => setPage((current) => current + 1)}
          >
            Older
            <ChevronRight data-icon="inline-end" />
          </Button>
        </nav>
      )}
    </div>
  );
}
