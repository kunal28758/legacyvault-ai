"use client";

import {
  Activity,
  FileText,
  KeyRound,
  LogIn,
  ScrollText,
  ShieldAlert,
  Siren,
  TimerReset,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Timeline, type TimelineItem } from "@/components/shared/timeline";
import type { ActivityEntry } from "@/lib/types/activity";

/** "document.accessed" → "Document accessed". */
export function humanize(action: string): string {
  const [domain, ...rest] = action.split(".");
  const verb = rest.join(" ").replace(/_/g, " ");
  const label = `${domain} ${verb}`.trim().replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function iconFor(action: string): LucideIcon {
  if (action.startsWith("dms.")) return TimerReset;
  if (action.startsWith("ea.")) return Siren;
  if (action.startsWith("auth.") || action.startsWith("session.")) return LogIn;
  if (action.startsWith("plan.")) return ScrollText;
  if (action.startsWith("document.") || action.startsWith("video.")) return FileText;
  if (action.startsWith("beneficiary.") || action.startsWith("assignment.")) return Users;
  if (action.startsWith("access.") || action.includes("credential")) return KeyRound;
  if (action.startsWith("ai.")) return Sparkles;
  if (action.startsWith("asset.")) return Wallet;
  return Activity;
}

export function toneFor(item: ActivityEntry): TimelineItem["tone"] {
  if (item.outcome === "FAILURE" || item.outcome === "DENIED") return "danger";
  if (item.action.includes("credential") || item.action.startsWith("access.")) return "warning";
  if (item.action.startsWith("dms.") || item.action.startsWith("ea.")) return "info";
  return "success";
}

/** Audit-derived activity list, fed by `/api/v1/users/me/activity`. */
export function ActivityFeed({
  items,
  limit,
  emptyTitle = "No activity yet",
}: {
  items: ActivityEntry[];
  limit?: number;
  emptyTitle?: string;
}) {
  const visible = limit ? items.slice(0, limit) : items;
  if (visible.length === 0) {
    return (
      <EmptyState
        compact
        icon={ShieldAlert}
        title={emptyTitle}
        description="Security-relevant actions will appear here with actor, time and outcome."
      />
    );
  }
  return (
    <Timeline
      dense
      items={visible.map((item) => ({
        id: item.id,
        title: humanize(item.action),
        description: (
          <span className="font-mono text-[11px] tracking-wide uppercase">{item.action}</span>
        ),
        timestamp: item.createdAt,
        icon: iconFor(item.action),
        tone: toneFor(item),
      }))}
    />
  );
}
