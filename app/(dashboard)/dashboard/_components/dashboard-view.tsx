"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Coins,
  FileText,
  Gauge,
  HeartHandshake,
  ListChecks,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Upload,
  UserPlus,
  Users,
  Video,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ActionList } from "@/components/legacy/action-list";
import { ReadinessPanel } from "@/components/legacy/readiness-panel";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { ProgressRing } from "@/components/shared/progress-card";
import { QuickAction } from "@/components/shared/quick-action";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivity } from "@/hooks/use-activity";
import { useAIAvailability } from "@/hooks/use-ai";
import { useCheckIn, useDeadManSwitch } from "@/hooks/use-dead-man-switch";
import { useLegacyState, type LegacyState } from "@/hooks/use-legacy-snapshot";
import { useNow } from "@/hooks/use-now";
import { useVideos } from "@/hooks/use-videos";
import { ApiError } from "@/lib/client/api-client";
import { dmsView } from "@/lib/client/dms-presentation";
import { securityChecks, securityScore, type SecurityCheck } from "@/lib/client/security-checks";
import { formatDate, formatRelative, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

function greeting(now: number): string {
  const hour = new Date(now).getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const TONE_TILE: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-primary",
  ai: "text-brand-purple",
};

/** Card heading used across the Command Centre: icon tile, title, context, action. */
function PanelHeader({
  icon: Icon,
  title,
  description,
  action,
  tone = "info",
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: StatusTone;
}) {
  return (
    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("icon-tile size-9", TONE_TILE[tone])}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 space-y-0.5">
          <CardTitle className="text-[15px]">{title}</CardTitle>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </CardHeader>
  );
}

function SectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

function canCheckIn(state: LegacyState | null): boolean {
  return Boolean(
    state && ["ACTIVE", "REMINDER_SENT", "GRACE_PERIOD"].includes(state.snapshot.dms.status),
  );
}

/**
 * Command Centre: what is my state, what needs attention, is my legacy ready,
 * what should I do next. The greeting renders immediately; each section fills
 * in from the shared legacy state as its data arrives.
 */
export function DashboardView({ firstName }: { firstName: string | null }) {
  const now = useNow();
  const { state, isPending, isError, refetch } = useLegacyState();
  const attention = state
    ? state.open.filter((action) => action.priority !== "RECOMMENDED").length
    : null;
  const recommendations = state ? state.open.length - (attention ?? 0) : 0;
  const willLabel =
    state?.snapshot.plan.status === "DRAFT"
      ? "Continue Will"
      : state?.snapshot.plan.finalized
        ? "Review Will"
        : "Create Will";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(now)}
        title={`${greeting(now)}${firstName ? `, ${firstName}` : ""}.`}
        description={
          attention === null
            ? "Checking your legacy…"
            : attention > 0
              ? `You have ${pluralize(attention, "action")} requiring attention${recommendations ? `, plus ${pluralize(recommendations, "recommendation")}` : ""}.`
              : "Nothing requires your attention. Your legacy is up to date."
        }
        actions={
          <>
            <Button variant="ai" nativeButton={false} render={<Link href="/ai" />}>
              <Sparkles data-icon="inline-start" />
              Ask Copilot
            </Button>
            <Button nativeButton={false} render={<Link href="/documents?upload=1" />}>
              <Upload data-icon="inline-start" />
              Upload Document
            </Button>
          </>
        }
      />

      {isError && (
        <ErrorState
          title="Some of your legacy could not be loaded"
          description="Nothing was changed. Actions and readiness appear once everything loads."
          onRetry={refetch}
        />
      )}

      {/* Action Centre + Legacy Readiness */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="glass-highlight glass lg:col-span-3">
          <PanelHeader
            icon={ListChecks}
            tone={
              state?.open.some((a) => a.priority === "CRITICAL")
                ? "danger"
                : attention
                  ? "warning"
                  : "success"
            }
            title="Action Centre"
            description={
              state
                ? state.open.length
                  ? "Prioritized from your own account"
                  : "You are all caught up"
                : "Gathering your actions…"
            }
            action={
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/actions" />}
              >
                View all{state ? ` (${state.open.length})` : ""}
                <ArrowRight data-icon="inline-end" />
              </Button>
            }
          />
          <CardContent>
            {!state ? (
              isPending ? (
                <SectionSkeleton />
              ) : null
            ) : state.open.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/5 px-4 py-6 text-sm">
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                Every action is complete. New ones appear as your legacy changes.
              </div>
            ) : (
              <ActionList actions={state.open.slice(0, 5)} label="Top actions" compact />
            )}
          </CardContent>
        </Card>

        <Card className="glass-highlight glass lg:col-span-2">
          <PanelHeader
            icon={Gauge}
            title="Legacy Readiness"
            description="Six areas, every point explained"
          />
          <CardContent>
            {state ? (
              <ReadinessPanel
                breakdown={state.readiness}
                nextAction={state.open[0]}
                showMissing={false}
              />
            ) : (
              <SectionSkeleton rows={5} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Security, vault, deadlines */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SecurityHealthCard state={state} />
        <VaultOverviewCard state={state} />
        <DeadlinesCard state={state} now={now} />
      </div>

      {/* Activity, quick actions, copilot */}
      <div className="grid gap-4 lg:grid-cols-5">
        {state ? (
          <RecentActivityCard />
        ) : (
          <Card className="glass lg:col-span-3">
            <PanelHeader icon={Activity} title="Recent activity" />
            <CardContent>
              <SectionSkeleton rows={4} />
            </CardContent>
          </Card>
        )}
        <div className="space-y-4 lg:col-span-2">
          <section aria-labelledby="quick-actions" className="space-y-2.5">
            <h2
              id="quick-actions"
              className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Quick actions
            </h2>
            <QuickActions willLabel={willLabel} checkInAvailable={canCheckIn(state)} />
          </section>
          <IntelligenceCard state={state} />
          {state && <CopilotCard state={state} />}
        </div>
      </div>
    </div>
  );
}

