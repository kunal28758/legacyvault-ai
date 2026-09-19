"use client";

import { useState } from "react";
import {
  Bell,
  BellOff,
  CheckCheck,
  Mail,
  ScrollText,
  ShieldAlert,
  TimerReset,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDemoWorkspace, useNow } from "@/hooks/use-demo-workspace";
import { useDemoStore } from "@/lib/demo/store";
import type { DemoNotification } from "@/lib/demo/types";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

type Category = "all" | DemoNotification["category"];

const categoryMeta: Record<
  DemoNotification["category"],
  { label: string; icon: LucideIcon; className: string }
> = {
  security: {
    label: "Security",
    icon: ShieldAlert,
    className: "bg-destructive/10 text-destructive",
  },
  protection: {
    label: "Protection",
    icon: TimerReset,
    className: "bg-brand-purple/15 text-brand-purple",
  },
  legacy: { label: "Legacy", icon: ScrollText, className: "bg-brand-blue/15 text-brand-blue" },
  system: { label: "System", icon: Bell, className: "bg-muted text-muted-foreground" },
};

/** Notification center (task T158 — UI; `/api/v1/notifications` wiring pending T156). */
export function NotificationsView() {
  const { workspace: ws, ready } = useDemoWorkspace();
  const markRead = useDemoStore((s) => s.markNotificationRead);
  const markAll = useDemoStore((s) => s.markAllNotificationsRead);
  const now = useNow();
  const [category, setCategory] = useState<Category>("all");

  const items = ws.notifications.filter((n) => category === "all" || n.category === category);
  const unread = ws.notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Notifications"
        description={
          ready
            ? unread
              ? `${unread} unread. Security alerts are also sent by email.`
              : "You are all caught up."
            : ""
        }
        actions={
          <Button
            variant="outline"
            disabled={!unread}
            onClick={() => {
              markAll();
              toast.success("All notifications marked as read");
            }}
          >
            <CheckCheck data-icon="inline-start" />
            Mark all read
          </Button>
        }
      />

      <Tabs value={category} onValueChange={(v) => setCategory(v as Category)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="protection">Protection</TabsTrigger>
          <TabsTrigger value="legacy">Legacy</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>
      </Tabs>

      {!ready ? (
        <CardSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No notifications here"
          description="Check-in reminders, emergency requests, sharing events and security alerts will appear in this list."
        />
      ) : (
        <Card className="glass">
          <CardContent className="divide-y divide-border p-0">
            {items.map((n) => {
              const meta = categoryMeta[n.category];
              const Icon = meta.icon;
              const unreadItem = !n.readAt;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markRead(n.id)}
                  aria-label={`${unreadItem ? "Unread: " : ""}${n.title}`}
                  className={cn(
                    "flex w-full items-start gap-4 px-5 py-4 text-left transition-colors outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    unreadItem && "bg-primary/[0.04]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                      meta.className,
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn("text-sm", unreadItem ? "font-semibold" : "font-medium")}>
                        {n.title}
                      </span>
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                        {meta.label}
                      </span>
                      {n.channel !== "IN_APP" && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Mail className="size-3" aria-hidden /> emailed
                        </span>
                      )}
                    </span>
                    <span className="block text-sm leading-5 text-muted-foreground">
                      {n.content}
                    </span>
                    <time
                      dateTime={n.createdAt}
                      title={formatDateTime(n.createdAt)}
                      className="block text-xs text-muted-foreground"
                    >
                      {formatRelative(n.createdAt, now)}
                    </time>
                  </span>
                  {unreadItem && (
                    <span className="mt-2 size-2 shrink-0 rounded-full bg-brand-cyan" aria-hidden />
                  )}
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
