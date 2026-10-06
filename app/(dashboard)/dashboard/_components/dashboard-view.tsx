"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Coins,
  FileText,
  Globe,
  Lock,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  TimerReset,
  Upload,
  UserPlus,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ActivityFeed } from "@/components/shared/activity-feed";
import { PageHeader } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { ProgressRing } from "@/components/shared/progress-card";
import { QuickAction } from "@/components/shared/quick-action";
import { StaggerGrid, StaggerItem } from "@/components/shared/page-transition";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { useActivity } from "@/hooks/use-activity";
import { useAIAvailability, useAIInteractions } from "@/hooks/use-ai";
import { useAssets } from "@/hooks/use-assets";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { useCheckIn, useDeadManSwitch } from "@/hooks/use-dead-man-switch";
import { useDocuments } from "@/hooks/use-documents";
import { useEmergencyAccess } from "@/hooks/use-emergency-access";
import { useLegacyPlanOverview } from "@/hooks/use-legacy-plan";
import { useNotifications } from "@/hooks/use-notifications";
import { useNow } from "@/hooks/use-now";
import { useProfile } from "@/hooks/use-profile";
import { ApiError } from "@/lib/client/api-client";
import { assetTotal } from "@/lib/assets/meta";
import { readiness } from "@/lib/client/readiness";
import { dmsView, eaRequestView } from "@/lib/client/dms-presentation";
import { computeCompleteness } from "@/lib/legacy-plan/completeness";
import { securityChecks, securityScore, type SecurityCheck } from "@/lib/client/security-checks";
import { formatBytes, formatCompactCurrency, formatRelative, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHECK_ICON: Record<SecurityCheck["status"], { icon: LucideIcon; className: string }> = {
  good: { icon: CheckCircle2, className: "text-success" },
  attention: { icon: AlertTriangle, className: "text-warning" },
  risk: { icon: XCircle, className: "text-destructive" },
};

const TONE_TILE: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-primary",
  ai: "text-brand-purple",
};

/** Card heading used across the dashboard: icon tile, title, one-line context, action. */
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

