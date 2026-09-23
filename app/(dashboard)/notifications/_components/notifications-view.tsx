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
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/use-notifications";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/api/client";
import type { NotificationItem } from "@/lib/types/notification";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

type Category = "security" | "protection" | "legacy" | "system";

const categoryMeta: Record<Category, { label: string; icon: LucideIcon; className: string }> = {
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

/**
 * Groups a notification by the domain that produced it.
 *
 * The stored `type` is a dotted action name (`dms.reminder`, `plan.finalized`),
 * so the prefix is enough — and an unknown prefix falls through to System
 * rather than being hidden.
 */
function categoryOf(notification: NotificationItem): Category {
  const domain = notification.type.split(".")[0];
  if (domain === "security" || domain === "user" || domain === "auth") return "security";
  if (domain === "dms" || domain === "ea" || domain === "access") return "protection";
  if (["plan", "document", "asset", "beneficiary", "video", "upload"].includes(domain)) {
    return "legacy";
  }
  return "system";
}

/** Notification centre (FR-L001–L006), backed by `/api/v1/notifications`. */
export function NotificationsView() {
  const now = useNow();
  const [category, setCategory] = useState<Category | "all">("all");

  const notifications = useNotifications({ limit: 100 });
  const markRead = useMarkNotificationsRead();

  const all = notifications.data?.items ?? [];
  const items = all.filter((entry) => category === "all" || categoryOf(entry) === category);
  const unread = notifications.data?.unreadCount ?? 0;

  const read = async (ids: string[]) => {
    try {
      await markRead.mutateAsync(ids);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not update these notifications.",
      );
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Notifications"
        description={
          notifications.isPending
            ? ""
            : unread
              ? `${unread} unread. Security alerts are also sent by email.`
              : "You are all caught up."
        }
        actions={
          <Button
            variant="outline"
            disabled={!unread || markRead.isPending}
            onClick={async () => {
              await read([]);
              toast.success("All notifications marked as read");
            }}
          >
            <CheckCheck data-icon="inline-start" />
            Mark all read
          </Button>
        }
      />

      <Tabs value={category} onValueChange={(value) => setCategory(value as Category | "all")}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="protection">Protection</TabsTrigger>
          <TabsTrigger value="legacy">Legacy</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>
      </Tabs>

      {notifications.isError ? (
        <ErrorState
          title="Could not load your notifications"
          description={
            notifications.error instanceof ApiError
              ? notifications.error.message
              : "Please try again in a moment."
          }
          onRetry={() => void notifications.refetch()}
        />
      ) : notifications.isPending ? (
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
            {items.map((notification) => {
              const meta = categoryMeta[categoryOf(notification)];
              const Icon = meta.icon;
              const unreadItem = !notification.readAt;
              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void read([notification.id])}
                  aria-label={`${unreadItem ? "Unread: " : ""}${notification.title}`}
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
                        {notification.title}
                      </span>
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                        {meta.label}
                      </span>
                      {notification.channel !== "IN_APP" && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Mail className="size-3" aria-hidden />
                          {notification.deliveryStatus === "SENT" ||
                          notification.deliveryStatus === "DELIVERED"
                            ? "emailed"
                            : "email pending"}
                        </span>
                      )}
                    </span>
                    <span className="block text-sm leading-5 text-muted-foreground">
                      {notification.content}
                    </span>
                    <time
                      dateTime={notification.createdAt}
                      title={formatDateTime(notification.createdAt)}
                      className="block text-xs text-muted-foreground"
                    >
                      {formatRelative(notification.createdAt, now)}
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
