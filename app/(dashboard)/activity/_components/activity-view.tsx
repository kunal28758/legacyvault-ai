"use client";

import { createElement, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Siren,
  TimerReset,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { humanize, iconFor, toneFor } from "@/components/shared/activity-feed";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/** Reads and database-trigger mirrors: real, but noise for most reviews. */
const isRoutine = (action: string) =>
  /\.(listed|viewed|read|row_created|row_changed)$|^api\.|resources_listed$|^plan\.step_saved$/.test(
    action,
  );

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

/** Milestones for the legacy timeline: a fixed vocabulary over real audit actions. */
const MILESTONES: Record<string, { label: string; icon: LucideIcon }> = {
  "document.uploaded": { label: "Document added to the vault", icon: FileText },
  "document.deleted": { label: "Document removed", icon: FileText },
  "beneficiary.created": { label: "Beneficiary added", icon: UserPlus },
  "beneficiary.status_changed": { label: "Beneficiary status changed", icon: Users },
  "assignment.created": { label: "Assigned or shared with a beneficiary", icon: Users },
  "assignment.removed": { label: "Assignment removed", icon: Users },
  "access.token_issued": { label: "Access link issued", icon: KeyRound },
  "access.token_revoked": { label: "Access link revoked", icon: KeyRound },
  "plan.created": { label: "Will started", icon: ScrollText },
  "plan.draft_created": { label: "New will draft started", icon: ScrollText },
  "plan.finalized": { label: "Will finalized", icon: ScrollText },
  "asset.created": { label: "Asset recorded", icon: Wallet },
  "dms.configured": { label: "Dead Man’s Switch configured", icon: TimerReset },
  "dms.checked_in": { label: "Checked in", icon: TimerReset },
  "ea.contact_configured": { label: "Emergency contact designated", icon: Siren },
  "ea.request_approved": { label: "Emergency access approved", icon: Siren },
};

const SENSITIVE_KEY = /token|hash|secret|key|password|otp|code/i;

/** Top-level primitive metadata only; anything nested or sensitive-sounding is left out. */
function safeMetadata(metadata: Record<string, unknown>): [string, string][] {
  return Object.entries(metadata)
    .filter(([key, value]) => !SENSITIVE_KEY.test(key) && value !== null)
    .flatMap(([key, value]): [string, string][] => {
      if (["string", "number", "boolean"].includes(typeof value)) return [[key, String(value)]];
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        return [[key, value.join(", ")]];
      }
      return [];
    })
    .slice(0, 8);
}

