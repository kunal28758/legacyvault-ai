"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Coins,
  FileText,
  ScrollText,
  ShieldCheck,
  Siren,
  TimerReset,
  Upload,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { ActivityFeed } from "@/components/shared/activity-feed";
import { PageHeader, SectionHeading } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { ProgressRing } from "@/components/shared/progress-card";
import { QuickAction } from "@/components/shared/quick-action";
import { StaggerGrid, StaggerItem } from "@/components/shared/page-transition";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { useDemoWorkspace, useNow } from "@/hooks/use-demo-workspace";
import {
  assetTotal,
  dmsView,
  eaRequestView,
  getPlanCompleteness,
  readiness,
  securityScore,
  unassignedAssets,
} from "@/lib/demo/selectors";
import { useDemoStore } from "@/lib/demo/store";
import { formatCompactCurrency, formatRelative, pluralize } from "@/lib/format";

function greeting(now: number): string {
  const hour = new Date(now).getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function DashboardView({ firstName }: { firstName: string | null }) {
  const { workspace: ws, ready } = useDemoWorkspace();
  const checkIn = useDemoStore((s) => s.dmsCheckIn);
  const now = useNow();

  if (!ready) return <PageSkeleton />;

  const score = readiness(ws);
  const plan = getPlanCompleteness(ws);
  const dms = dmsView(ws.dms.status);
  const security = securityScore(ws);
  const unread = ws.notifications.filter((n) => !n.readAt);
  const openRequests = ws.emergencyRequests.filter((r) => r.status === "VERIFIED");
  const unassigned = unassignedAssets(ws);
  const activeBeneficiaries = ws.beneficiaries.filter((b) => b.status === "ACTIVE").length;
  const pendingBeneficiaries = ws.beneficiaries.filter((b) => b.status === "PENDING").length;
  const canCheckIn = ["ACTIVE", "REMINDER_SENT", "GRACE_PERIOD"].includes(ws.dms.status);

  const attention = [
    ...openRequests.map((r) => ({
      id: r.id,
      tone: "warning" as const,
      icon: Siren,
      title: "Emergency access request needs a decision",
      href: "/emergency-access",
      cta: "Review",
    })),
    ...(canCheckIn &&
    ws.dms.nextCheckInAt &&
    Date.parse(ws.dms.nextCheckInAt) - now < 4 * 86_400_000
      ? [
          {
            id: "dms",
            tone: "info" as const,
            icon: TimerReset,
            title: `Check-in due ${formatRelative(ws.dms.nextCheckInAt, now)}`,
            href: "/dead-man-switch",
            cta: "Check in",
          },
        ]
      : []),
    ...(pendingBeneficiaries
      ? [
          {
            id: "pending",
            tone: "neutral" as const,
            icon: Users,
            title: `${pluralize(pendingBeneficiaries, "beneficiary", "beneficiaries")} haven’t accepted their invitation`,
            href: "/beneficiaries",
            cta: "View",
          },
        ]
      : []),
    ...(unassigned.length
      ? [
          {
            id: "unassigned",
            tone: "neutral" as const,
            icon: Coins,
            title: `${pluralize(unassigned.length, "asset")} without a beneficiary`,
            href: "/assets",
            cta: "Assign",
          },
        ]
      : []),
    ...(!ws.security.mfaEnabled
      ? [
          {
            id: "mfa",
            tone: "warning" as const,
            icon: ShieldCheck,
            title: "Two-factor authentication is off",
            href: "/settings?tab=security",
            cta: "Enable",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(now)}
        title={`${greeting(now)}${firstName ? `, ${firstName}` : ""}`}
        description={
          ws.plan?.status === "FINALIZED"
            ? `Your legacy plan v${ws.plan.version} is finalized. Keep beneficiaries, assets and protection settings current.`
            : `Your legacy plan is ${plan.percent}% complete. ${plan.incompleteSections.length ? `${plan.incompleteSections.length} sections still need attention.` : "Review it and finalize when you are ready."}`
        }
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/ai" />}>
              <Bot data-icon="inline-start" />
              Ask AI
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/legacy-plan/wizard" />}
              className="shadow-glow-blue"
            >
              <ScrollText data-icon="inline-start" />
              {ws.plan?.status === "DRAFT"
                ? "Continue Will"
                : ws.plan
                  ? "New draft"
                  : "Create Will"}
            </Button>
          </>
        }
      />

      {/* Readiness + will + security */}
      <StaggerGrid className="grid gap-4 lg:grid-cols-3">
        <StaggerItem className="lg:col-span-1">
          <Card className="glass-highlight h-full glass">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Legacy readiness</CardTitle>
              <p className="text-sm text-muted-foreground">
                How complete and protected your legacy is today.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center lg:flex-col xl:flex-row">
              <ProgressRing value={score.score} label="Legacy readiness score" />
              <ul className="flex-1 space-y-2.5">
                {score.items.slice(0, 5).map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="group block space-y-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate group-hover:text-foreground">{item.label}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {Math.round(item.earned)}/{item.weight}
                        </span>
                      </div>
                      <Progress value={(item.earned / item.weight) * 100} aria-label={item.label}>
                        <ProgressTrack className="h-1">
                          <ProgressIndicator className="rounded-full bg-primary" />
                        </ProgressTrack>
                      </Progress>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className="glass-highlight h-full glass">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">Digital will</CardTitle>
                <p className="text-sm text-muted-foreground">Guided 11-step legacy plan</p>
              </div>
              <StatusBadge
                tone={ws.plan?.status === "FINALIZED" ? "success" : ws.plan ? "info" : "neutral"}
              >
                {ws.plan?.status === "FINALIZED" ? "Finalized" : ws.plan ? "Draft" : "Not started"}
              </StatusBadge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-semibold tabular-nums">{plan.percent}%</span>
                  <span className="text-xs text-muted-foreground">
                    {ws.plan
                      ? `Step ${Math.min(ws.plan.currentStep, 11)} of 11 · v${ws.plan.version}`
                      : "0 of 9 sections"}
                  </span>
                </div>
                <Progress value={plan.percent} aria-label="Legacy plan completion" className="mt-2">
                  <ProgressTrack className="h-2">
                    <ProgressIndicator className="rounded-full bg-gradient-brand" />
                  </ProgressTrack>
                </Progress>
              </div>
              <ul className="grid grid-cols-3 gap-1.5">
                {Object.values(plan.sections).map((section) => (
                  <li
                    key={section.key}
                    className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground"
                    title={section.title}
                  >
                    <span
                      aria-hidden
                      className={`size-1.5 shrink-0 rounded-full ${section.complete ? "bg-success" : "bg-muted-foreground/40"}`}
                    />
                    <span className="truncate">{section.title}</span>
                    <span className="sr-only">{section.complete ? "complete" : "incomplete"}</span>
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/legacy-plan" />}
              >
                Open legacy plan
                <ArrowRight data-icon="inline-end" />
              </Button>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className="glass-highlight h-full glass">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">Security status</CardTitle>
                <p className="text-sm text-muted-foreground">Account, encryption and protection</p>
              </div>
              <StatusBadge
                tone={security >= 80 ? "success" : security >= 60 ? "warning" : "danger"}
              >
                {security >= 80 ? "Strong" : security >= 60 ? "Good" : "Weak"}
              </StatusBadge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">{security}</span>
                <span className="text-sm text-muted-foreground">/ 100 security score</span>
              </div>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-success" aria-hidden /> Email verified ·
                  sessions encrypted
                </li>
                <li className="flex items-center gap-2">
                  {ws.security.mfaEnabled ? (
                    <CheckCircle2 className="size-4 text-success" aria-hidden />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-4 items-center justify-center rounded-full border-2 border-warning"
                    />
                  )}
                  Two-factor authentication {ws.security.mfaEnabled ? "on" : "off"}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-success" aria-hidden /> Sensitive fields
                  encrypted at rest
                </li>
              </ul>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/security-center" />}
              >
                Open Security Center
                <ArrowRight data-icon="inline-end" />
              </Button>
            </CardContent>
          </Card>
        </StaggerItem>
      </StaggerGrid>

      {/* Stat row */}
      <StaggerGrid className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" stagger={0.05}>
        <StaggerItem>
          <StatCard
            label="Beneficiaries"
            value={ws.beneficiaries.length}
            hint={`${activeBeneficiaries} active · ${pendingBeneficiaries} pending`}
            icon={Users}
            accent="blue"
            href="/beneficiaries"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Assets recorded"
            value={ws.assets.length}
            hint={`≈ ${formatCompactCurrency(assetTotal(ws.assets))} estimated · ${unassigned.length} unassigned`}
            icon={Coins}
            accent="purple"
            href="/assets"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Documents in vault"
            value={ws.documents.length}
            hint={`${ws.documents.filter((d) => d.scanStatus === "CLEAN").length} scanned clean · ${ws.folders.length} folders`}
            icon={FileText}
            accent="cyan"
            href="/documents"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Video messages"
            value={ws.videos.length}
            hint={
              ws.videos.length
                ? `Delivered on ${[...new Set(ws.videos.map((v) => v.deliveryCondition))].length} condition${ws.videos.length > 1 ? "s" : ""}`
                : "None recorded yet"
            }
            icon={Video}
            accent="success"
            href="/video-legacy"
          />
        </StaggerItem>
      </StaggerGrid>

      {/* Protection + quick actions */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <SectionHeading
            title="Protection"
            description="Automated release mechanisms and who can reach your legacy."
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="glass-highlight glass">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-brand-purple/15 text-brand-purple">
                    <TimerReset className="size-4" aria-hidden />
                  </span>
                  <CardTitle className="text-base">Dead Man’s Switch</CardTitle>
                </div>
                <StatusBadge tone={dms.tone} pulse={dms.tone === "success"}>
                  {dms.label}
                </StatusBadge>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Last check-in</dt>
                    <dd className="font-medium">{formatRelative(ws.dms.lastCheckInAt, now)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Next check-in</dt>
                    <dd className="font-medium">
                      {ws.dms.nextCheckInAt ? formatRelative(ws.dms.nextCheckInAt, now) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Trusted contacts</dt>
                    <dd className="font-medium">{ws.dms.contactIds.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Inactivity threshold</dt>
                    <dd className="font-medium">{ws.dms.inactivityPeriodDays} days</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={!canCheckIn}
                    onClick={() => {
                      const result = checkIn();
                      if (result.ok)
                        toast.success("Check-in recorded", {
                          description: "Your switch is back to Active.",
                        });
                      else toast.error(result.message);
                    }}
                  >
                    <CheckCircle2 data-icon="inline-start" />
                    Check in now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    nativeButton={false}
                    render={<Link href="/dead-man-switch" />}
                  >
                    Manage
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-highlight glass">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-brand-cyan/15 text-brand-cyan">
                    <Siren className="size-4" aria-hidden />
                  </span>
                  <CardTitle className="text-base">Emergency access</CardTitle>
                </div>
                <StatusBadge
                  tone={
                    openRequests.length
                      ? "warning"
                      : ws.emergencyContacts.length
                        ? "success"
                        : "neutral"
                  }
                >
                  {openRequests.length
                    ? `${openRequests.length} pending`
                    : ws.emergencyContacts.length
                      ? "Configured"
                      : "Not set"}
                </StatusBadge>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <ul className="space-y-2">
                  {ws.emergencyContacts.map((config) => {
                    const beneficiary = ws.beneficiaries.find((b) => b.id === config.beneficiaryId);
                    const request = ws.emergencyRequests.find(
                      (r) =>
                        r.configId === config.id && r.status !== "EXPIRED" && r.status !== "DENIED",
                    );
                    return (
                      <li key={config.id} className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">
                          {beneficiary?.name ?? "Contact"}
                        </span>
                        {request ? (
                          <StatusBadge
                            tone={eaRequestView(request.status).tone}
                            icon={null}
                            className="h-5 text-[11px]"
                          >
                            {eaRequestView(request.status).label}
                          </StatusBadge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {config.onTimeout === "WAIT"
                              ? "Owner approves"
                              : `Auto ${config.onTimeout === "AUTO_GRANT" ? "grant" : "deny"} after ${config.timeoutHours}h`}
                          </span>
                        )}
                      </li>
                    );
                  })}
                  {ws.emergencyContacts.length === 0 && (
                    <li className="text-muted-foreground">No emergency contact designated yet.</li>
                  )}
                </ul>
                <Button
                  size="sm"
                  variant={openRequests.length ? "default" : "ghost"}
                  nativeButton={false}
                  render={<Link href="/emergency-access" />}
                >
                  {openRequests.length ? "Review request" : "Manage"}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <SectionHeading title="Quick actions" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <QuickAction
              icon={ScrollText}
              label={ws.plan?.status === "DRAFT" ? "Continue Will" : "Create Will"}
              description={`${plan.percent}% complete`}
              href="/legacy-plan/wizard"
              accent="blue"
            />
            <QuickAction
              icon={UserPlus}
              label="Add beneficiary"
              description="Invite someone you trust"
              href="/beneficiaries?new=1"
              accent="purple"
            />
            <QuickAction
              icon={Coins}
              label="Add asset"
              description="Financial, physical or digital"
              href="/assets"
              accent="cyan"
            />
            <QuickAction
              icon={Upload}
              label="Upload document"
              description="Private, scanned, versioned"
              href="/documents?upload=1"
              accent="success"
            />
            <QuickAction
              icon={CheckCircle2}
              label="Check in"
              description={canCheckIn ? "Confirm you are active" : "Switch not monitoring"}
              accent="warning"
              disabled={!canCheckIn}
              onClick={() => {
                const result = checkIn();
                if (result.ok) toast.success("Check-in recorded");
                else toast.error(result.message);
              }}
            />
            <QuickAction
              icon={Bot}
              label="Ask AI"
              description="Organize, review, draft"
              href="/ai"
              accent="purple"
            />
          </div>
        </div>
      </div>

      {/* Activity + attention */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="glass lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Recent activity</CardTitle>
              <p className="text-sm text-muted-foreground">
                From your audit trail — actor, action, outcome.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/security-center#audit" />}
            >
              View all
            </Button>
          </CardHeader>
          <CardContent>
            <ActivityFeed items={ws.activity} limit={6} />
          </CardContent>
        </Card>

        <Card className="glass lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Needs your attention</CardTitle>
              <p className="text-sm text-muted-foreground">
                {unread.length ? `${unread.length} unread notifications` : "You are all caught up"}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing pending. Your legacy is in good shape.
              </p>
            ) : (
              <ul className="space-y-2">
                {attention.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="group flex items-center gap-3 rounded-lg border border-border p-3 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                          item.tone === "warning"
                            ? "bg-warning/15 text-warning"
                            : item.tone === "info"
                              ? "bg-brand-cyan/15 text-brand-cyan"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <item.icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 text-sm">{item.title}</span>
                      <span className="shrink-0 text-xs font-medium text-primary">{item.cta}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
