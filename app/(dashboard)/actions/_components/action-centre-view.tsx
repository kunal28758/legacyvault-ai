"use client";

import { useState } from "react";
import { ChevronDown, ListChecks, ShieldCheck } from "lucide-react";

import { ActionList, PriorityBadge } from "@/components/legacy/action-list";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StatCardSkeleton } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { useLegacyState } from "@/hooks/use-legacy-snapshot";
import { PRIORITY_LABELS, PRIORITY_ORDER, type ActionSource } from "@/lib/client/action-centre";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Action Centre: every action derived from the owner's real state, grouped by
 * priority. Filters narrow by where an action comes from; completed actions
 * stay visible (collapsed) so progress is never hidden.
 */
export function ActionCentreView() {
  const { state, isPending, isError, refetch } = useLegacyState();
  const [source, setSource] = useState<ActionSource | "all">("all");
  const [showCompleted, setShowCompleted] = useState(false);

  // The header renders at once; only the data below waits for the account.
  const header = (
    <PageHeader
      eyebrow="Command Centre"
      title="Action Centre"
      description="What needs your attention, from your own account — nothing is estimated."
    />
  );

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Could not load your actions"
          description="Your data is safe — this view could not reach it. Try again in a moment."
          onRetry={refetch}
        />
      </div>
    );
  }
  if (isPending || !state) {
    return (
      <div className="space-y-6">
        {header}
        <div role="status" aria-label="Loading actions" className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PRIORITY_ORDER.map((priority) => (
              <StatCardSkeleton key={priority} />
            ))}
          </div>
          <CardSkeleton rows={5} />
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  const sources = [...new Set(state.actions.map((action) => action.source))];
  const visible = state.actions.filter((action) => source === "all" || action.source === source);
  const open = visible.filter((action) => !action.completed);
  const completed = visible.filter((action) => action.completed);
  const attention = state.open.filter((action) => action.priority !== "RECOMMENDED").length;

  return (
    <div className="space-y-6">
      {header}
      <p className="-mt-3 text-sm text-muted-foreground" role="status">
        {attention
          ? `${pluralize(attention, "action")} need your attention.`
          : "Nothing urgent. The recommendations below keep your legacy current."}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PRIORITY_ORDER.map((priority) => {
          const count = state.open.filter((action) => action.priority === priority).length;
          return (
            <Card key={priority} className="py-0 glass">
              <CardContent className="space-y-2 p-4">
                <PriorityBadge tone={priority} />
                <p className="font-heading text-2xl font-semibold tabular-nums">{count}</p>
                <p className="text-xs text-muted-foreground">
                  {count === 1 ? "open action" : "open actions"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div
        role="group"
        aria-label="Filter actions by source"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {(["all", ...sources] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={source === key}
            onClick={() => setSource(key)}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              source === key
                ? "border-primary/40 bg-primary/15 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}
          >
            {key === "all" ? "All sources" : key}
          </button>
        ))}
      </div>

      {open.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Nothing needs attention here"
          description="Every action from this source is complete. New ones appear as your legacy changes."
        />
      ) : (
        <div className="space-y-6">
          {PRIORITY_ORDER.map((priority) => {
            const group = open.filter((action) => action.priority === priority);
            if (!group.length) return null;
            return (
              <section key={priority} aria-labelledby={`group-${priority}`} className="space-y-2.5">
                <h2
                  id={`group-${priority}`}
                  className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
                >
                  {PRIORITY_LABELS[priority]}
                  <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                    {group.length}
                  </span>
                </h2>
                <ActionList actions={group} label={`${PRIORITY_LABELS[priority]} actions`} />
              </section>
            );
          })}
        </div>
      )}

      {completed.length > 0 && (
        <section className="space-y-2.5">
          <button
            type="button"
            aria-expanded={showCompleted}
            onClick={() => setShowCompleted((value) => !value)}
            className="flex items-center gap-2 rounded-md text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ListChecks className="size-3.5" aria-hidden />
            Completed · {completed.length}
            <ChevronDown
              className={cn("size-3.5 transition-transform", showCompleted && "rotate-180")}
              aria-hidden
            />
          </button>
          {showCompleted && <ActionList actions={completed} compact label="Completed actions" />}
        </section>
      )}
    </div>
  );
}
