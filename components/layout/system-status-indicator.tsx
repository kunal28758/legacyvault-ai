"use client";

import { RefreshCw } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNow } from "@/hooks/use-now";
import { useSystemStatus } from "@/hooks/use-system-status";
import { formatRelative } from "@/lib/format";
import type { ServiceState, SystemStatus } from "@/lib/types/system-status";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "bad" | "idle";

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  idle: "bg-muted-foreground/60",
};

const OVERALL: Record<SystemStatus["overall"], { label: string; tone: Tone }> = {
  operational: { label: "System online", tone: "ok" },
  degraded: { label: "Partially available", tone: "warn" },
  down: { label: "Service disruption", tone: "bad" },
};

const SERVICE: Record<ServiceState, { label: string; tone: Tone }> = {
  operational: { label: "Operational", tone: "ok" },
  degraded: { label: "Degraded", tone: "warn" },
  down: { label: "Unavailable", tone: "bad" },
  not_configured: { label: "Not configured", tone: "warn" },
};

function StatusDot({
  tone,
  live = false,
  className,
}: {
  tone: Tone;
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {live && (
        <span className={cn("absolute inset-0 animate-status-halo rounded-full", TONE_DOT[tone])} />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          TONE_DOT[tone],
          tone === "ok" && "shadow-[0_0_10px_var(--success)]",
        )}
      />
    </span>
  );
}

/**
 * The persistent "● System online" indicator.
 *
 * Every state it shows comes from `/api/v1/system-status`, which probes each
 * dependency for real. When the status cannot be fetched it says so — it
 * never falls back to a reassuring green.
 */
export function SystemStatusIndicator({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const query = useSystemStatus();
  const now = useNow(15_000);
  // An answer in an unexpected shape is treated like no answer, never as green.
  const data = query.data && query.data.overall in OVERALL ? query.data : undefined;
  const unreadable = query.isError || (query.data !== undefined && data === undefined);

  const summary = unreadable
    ? { label: "Status unavailable", tone: "bad" as Tone }
    : data
      ? OVERALL[data.overall]
      : { label: "Checking status…", tone: "idle" as Tone };

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-glass-border bg-background/40 px-3 py-1.5 text-xs font-medium text-foreground/90 backdrop-blur-md transition-colors outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        aria-label={`${summary.label}. Show system status`}
      >
        <StatusDot tone={summary.tone} live={summary.tone === "ok"} />
        <span className={cn(compact && "sr-only sm:not-sr-only")}>{summary.label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <PopoverTitle>System status</PopoverTitle>
            <PopoverDescription className="mt-0.5 flex items-center gap-1.5">
              <StatusDot tone={summary.tone} />
              {summary.label}
            </PopoverDescription>
          </div>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            aria-label="Check again"
          >
            <RefreshCw
              className={cn(
                "size-4",
                query.isFetching && "animate-spin motion-reduce:animate-none",
              )}
              aria-hidden
            />
          </button>
        </div>

        {unreadable && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            The status service could not be reached from your browser. Check your connection and try
            again.
          </p>
        )}

        {data?.services ? (
          <ul className="mt-3 divide-y divide-border/60" aria-label="Services">
            {data.services.map((service) => {
              const state = SERVICE[service.state] ?? { label: "Unknown", tone: "bad" as Tone };
              return (
                <li key={service.id} className="flex gap-3 py-2.5">
                  <StatusDot tone={state.tone} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{service.label}</span>
                      <span
                        className={cn(
                          "text-xs",
                          state.tone === "ok" && "text-success",
                          state.tone === "warn" && "text-warning",
                          state.tone === "bad" && "text-destructive",
                        )}
                      >
                        {state.label}
                      </span>
                    </div>
                    {service.state !== "operational" && (
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {service.message}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : data ? (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Sign in to see the status of each service — database, storage, authentication, malware
            scanning and AI.
          </p>
        ) : null}

        {data && (
          <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
            Last checked {formatRelative(data.checkedAt, Math.max(now, Date.parse(data.checkedAt)))}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