const CHECK_ICON: Record<SecurityCheck["status"], { icon: LucideIcon; className: string }> = {
  good: { icon: CheckCircle2, className: "text-success" },
  attention: { icon: AlertTriangle, className: "text-warning" },
  risk: { icon: XCircle, className: "text-destructive" },
};

/** Security health from the same real-state checks as the Security Centre. */
function SecurityHealthCard({ state }: { state: LegacyState | null }) {
  const dms = useDeadManSwitch();
  if (!state) {
    return (
      <Card className="glass">
        <PanelHeader icon={ShieldCheck} title="Security health" />
        <CardContent>
          <SectionSkeleton rows={3} />
        </CardContent>
      </Card>
    );
  }
  const s = state.snapshot;
  const checks = securityChecks({
    mfaEnabled: s.security.mfaEnabled,
    emailVerified: s.security.emailVerified,
    alternateEmail: s.security.recoveryEmail ? "on-file" : null,
    beneficiaryCount: s.beneficiaries.total,
    activeBeneficiaryCount: s.beneficiaries.active + s.beneficiaries.pending,
    planFinalized: s.plan.finalized,
    deadManSwitch: dms.data ?? null,
    emergencyContactCount: s.emergency.contacts,
    encryptedFieldCount: 0,
  });
  const score = securityScore(checks);
  const tone = score >= 80 ? "success" : score >= 60 ? "warning" : "danger";
  const weak = checks.filter((check) => check.status !== "good");
  return (
    <Card className="glass">
      <PanelHeader
        icon={ShieldCheck}
        tone={tone}
        title="Security health"
        description={
          weak.length
            ? `${pluralize(weak.length, "control")} to strengthen`
            : "Every control in place"
        }
        action={
          <StatusBadge tone={tone}>
            {score >= 80 ? "Strong" : score >= 60 ? "Good" : "Weak"}
          </StatusBadge>
        }
      />
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <ProgressRing
            value={score}
            size={76}
            stroke={7}
            tone={tone}
            caption="score"
            label="Security score"
          />
          <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
            {(weak.length ? weak : checks).slice(0, 3).map((check) => {
              const { icon: Icon, className } = CHECK_ICON[check.status];
              return (
                <li key={check.id} className="flex items-center gap-2">
                  <Icon className={cn("size-4 shrink-0", className)} aria-hidden />
                  <span className="truncate">{check.title}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          nativeButton={false}
          render={<Link href="/security-center" />}
        >
          Open Security Centre
          <ArrowRight data-icon="inline-end" />
        </Button>
      </CardContent>
    </Card>
  );
}

function VideoCount() {
  const videos = useVideos();
  return <>{videos.data ? String(videos.data.total ?? videos.data.items.length) : "—"}</>;
}

function VaultOverviewCard({ state }: { state: LegacyState | null }) {
  const s = state?.snapshot;
  const rows: {
    icon: LucideIcon;
    label: string;
    value: React.ReactNode;
    hint: string;
    href: string;
  }[] = s
    ? [
        {
          icon: FileText,
          label: "Documents",
          value: String(s.documents.total),
          hint: `${s.documents.shared} shared · ${s.documents.categorized} categorized`,
          href: "/documents",
        },
        {
          icon: Wallet,
          label: "Assets",
          value: String(s.assets.total),
          hint: `${s.assets.assigned} assigned · ${s.assets.digital} digital`,
          href: "/assets",
        },
        {
          icon: Users,
          label: "Beneficiaries",
          value: String(s.beneficiaries.total),
          hint: `${s.beneficiaries.active} active · ${s.beneficiaries.pending} pending`,
          href: "/beneficiaries",
        },
        {
          icon: Video,
          label: "Video messages",
          value: <VideoCount />,
          hint: "Delivered on your conditions",
          href: "/video-legacy",
        },
      ]
    : [];
  return (
    <Card className="glass">
      <PanelHeader
        icon={FileText}
        title="Vault overview"
        description="What your vault holds today"
      />
      <CardContent>
        {!s ? (
          <SectionSkeleton rows={4} />
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((row) => (
              <li key={row.label}>
                <Link
                  href={row.href}
                  className="group flex items-center gap-3 rounded-lg py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="icon-tile size-8 text-primary">
                    <row.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{row.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.hint}</span>
                  </span>
                  <span className="font-heading text-xl font-semibold tabular-nums">
                    {row.value}
                  </span>
                  <ArrowRight
                    className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DeadlinesCard({ state, now }: { state: LegacyState | null; now: number }) {
  const dated = state?.open.filter((action) => action.deadline) ?? [];
  const dms = state ? dmsView(state.snapshot.dms.status) : null;
  return (
    <Card className="glass md:col-span-2 xl:col-span-1">
      <PanelHeader
        icon={CalendarClock}
        title="Upcoming deadlines"
        description="Check-ins, decisions and document expiry"
      />
      <CardContent className="space-y-3">
        {!state ? (
          <SectionSkeleton rows={3} />
        ) : (
          <>
            {dated.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                No upcoming deadlines. Add expiry dates to documents to track them here.
              </p>
            ) : (
              <ul className="space-y-2">
                {dated.slice(0, 4).map((action) => {
                  const overdue = Date.parse(action.deadline!) < now;
                  return (
                    <li key={action.id}>
                      <Link
                        href={action.href}
                        className="flex items-center gap-3 rounded-lg border border-border/70 bg-surface/40 px-3 py-2 text-sm outline-none hover:border-primary/30 focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <span className="min-w-0 flex-1 truncate">{action.title}</span>
                        <span
                          className={cn(
                            "shrink-0 text-xs tabular-nums",
                            overdue ? "font-medium text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {overdue ? "Overdue" : formatDate(action.deadline!)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              href="/dead-man-switch"
              className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <TimerReset className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 text-muted-foreground">
                Dead Man’s Switch · <span className="text-foreground">{dms?.label}</span>
                {state.snapshot.dms.nextCheckInAt && canCheckIn(state)
                  ? ` · next check-in ${formatRelative(state.snapshot.dms.nextCheckInAt, now)}`
                  : ""}
              </span>
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivityCard() {
  const activity = useActivity(20);
  return (
    <Card className="glass lg:col-span-3">
      <PanelHeader
        icon={Activity}
        title="Recent activity"
        description="From your audit trail — action, resource, outcome"
        action={
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/activity" />}>
            Audit Centre
            <ArrowRight data-icon="inline-end" />
          </Button>
        }
      />
      <CardContent>
        {activity.isPending ? (
          <SectionSkeleton rows={4} />
        ) : activity.isError ? (
          <p className="text-sm text-destructive">Recent activity could not be loaded.</p>
        ) : (
          <ActivityFeed items={activity.data?.items ?? []} limit={6} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Legacy Intelligence at a glance: counts of what the deterministic rules found,
 * each linking to the filtered view. Derived from the same loaded state as the
 * rest of the page — it adds no request and never blocks the greeting.
 */
function IntelligenceCard({ state }: { state: LegacyState | null }) {
  const open = state?.intelligence.open ?? [];
  const assetIds = new Set(
    open.flatMap((finding) =>
      finding.sourceRecords.filter((record) => record.kind === "asset").map((record) => record.id),
    ),
  );
  const rows = [
    {
      label: "Critical & important",
      value: open.filter((f) => f.severity === "CRITICAL" || f.severity === "IMPORTANT").length,
      href: "/intelligence",
    },
    {
      label: "Potential conflicts",
      value: open.filter((f) => f.type === "CONFLICT").length,
      href: "/intelligence?type=CONFLICT",
    },
    { label: "Assets needing attention", value: assetIds.size, href: "/assets?filter=attention" },
    {
      label: "Expiring or due",
      value: open.filter((f) => f.type === "EXPIRING").length,
      href: "/intelligence?type=EXPIRING",
    },
  ];
  return (
    <Card className="glass">
      <PanelHeader
        icon={ScanSearch}
        title="Legacy Intelligence"
        description="System detected from your records"
        action={
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/intelligence" />}
          >
            Open
          </Button>
        }
      />
      <CardContent>
        {!state ? (
          <SectionSkeleton rows={2} />
        ) : (
          <ul className="grid grid-cols-2 gap-2" aria-label="Legacy Intelligence summary">
            {rows.map((row) => (
              <li key={row.label}>
                <Link
                  href={row.href}
                  className="flex h-full flex-col gap-0.5 rounded-lg border border-border px-3 py-2 transition-colors outline-none hover:border-primary/30 hover:bg-primary/[0.04] focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span
                    className={cn(
                      "font-heading text-lg font-semibold tabular-nums",
                      row.value ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {row.value}
                  </span>
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActions({
  willLabel,
  checkInAvailable,
}: {
  willLabel: string;
  checkInAvailable: boolean;
}) {
  const checkInMutation = useCheckIn();
  const checkIn = async () => {
    try {
      await checkInMutation.mutateAsync();
      toast.success("Check-in recorded — thank you");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not record the check-in.");
    }
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      <QuickAction
        icon={Upload}
        label="Upload document"
        description="Private, checked, versioned"
        href="/documents?upload=1"
      />
      <QuickAction
        icon={UserPlus}
        label="Add beneficiary"
        description="Invite someone you trust"
        href="/beneficiaries?new=1"
      />
      <QuickAction
        icon={ScrollText}
        label={willLabel}
        description="Guided, auto-saving plan"
        href="/legacy-plan/wizard"
      />
      <QuickAction
        icon={Coins}
        label="Add asset"
        description="Financial, physical or digital"
        href="/assets"
        accent="cyan"
      />
      <QuickAction
        icon={CheckCircle2}
        label="Check in"
        description={checkInAvailable ? "Confirm you are active" : "Switch not monitoring"}
        accent="success"
        disabled={!checkInAvailable || checkInMutation.isPending}
        onClick={() => void checkIn()}
      />
      <QuickAction
        icon={HeartHandshake}
        label="Record a life event"
        description="Marriage, child, property…"
        href="/life-events"
      />
    </div>
  );
}

/** AI entry point. Copilot answers are suggestions; the state above is verified. */
function CopilotCard({ state }: { state: LegacyState }) {
  const availability = useAIAvailability();
  const top = state.open[0];
  return (
    <Card className="relative overflow-hidden py-0 border-gradient-ai">
      <span
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-brand-purple/15 blur-3xl"
      />
      <CardContent className="relative space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-heading text-[15px] font-semibold">
            <Sparkles className="size-4 text-brand-purple" aria-hidden />
            LegacyVault Copilot
          </p>
          {availability.data &&
            (availability.data.configured ? (
              <StatusBadge tone="ai">AI ready</StatusBadge>
            ) : (
              <StatusBadge tone="warning">AI not configured</StatusBadge>
            ))}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {top
            ? `Top of your list: “${top.title}”. Ask the Copilot to help you plan it and what comes after.`
            : "Ask the Copilot to explain a document, find gaps, or plan your next steps."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ai"
            size="sm"
            nativeButton={false}
            render={<Link href="/ai?mode=analyze" />}
          >
            What am I missing?
          </Button>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/ai?mode=plan" />}
          >
            Plan next steps
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          Copilot answers are AI suggestions. Scores and actions on this page come from your
          account.
        </p>
      </CardContent>
    </Card>
  );
}
