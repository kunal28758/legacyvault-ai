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
  Sparkles,
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
import { useVideos } from "@/hooks/use-videos";
import { ApiError } from "@/lib/client/api-client";
import { assetTotal } from "@/lib/assets/meta";
import { readiness } from "@/lib/client/readiness";
import { dmsView, eaRequestView } from "@/lib/client/dms-presentation";
import { computeCompleteness } from "@/lib/legacy-plan/completeness";
import { securityChecks, securityScore } from "@/lib/client/security-checks";
import { formatCompactCurrency, formatRelative, pluralize } from "@/lib/format";

function greeting(now: number): string {
  const hour = new Date(now).getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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
  const videosQuery = useVideos();
  const dmsQuery = useDeadManSwitch();
  const emergencyQuery = useEmergencyAccess();
  const notificationsQuery = useNotifications({ limit: 50 });
  const activityQuery = useActivity(20);
  const checkInMutation = useCheckIn();

  if (profile.isPending || planOverview.isPending) return <PageSkeleton />;

  const beneficiaryItems = beneficiariesQuery.data?.items ?? [];
  const assetItems = [
    ...(financial.data?.items ?? []),
    ...(physical.data?.items ?? []),
    ...(digital.data?.items ?? []),
  ];
  const assets = assetItems.map((item) => item.asset);
  const unassignedAssetList = assetItems.filter((item) => item.assignments.length === 0);
  const documents = documentsQuery.data?.items ?? [];
  const videos = videosQuery.data?.items ?? [];
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
  const security = securityScore(
    securityChecks({
      mfaEnabled: profile.data?.mfaEnabled ?? false,
      emailVerified: profile.data?.emailVerified ?? false,
      alternateEmail: profile.data?.alternateEmail ?? null,
      beneficiaryCount: beneficiaryItems.length,
      activeBeneficiaryCount: beneficiaryItems.filter((b) => b.status !== "INACTIVE").length,
      planFinalized: planVersions.length > 0,
      deadManSwitch: dmsData,
      emergencyContactCount: contacts.length,
      encryptedFieldCount: profile.data?.hasIdentificationDetails ? 1 : 0,
    }),
  );
  const unread = (notificationsQuery.data?.items ?? []).filter((n) => !n.readAt);
  const openRequests = requests.filter((r) => r.status === "VERIFIED");
  const unassigned = unassignedAssetList.map((item) => item.asset);
  const activeBeneficiaries = beneficiaryItems.filter((b) => b.status === "ACTIVE").length;
  const pendingBeneficiaries = beneficiaryItems.filter((b) => b.status === "PENDING").length;
  const canCheckIn = ["ACTIVE", "REMINDER_SENT", "GRACE_PERIOD"].includes(dmsStatus);

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
        title={`${greeting(now)}${firstName ? `, ${firstName}` : ""}`}
        description={
          currentPlan?.status === "FINALIZED"
            ? `Your legacy plan v${currentPlan!.version} is finalized. Keep beneficiaries, assets and protection settings current.`
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
              {currentPlan?.status === "DRAFT"
                ? "Continue Will"
                : currentPlan
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
                tone={
                  currentPlan?.status === "FINALIZED" ? "success" : currentPlan ? "info" : "neutral"
                }
              >
                {currentPlan?.status === "FINALIZED"
                  ? "Finalized"
                  : currentPlan
                    ? "Draft"
                    : "Not started"}
              </StatusBadge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-semibold tabular-nums">{plan.percent}%</span>
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
                  {(profile.data?.emailVerified ?? false) ? (
                    <CheckCircle2 className="size-4 text-success" aria-hidden />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-4 items-center justify-center rounded-full border-2 border-warning"
                    />
                  )}
                  Email {(profile.data?.emailVerified ?? false) ? "verified" : "not verified"}
                </li>
                <li className="flex items-center gap-2">
                  {(profile.data?.mfaEnabled ?? false) ? (
                    <CheckCircle2 className="size-4 text-success" aria-hidden />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-4 items-center justify-center rounded-full border-2 border-warning"
                    />
                  )}
                  Two-factor authentication {(profile.data?.mfaEnabled ?? false) ? "on" : "off"}
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
            value={beneficiaryItems.length}
            hint={`${activeBeneficiaries} active · ${pendingBeneficiaries} pending`}
            icon={Users}
            accent="blue"
            href="/beneficiaries"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Assets recorded"
            value={assets.length}
            hint={`≈ ${formatCompactCurrency(assetTotal(assets))} estimated · ${unassigned.length} unassigned`}
            icon={Coins}
            accent="purple"
            href="/assets"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Documents in vault"
            value={documents.length}
            hint={`${documentsQuery.data?.total ?? documents.length} total · private storage`}
            icon={FileText}
            accent="cyan"
            href="/documents"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Video messages"
            value={videos.length}
            hint={
              videos.length
                ? `Delivered on ${[...new Set(videos.map((v) => v.deliveryCondition))].length} condition${videos.length > 1 ? "s" : ""}`
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
                    <dd className="font-medium">
                      {formatRelative(dmsData?.lastCheckInAt ?? null, now)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Next check-in</dt>
                    <dd className="font-medium">
                      {dmsData?.nextCheckInAt ? formatRelative(dmsData?.nextCheckInAt, now) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Trusted contacts</dt>
                    <dd className="font-medium">{dmsData?.contacts.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Inactivity threshold</dt>
                    <dd className="font-medium">{dmsData?.inactivityPeriodDays ?? 0} days</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!canCheckIn} onClick={() => void checkIn()}>
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
                  tone={openRequests.length ? "warning" : contacts.length ? "success" : "neutral"}
                >
                  {openRequests.length
                    ? `${openRequests.length} pending`
                    : contacts.length
                      ? "Configured"
                      : "Not set"}
                </StatusBadge>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <ul className="space-y-2">
                  {contacts.map((config) => {
                    const beneficiaryName = config.beneficiaryName;
                    const request = requests.find(
                      (r) =>
                        r.configId === config.id && r.status !== "EXPIRED" && r.status !== "DENIED",
                    );
                    return (
                      <li key={config.id} className="flex items-center justify-between gap-3">
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
              label={currentPlan?.status === "DRAFT" ? "Continue Will" : "Create Will"}
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
              description="Private, checked, versioned"
              href="/documents?upload=1"
              accent="success"
            />
            <QuickAction
              icon={CheckCircle2}
              label="Check in"
              description={canCheckIn ? "Confirm you are active" : "Switch not monitoring"}
              accent="warning"
              disabled={!canCheckIn}
              onClick={() => void checkIn()}
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
            <ActivityFeed items={activityQuery.data?.items ?? []} limit={6} />
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

      <AIActivityCard now={now} />
    </div>
  );
}

const SESSION_LABEL: Record<string, string> = {
  ASSISTANT: "Assistant conversation",
  DOCUMENT_ANALYSIS: "Document analysis",
  WILL_GENERATOR: "Will draft",
};

/**
 * AI activity, from the sanitized usage records (ADR-016): when AI was used and
 * for what kind of task — never what was asked or answered, which is not stored.
 */
function AIActivityCard({ now }: { now: number }) {
  const availability = useAIAvailability();
  const interactions = useAIInteractions(5);
  const items = interactions.data?.items ?? [];
  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-brand-purple" aria-hidden />
            AI activity
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Only when AI was used is recorded — never what you asked.
          </p>
        </div>
        {availability.data &&
          (availability.data.configured ? (
            <StatusBadge tone="success">AI ready</StatusBadge>
          ) : (
            <StatusBadge tone="warning">AI not configured</StatusBadge>
          ))}
      </CardHeader>
      <CardContent>
        {interactions.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : interactions.isError ? (
          <p className="text-sm text-destructive">AI activity could not be loaded.</p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
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
      </CardContent>
    </Card>
  );
}
