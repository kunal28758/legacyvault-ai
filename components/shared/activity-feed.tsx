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
  Users,
  type LucideIcon,
} from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Timeline, type TimelineItem } from "@/components/shared/timeline";
import type { DemoActivity } from "@/lib/demo/types";

function iconFor(action: string): LucideIcon {
  if (action.startsWith("dms.")) return TimerReset;
  if (action.startsWith("ea.")) return Siren;
  if (action.startsWith("auth.") || action.startsWith("session.")) return LogIn;
  if (action.startsWith("plan.")) return ScrollText;
  if (action.startsWith("document.") || action.startsWith("video.")) return FileText;
  if (action.startsWith("beneficiary.") || action.startsWith("assignment.")) return Users;
  if (action.startsWith("access.") || action.includes("credential")) return KeyRound;
  return Activity;
}

function toneFor(item: DemoActivity): TimelineItem["tone"] {
  if (item.outcome === "FAILURE" || item.outcome === "DENIED") return "danger";
  if (item.action.includes("credential") || item.action.startsWith("access.")) return "warning";
  if (item.action.startsWith("dms.") || item.action.startsWith("ea.")) return "info";
  return "success";
}

/** Audit-derived activity list (what `/api/v1/audit-logs` will feed later). */
export function ActivityFeed({
  items,
  limit,
  emptyTitle = "No activity yet",
}: {
  items: DemoActivity[];
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
        title: item.description,
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