function dayLabel(iso: string, now: number, month = false): string {
  const day = new Date(iso);
  const today = new Date(now);
  if (month) {
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(day);
  }
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

function groupBy(items: ActivityEntry[], label: (item: ActivityEntry) => string) {
  const groups: { label: string; entries: ActivityEntry[] }[] = [];
  for (const item of items) {
    const key = label(item);
    const last = groups.at(-1);
    if (last?.label === key) last.entries.push(item);
    else groups.push({ label: key, entries: [item] });
  }
  return groups;
}

/**
 * Audit Centre: the owner's own append-only audit trail (`/users/me/activity`;
 * RLS scopes it to rows where the owner is the actor). Two views over the same
 * real records — the full audit log, and a timeline of legacy milestones.
 */
export function ActivityView() {
  const now = useNow();
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"audit" | "timeline">("audit");
  const [group, setGroup] = useState<Group>("all");
  const [showRoutine, setShowRoutine] = useState(false);
  const query = useActivity(PAGE_SIZE, page);

  const all = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const auditItems = all.filter(
    (item) =>
      (showRoutine || !isRoutine(item.action)) &&
      (group === "all" || GROUPS[group].prefixes.some((prefix) => item.action.startsWith(prefix))),
  );
  const milestones = all.filter((item) => MILESTONES[item.action] && item.outcome === "SUCCESS");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Activity & Audit"
        title="Audit Centre"
        description="An append-only record of what happened in your account — who did it, what, to which resource, when, and with which result."
        actions={
          total > 0 ? (
            <span className="text-sm text-muted-foreground tabular-nums">
              {total.toLocaleString("en-IN")} events recorded
            </span>
          ) : null
        }
      />

      <Tabs value={view} onValueChange={(value) => setView(value as typeof view)}>
        <TabsList>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="timeline">Legacy timeline</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "audit" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="group"
            aria-label="Filter activity"
            className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 pb-1"
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
          <button
            type="button"
            aria-pressed={showRoutine}
            onClick={() => setShowRoutine((value) => !value)}
            className={cn(
              "h-8 shrink-0 self-start rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:self-auto",
              showRoutine
                ? "border-primary/40 bg-primary/15 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Include reads & system rows
          </button>
        </div>
      )}

      {query.isPending ? (
        <CardSkeleton rows={8} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load your activity"
          description="Your audit trail is intact — this view just couldn’t reach it. Try again in a moment."
          correlationId={query.error instanceof ApiError ? query.error.correlationId : undefined}
          onRetry={() => void query.refetch()}
        />
      ) : view === "timeline" ? (
        <Timeline items={milestones} now={now} />
      ) : auditItems.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={group === "all" && !all.length ? "No activity yet" : "Nothing in this view"}
          description={
            group === "all" && !all.length
              ? "Uploads, invitations, shares, access links and security changes will appear here as they happen."
              : "Try another filter, include routine rows, or look at an older page."
          }
        />
      ) : (
        <div className="space-y-6" aria-busy={query.isFetching}>
          {groupBy(auditItems, (item) => dayLabel(item.createdAt, now)).map((day) => (
            <section key={day.label} aria-label={day.label} className="space-y-2">
              <h2 className="sticky top-16 z-10 -mx-1 bg-background/80 px-1 py-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase backdrop-blur">
                {day.label}
              </h2>
              <Card className="py-0 glass">
                <CardContent className="p-0">
                  <ol className="divide-y divide-border/60">
                    {day.entries.map((item) => (
                      <AuditRow key={item.id} item={item} now={now} />
                    ))}
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

function AuditRow({ item, now }: { item: ActivityEntry; now: number }) {
  const tone = toneFor(item) ?? "neutral";
  const outcome = OUTCOME[item.outcome];
  const metadata = safeMetadata(item.metadata);
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 transition-colors outline-none hover:bg-primary/[0.03] focus-visible:bg-primary/[0.05] sm:items-center sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className={cn("mt-0.5 icon-tile size-9 sm:mt-0", TONE_TILE[tone])}>
            {createElement(iconFor(item.action), { className: "size-4", "aria-hidden": true })}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{humanize(item.action)}</p>
            <p className="truncate text-xs text-muted-foreground">
              You · {titleCase(item.resourceType.replace(/_/g, " "))}
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
          <ChevronDown
            className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 sm:mt-0"
            aria-hidden
          />
        </summary>
        <dl className="grid gap-x-6 gap-y-2 border-t border-border/50 bg-surface/30 px-4 py-3 text-xs sm:grid-cols-2 sm:px-5">
          {[
            ["Actor", "You (account owner)"],
            ["Action", item.action],
            [
              "Resource",
              `${titleCase(item.resourceType.replace(/_/g, " "))}${item.resourceId ? ` · ${item.resourceId.slice(0, 8)}…` : ""}`,
            ],
            ["Result", outcome.label],
            ["Time", formatDateTime(item.createdAt)],
            ["IP address", item.ipAddress ?? "—"],
            ...metadata.map(([key, value]) => [
              titleCase(key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")),
              value,
            ]),
          ].map(([term, value]) => (
            <div key={term} className="flex min-w-0 gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">{term}</dt>
              <dd className="min-w-0 font-mono break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

function Timeline({ items, now }: { items: ActivityEntry[]; now: number }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No milestones on this page"
        description="Milestones — documents added, beneficiaries invited, shares, will updates and switch changes — appear here from your audit trail."
      />
    );
  }
  return (
    <div className="space-y-6">
      {groupBy(items, (item) => dayLabel(item.createdAt, now, true)).map((month) => (
        <section key={month.label} aria-label={month.label} className="space-y-3">
          <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {month.label}
          </h2>
          <ol className="relative space-y-3 border-l border-border pl-6">
            {month.entries.map((item) => {
              const milestone = MILESTONES[item.action];
              return (
                <li key={item.id} className="relative">
                  <span
                    className="absolute top-1 -left-[33px] flex size-4 items-center justify-center rounded-full border-2 border-primary bg-background"
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {createElement(milestone.icon, {
                        className: "size-4 text-primary",
                        "aria-hidden": true,
                      })}
                      {milestone.label}
                    </p>
                    <time
                      dateTime={item.createdAt}
                      title={formatDateTime(item.createdAt)}
                      className="text-xs text-muted-foreground tabular-nums"
                    >
                      {formatDateTime(item.createdAt)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