export function DashboardView({ firstName }: { firstName: string | null }) {
  const now = useNow();
  const profile = useProfile();
  const planOverview = useLegacyPlanOverview();
  const beneficiariesQuery = useBeneficiaries();
  const financial = useAssets("FINANCIAL_ASSET");
  const physical = useAssets("PHYSICAL_ASSET");
  const digital = useAssets("DIGITAL_ASSET");
  const documentsQuery = useDocuments({ limit: 100 });
  const dmsQuery = useDeadManSwitch();
  const emergencyQuery = useEmergencyAccess();
  const notificationsQuery = useNotifications({ limit: 50 });
  const activityQuery = useActivity(20);
  const checkInMutation = useCheckIn();

  if (profile.isPending || planOverview.isPending) return <PageSkeleton stats={5} />;

  const beneficiaryItems = beneficiariesQuery.data?.items ?? [];
  const assetItems = [
    ...(financial.data?.items ?? []),
    ...(physical.data?.items ?? []),
    ...(digital.data?.items ?? []),
  ];
  const assets = assetItems.map((item) => item.asset);
  const unassignedAssetList = assetItems.filter((item) => item.assignments.length === 0);
  const documents = documentsQuery.data?.items ?? [];
  const currentPlan = planOverview.data?.current ?? null;
  const planVersions = planOverview.data?.versions ?? [];
  const contacts = emergencyQuery.data?.contacts ?? [];
  const requests = emergencyQuery.data?.requests ?? [];

  const plan = computeCompleteness({
    stepsData: currentPlan?.stepsData ?? {},
    beneficiaries: beneficiaryItems,
    assets: assets.map((asset) => ({ id: asset.id, kind: asset.kind })),
    documents: documents.map((document) => ({ id: document.id })),
  });

  const dmsData = dmsQuery.data ?? null;
  const score = readiness({
    planFinalized: currentPlan?.status === "FINALIZED",
    planVersion: currentPlan?.version ?? null,
    planPercent: plan.percent,
    activeBeneficiaries: beneficiaryItems.filter((b) => b.status !== "INACTIVE").length,
    assetCount: assets.length,
    assignedAssetCount: assets.length - unassignedAssetList.length,
    documentCount: documents.length,
    deadManSwitch: dmsData,
    emergencyContactCount: contacts.length,
    mfaEnabled: profile.data?.mfaEnabled ?? false,
  });

  const dmsStatus = dmsData?.status ?? "INACTIVE";
  const checkIn = async () => {
    try {
      await checkInMutation.mutateAsync();
      toast.success("Check-in recorded — thank you");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not record the check-in.");
    }
  };
  const dms = dmsView(dmsStatus);
  const checks = securityChecks({
    mfaEnabled: profile.data?.mfaEnabled ?? false,
    emailVerified: profile.data?.emailVerified ?? false,
    alternateEmail: profile.data?.alternateEmail ?? null,
    beneficiaryCount: beneficiaryItems.length,
    activeBeneficiaryCount: beneficiaryItems.filter((b) => b.status !== "INACTIVE").length,
    planFinalized: planVersions.length > 0,
    deadManSwitch: dmsData,
    emergencyContactCount: contacts.length,
    encryptedFieldCount: profile.data?.hasIdentificationDetails ? 1 : 0,
  });
  const security = securityScore(checks);
  const securityTone = security >= 80 ? "success" : security >= 60 ? "warning" : "danger";
  const securityLabel = security >= 80 ? "Strong" : security >= 60 ? "Good" : "Weak";
  const unread = (notificationsQuery.data?.items ?? []).filter((n) => !n.readAt);
  const openRequests = requests.filter((r) => r.status === "VERIFIED");
  const unassigned = unassignedAssetList.map((item) => item.asset);
  const activeBeneficiaries = beneficiaryItems.filter((b) => b.status === "ACTIVE").length;
  const pendingBeneficiaries = beneficiaryItems.filter((b) => b.status === "PENDING").length;
  const canCheckIn = ["ACTIVE", "REMINDER_SENT", "GRACE_PERIOD"].includes(dmsStatus);
  const sharedDocuments = documents.filter((document) => document.shareCount > 0).length;
  const recentDocuments = [...documents]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 4);
  const willLabel =
    currentPlan?.status === "DRAFT" ? "Continue Will" : currentPlan ? "New draft" : "Create Will";

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
    dmsData?.nextCheckInAt &&
    Date.parse(dmsData?.nextCheckInAt) - now < 4 * 86_400_000
      ? [
          {
            id: "dms",
            tone: "info" as const,
            icon: TimerReset,
            title: `Check-in due ${formatRelative(dmsData?.nextCheckInAt, now)}`,
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
    ...(!(profile.data?.mfaEnabled ?? false)
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
        title={`Welcome back${firstName ? `, ${firstName}` : ""}`}
        description={
          attention.length
            ? `Here’s what needs your attention — ${pluralize(attention.length, "item")} waiting below.`
            : "Everything is in order. Nothing needs your attention right now."
        }
        actions={
          <>
            <Button variant="ai" nativeButton={false} render={<Link href="/ai" />}>
              <Sparkles data-icon="inline-start" />
              Ask AI Assistant
            </Button>
            <Button nativeButton={false} render={<Link href="/documents?upload=1" />}>
              <Upload data-icon="inline-start" />
              Upload Document
            </Button>
          </>
        }
      />

      {/* KPIs */}
      <StaggerGrid
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5"
        stagger={0.05}
      >
        <StaggerItem>
          <StatCard
            label="Documents"
            value={documentsQuery.data?.total ?? documents.length}
            hint={`${sharedDocuments} shared · private storage`}
            icon={FileText}
            accent="blue"
            href="/documents"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Beneficiaries"
            value={beneficiaryItems.length}
            hint={`${activeBeneficiaries} active · ${pendingBeneficiaries} pending`}
            icon={Users}
            accent="blue"
            href="/beneficiaries"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Digital assets"
            value={digital.data?.total ?? digital.data?.items.length ?? 0}
            hint={`${pluralize(assets.length, "asset")} · ≈ ${formatCompactCurrency(assetTotal(assets))}`}
            icon={Globe}
            accent="cyan"
            href="/assets/digital"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Security score"
            value={
              <>
                {security}
                <span className="ml-1 text-base font-medium text-muted-foreground">/100</span>
              </>
            }
            hint={`${securityLabel} · ${checks.filter((c) => c.status === "good").length} of ${checks.length} checks passing`}
            icon={securityTone === "success" ? ShieldCheck : ShieldAlert}
            accent={securityTone}
            href="/security-center"
          />
        </StaggerItem>
        <StaggerItem className="col-span-2 lg:col-span-1">
          <StatCard
            label="Dead Man’s Switch"
            value={<span className="text-2xl sm:text-[1.65rem]">{dms.label}</span>}
            hint={
              dmsData?.nextCheckInAt && canCheckIn
                ? `Next check-in ${formatRelative(dmsData.nextCheckInAt, now)}`
                : dmsStatus === "INACTIVE"
                  ? "Not monitoring — nothing will be released"
                  : dmsStatus === "PAUSED"
                    ? "Paused — no deadline is running"
                    : "Open the switch to review its release state"
            }
            icon={TimerReset}
            accent={dms.tone === "info" ? "blue" : dms.tone === "danger" ? "danger" : dms.tone}
            href="/dead-man-switch"
          />
        </StaggerItem>
      </StaggerGrid>

      {/* Attention + security */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass-highlight glass lg:col-span-2">
          <PanelHeader
            icon={AlertTriangle}
            tone={attention.length ? "warning" : "success"}
            title="Needs your attention"
            description={
              unread.length
                ? `${pluralize(unread.length, "unread notification")}`
                : "You are all caught up on notifications"
            }
            action={
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/notifications" />}
              >
                Notifications
                <ArrowRight data-icon="inline-end" />
              </Button>
            }
          />
          <CardContent>
            {attention.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/5 px-4 py-6 text-sm">
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                Nothing pending. Your legacy is in good shape.
              </div>
            ) : (
              <ul className="grid gap-2 md:grid-cols-2">
                {attention.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="group flex h-full items-center gap-3 rounded-xl border border-border bg-surface/40 p-3 transition-[border-color,background-color] duration-200 outline-none hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className={cn("icon-tile size-9", TONE_TILE[item.tone])}>
                        <item.icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 text-sm leading-5">{item.title}</span>
                      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                        {item.cta}
                        <ArrowRight
                          className="size-3.5 transition-transform group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <section aria-labelledby="quick-actions" className="space-y-2.5 pt-5">
              <h2
                id="quick-actions"
                className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
              >
                Important actions
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <QuickAction
                  icon={Upload}
                  label="Upload document"
                  description="Private, checked, versioned"
                  href="/documents?upload=1"
                  accent="blue"
                />
                <QuickAction
                  icon={UserPlus}
                  label="Add beneficiary"
                  description="Invite someone you trust"
                  href="/beneficiaries?new=1"
                  accent="blue"
                />
                <QuickAction
                  icon={ScrollText}
                  label={willLabel}
                  description={`${plan.percent}% complete`}
                  href="/legacy-plan/wizard"
                  accent="blue"
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
                  description={canCheckIn ? "Confirm you are active" : "Switch not monitoring"}
                  accent="success"
                  disabled={!canCheckIn}
                  onClick={() => void checkIn()}
                />
                <QuickAction
                  icon={Sparkles}
                  label="Ask AI"
                  description="Organize, review, draft"
                  href="/ai"
                  accent="purple"
                />
              </div>
            </section>
          </CardContent>
        </Card>

        <Card className="glass-highlight glass">
          <PanelHeader
            icon={ShieldCheck}
            tone={securityTone}
            title="Security status"
            description="Account, encryption and protection"
            action={<StatusBadge tone={securityTone}>{securityLabel}</StatusBadge>}
          />
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <ProgressRing
                value={security}
                size={88}
                stroke={8}
                tone={securityTone}
                caption="score"
                label="Security score"
              />
              <p className="text-sm leading-6 text-muted-foreground">
                {checks.filter((c) => c.status !== "good").length
                  ? `${pluralize(checks.filter((c) => c.status !== "good").length, "control")} can be strengthened.`
                  : "Every control we check is in place."}
              </p>
            </div>
            <ul className="space-y-2 text-sm">
              {checks.slice(0, 5).map((check) => {
                const { icon: Icon, className } = CHECK_ICON[check.status];
                return (
                  <li key={check.id} className="flex items-center gap-2.5">
                    <Icon className={cn("size-4 shrink-0", className)} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{check.title}</span>
                    <span className="sr-only">
                      {check.status === "good"
                        ? "in place"
                        : check.status === "attention"
                          ? "needs attention"
                          : "at risk"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              nativeButton={false}
              render={<Link href="/security-center" />}
            >
              Open Security Center
              <ArrowRight data-icon="inline-end" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Activity + readiness */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass lg:col-span-2">
          <PanelHeader
            icon={Activity}
            title="Recent activity"
            description="From your audit trail — actor, action, outcome"
            action={
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/activity" />}
              >
                View all
                <ArrowRight data-icon="inline-end" />
              </Button>
            }
          />
          <CardContent>
            <ActivityFeed items={activityQuery.data?.items ?? []} limit={6} />
          </CardContent>
        </Card>

        <Card className="glass-highlight glass">
          <PanelHeader
            icon={Lock}
            title="Legacy readiness"
            description="How complete and protected your legacy is today"
          />
          <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center lg:flex-col lg:items-stretch">
            <ProgressRing
              value={score.score}
              label="Legacy readiness score"
              className="self-center"
            />
            <ul className="flex-1 space-y-2.5">
              {score.items.slice(0, 5).map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="group block space-y-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate transition-colors group-hover:text-foreground">
                        {item.label}
                      </span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {Math.round(item.earned)}/{item.weight}
                      </span>
                    </div>
                    <Progress value={(item.earned / item.weight) * 100} aria-label={item.label}>
                      <ProgressTrack className="h-1">
                        <ProgressIndicator className="rounded-full bg-gradient-brand" />
                      </ProgressTrack>
                    </Progress>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Vault, will, AI */}
      <StaggerGrid className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" stagger={0.06}>
        <StaggerItem>
          <Card className="h-full glass">
            <PanelHeader
              icon={FileText}
              title="Digital vault"
              description={`${formatBytes(documents.reduce((sum, d) => sum + d.sizeBytes, 0))} stored privately`}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/documents" />}
                >
                  Open
                  <ArrowRight data-icon="inline-end" />
                </Button>
              }
            />
            <CardContent>
              {recentDocuments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No documents yet.{" "}
                  <Link href="/documents?upload=1" className="font-medium text-primary">
                    Upload your first
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {recentDocuments.map((document) => (
                    <li key={document.id} className="flex items-center gap-3 py-2.5">
                      <span className="icon-tile size-8 text-primary">
                        <FileText className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{document.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatBytes(document.sizeBytes)} ·{" "}
                          {formatRelative(document.updatedAt, now)}
                        </span>
                      </span>
                      {document.shareCount > 0 ? (
                        <StatusBadge tone="success" icon={Users} className="h-5 px-2 text-[11px]">
                          {document.shareCount}
                        </StatusBadge>
                      ) : (
                        <Lock className="size-3.5 text-muted-foreground" aria-label="Private" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className="h-full glass">
            <PanelHeader
              icon={ScrollText}
              title="Digital will"
              description="Guided 11-step legacy plan"
              action={
                <StatusBadge
                  tone={
                    currentPlan?.status === "FINALIZED"
                      ? "success"
                      : currentPlan
                        ? "info"
                        : "neutral"
                  }
                >
                  {currentPlan?.status === "FINALIZED"
                    ? "Finalized"
                    : currentPlan
                      ? "Draft"
                      : "Not started"}
                </StatusBadge>
              }
            />
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="font-heading text-3xl font-semibold tabular-nums">
                    {plan.percent}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {currentPlan
                      ? `Step ${Math.min(currentPlan!.currentStep, 11)} of 11 · v${currentPlan!.version}`
                      : "0 of 9 sections"}
                  </span>
                </div>
                <Progress value={plan.percent} aria-label="Legacy plan completion" className="mt-2">
                  <ProgressTrack className="h-2">
                    <ProgressIndicator className="rounded-full bg-gradient-brand" />
                  </ProgressTrack>
                </Progress>
              </div>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {Object.values(plan.sections).map((section) => (
                  <li
                    key={section.key}
                    className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground"
                    title={section.title}
                  >
                    {section.complete ? (
                      <CheckCircle2 className="size-3 shrink-0 text-success" aria-hidden />
                    ) : (
                      <span
                        aria-hidden
                        className="size-3 shrink-0 rounded-full border border-muted-foreground/40"
                      />
                    )}
                    <span className="truncate">{section.title}</span>
                    <span className="sr-only">{section.complete ? "complete" : "incomplete"}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" nativeButton={false} render={<Link href="/legacy-plan/wizard" />}>
                  <ScrollText data-icon="inline-start" />
                  {willLabel}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/legacy-plan" />}
                >
                  Plan overview
                </Button>
              </div>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem className="md:col-span-2 xl:col-span-1">
          <AIActivityCard now={now} />
        </StaggerItem>
      </StaggerGrid>

      {/* Protection */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-highlight glass">
          <PanelHeader
            icon={TimerReset}
            tone={dms.tone}
            title="Dead Man’s Switch"
            description="Releases your legacy only if you stop checking in"
            action={
              <StatusBadge tone={dms.tone} pulse={dms.tone === "success"}>
                {dms.label}
              </StatusBadge>
            }
          />
          <CardContent className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              {[
                ["Last check-in", formatRelative(dmsData?.lastCheckInAt ?? null, now)],
                [
                  "Next check-in",
                  dmsData?.nextCheckInAt ? formatRelative(dmsData?.nextCheckInAt, now) : "—",
                ],
                ["Trusted contacts", String(dmsData?.contacts.length ?? 0)],
                ["Inactivity threshold", `${dmsData?.inactivityPeriodDays ?? 0} days`],
              ].map(([term, value]) => (
                <div key={term} className="rounded-lg border border-border/70 bg-surface/40 p-3">
                  <dt className="text-xs text-muted-foreground">{term}</dt>
                  <dd className="mt-0.5 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="success"
                disabled={!canCheckIn}
                loading={checkInMutation.isPending}
                onClick={() => void checkIn()}
              >
                {!checkInMutation.isPending && <CheckCircle2 data-icon="inline-start" />}
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
          <PanelHeader
            icon={Siren}
            tone={openRequests.length ? "warning" : contacts.length ? "success" : "neutral"}
            title="Emergency access"
            description="Verified access for people you designate"
            action={
              <StatusBadge
                tone={openRequests.length ? "warning" : contacts.length ? "success" : "neutral"}
              >
                {openRequests.length
                  ? `${openRequests.length} pending`
                  : contacts.length
                    ? "Configured"
                    : "Not set"}
              </StatusBadge>
            }
          />
          <CardContent className="space-y-4 text-sm">
            <ul className="space-y-2">
              {contacts.map((config) => {
                const beneficiaryName = config.beneficiaryName;
                const request = requests.find(
                  (r) =>
                    r.configId === config.id && r.status !== "EXPIRED" && r.status !== "DENIED",
                );
                return (
                  <li
                    key={config.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface/40 px-3 py-2"
                  >
                    <span className="truncate font-medium">{beneficiaryName}</span>
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
              {contacts.length === 0 && (
                <li className="rounded-lg border border-dashed border-border px-3 py-4 text-muted-foreground">
                  No emergency contact designated yet.
                </li>
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
  );
}

const SESSION_LABEL: Record<string, string> = {
  ASSISTANT: "Assistant conversation",
  DOCUMENT_ANALYSIS: "Document analysis",
  WILL_GENERATOR: "Will draft",
};

/**
 * AI assistant summary, from the sanitized usage records (ADR-016): when AI was
 * used and for what kind of task — never what was asked or answered, which is
 * not stored.
 */
function AIActivityCard({ now }: { now: number }) {
  const availability = useAIAvailability();
  const interactions = useAIInteractions(5);
  const items = interactions.data?.items ?? [];
  return (
    <Card className="relative h-full overflow-hidden border-gradient-ai">
      <span
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-brand-purple/20 blur-3xl"
      />
      <PanelHeader
        icon={Sparkles}
        tone="ai"
        title="AI assistant"
        description="Only when AI was used is recorded — never what you asked"
        action={
          availability.data &&
          (availability.data.configured ? (
            <StatusBadge tone="ai">AI ready</StatusBadge>
          ) : (
            <StatusBadge tone="warning">AI not configured</StatusBadge>
          ))
        }
      />
      <CardContent className="relative space-y-4">
        {interactions.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : interactions.isError ? (
          <p className="text-sm text-destructive">AI activity could not be loaded.</p>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-brand-purple/25 px-4 py-5 text-center text-sm text-muted-foreground">
            No AI activity yet. Ask the assistant a question or summarize a document.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate">
                  {SESSION_LABEL[item.sessionType] ?? item.sessionType}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelative(item.createdAt, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ai" size="sm" nativeButton={false} render={<Link href="/ai" />}>
          <Sparkles data-icon="inline-start" />
          Open AI Assistant
        </Button>
      </CardContent>
    </Card>
  );
}
