"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  BellOff,
  CheckCheck,
  FileText,
  KeyRound,
  ListChecks,
  Mail,
  Settings2,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/use-notifications";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/client/api-client";
import type { NotificationItem } from "@/lib/types/notification";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

type Category = "action" | "security" | "access" | "document" | "system" | "ai";

const CATEGORIES: Category[] = ["action", "security", "access", "document", "system", "ai"];

const categoryMeta: Record<Category, { label: string; icon: LucideIcon; className: string }> = {
  action: { label: "Action", icon: ListChecks, className: "text-warning" },
  security: { label: "Security", icon: ShieldAlert, className: "text-destructive" },
  access: { label: "Access", icon: KeyRound, className: "text-primary" },
  document: { label: "Document", icon: FileText, className: "text-brand-cyan" },
  system: { label: "System", icon: Bell, className: "text-muted-foreground" },
  ai: { label: "AI", icon: Sparkles, className: "text-brand-purple" },
};

/**
 * Groups a notification by the domain that produced it.
 *
 * The stored `type` is a dotted action name (`dms.reminder`, `plan.finalized`),
 * so the prefix is enough — and an unknown prefix falls through to System
 * rather than being hidden.
 */
function categoryOf(notification: NotificationItem): Category {
  const [domain, event = ""] = notification.type.split(".");
  // Reminders and grace periods ask the owner to do something (check in).
  if (domain === "dms" && (event === "reminder" || event === "grace_period")) return "action";
  if (["security", "user", "auth", "admin"].includes(domain)) return "security";
  if (["dms", "ea", "access", "beneficiary", "assignment"].includes(domain)) return "access";
  if (["plan", "document", "asset", "video", "upload", "folder"].includes(domain))
    return "document";
  if (domain === "ai") return "ai";
  return "system";
}

/** Notification centre (FR-L001–L006), backed by `/api/v1/notifications`. */
export function NotificationsView() {
  const now = useNow();
  const [category, setCategory] = useState<Category | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const notifications = useNotifications({ limit: 100 });
  const markRead = useMarkNotificationsRead();

  const all = notifications.data?.items ?? [];
  const items = all.filter(
    (entry) =>
      (category === "all" || categoryOf(entry) === category) && (!unreadOnly || !entry.readAt),
  );
  const counts = all.reduce<Record<string, number>>((acc, entry) => {
    const key = categoryOf(entry);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
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
        eyebrow="Settings"
        title="Notification Centre"
        description={
          notifications.isPending
            ? ""
            : unread
              ? `${unread} unread. Security alerts are also sent by email.`
              : "You are all caught up."
        }
        actions={
          <>
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link href="/settings?tab=notifications" />}
            >
              <Settings2 data-icon="inline-start" />
              Preferences
            </Button>
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
          </>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Filter by category"
          className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {(["all", ...CATEGORIES] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                category === key
                  ? "border-primary/40 bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              {key === "all" ? "All" : categoryMeta[key].label}
              <span className="tabular-nums opacity-70">
                {key === "all" ? all.length : (counts[key] ?? 0)}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly((value) => !value)}
          className={cn(
            "h-8 shrink-0 self-start rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:self-auto",
            unreadOnly
              ? "border-primary/40 bg-primary/15 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          Unread only
        </button>
      </div>

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
          title={unreadOnly ? "No unread notifications" : "No notifications here"}
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
                  <span className={cn("mt-0.5 icon-tile size-9", meta.className)}>
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
                    <span
                      className="mt-2 size-2 shrink-0 rounded-full bg-primary shadow-glow-blue"
                      aria-hidden
                    />
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
