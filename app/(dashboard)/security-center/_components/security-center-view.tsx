"use client";

import Link from "next/link";
import {
  ArrowRight,
  Fingerprint,
  KeyRound,
  Lock,
  Monitor,
  ShieldCheck,
  Siren,
  Smartphone,
  TimerReset,
  FileText,
  Activity as ActivityIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ActivityFeed } from "@/components/shared/activity-feed";
import { PageHeader, SectionHeading } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { ProgressRing } from "@/components/shared/progress-card";
import { SecurityCard } from "@/components/security/security-card";
import { StaggerGrid, StaggerItem } from "@/components/shared/page-transition";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@clerk/nextjs";

import { useActivity } from "@/hooks/use-activity";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { useClerkSessions } from "@/hooks/use-clerk-sessions";
import { useDeadManSwitch } from "@/hooks/use-dead-man-switch";
import { useEmergencyAccess } from "@/hooks/use-emergency-access";
import { useLegacyPlanOverview } from "@/hooks/use-legacy-plan";
import { useNow } from "@/hooks/use-now";
import { useProfile } from "@/hooks/use-profile";
import { securityChecks, securityScore } from "@/lib/client/security-checks";
import { formatRelative } from "@/lib/format";

const icons = {
  auth: Fingerprint,
  encryption: Lock,
  documents: FileText,
  dms: TimerReset,
  ea: Siren,
  sessions: Monitor,
} as const;

/**
 * Security Centre.
 *
 * Every control is evaluated from real state — Clerk for the account factors,
 * the API for beneficiaries, the plan, the switch and emergency access — and
 * the event list is the caller's own append-only audit trail.
 */
export function SecurityCenterView() {
  const now = useNow();
  const profile = useProfile();
  const beneficiaries = useBeneficiaries();
  const plan = useLegacyPlanOverview();
  const dms = useDeadManSwitch();
  const emergency = useEmergencyAccess();
  const activity = useActivity(50);
  const clerkSessions = useClerkSessions();
  const { session } = useSession();
  const currentSessionId = session?.id ?? null;

  if (profile.isPending) return <PageSkeleton stats={0} />;

  const beneficiaryItems = beneficiaries.data?.items ?? [];
  const checks = securityChecks({
    mfaEnabled: profile.data?.mfaEnabled ?? false,
    emailVerified: profile.data?.emailVerified ?? false,
    alternateEmail: profile.data?.alternateEmail ?? null,
    beneficiaryCount: beneficiaryItems.length,
    activeBeneficiaryCount: beneficiaryItems.filter((b) => b.status !== "INACTIVE").length,
    planFinalized: (plan.data?.versions.length ?? 0) > 0,
    deadManSwitch: dms.data ?? null,
    emergencyContactCount: emergency.data?.contacts.length ?? 0,
    encryptedFieldCount: profile.data?.hasIdentificationDetails ? 1 : 0,
  });
  const score = securityScore(checks);
  const recommendations = checks.filter((c) => c.status !== "good");
  const securityEvents = (activity.data?.items ?? []).filter((entry) =>
    /^(auth|session|access|ea|dms|user)\.|credential|sensitive/.test(entry.action),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Protection"
        title="Security Center"
        description="A single view of how your account, data and release mechanisms are protected — and what would make them stronger."
        actions={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/settings?tab=security" />}
          >
            <KeyRound data-icon="inline-start" />
            Account security settings
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass-highlight glass-strong lg:col-span-1">
          <CardContent className="flex items-center gap-6 p-6">
            <ProgressRing value={score} label="Security score" />
            <div className="space-y-2">
              <p className="text-lg font-semibold">
                {score >= 80
                  ? "Strong protection"
                  : score >= 60
                    ? "Good — a few gaps"
                    : "Needs attention"}
              </p>
              <p className="text-sm text-muted-foreground">
                {recommendations.length
                  ? `${recommendations.length} recommendation${recommendations.length === 1 ? "" : "s"} below.`
                  : "Every control is in a good state."}
              </p>
              <StatusBadge tone={score >= 80 ? "success" : score >= 60 ? "warning" : "danger"}>
                {profile.data?.mfaEnabled ? "2FA on" : "2FA off"}
              </StatusBadge>
            </div>
          </CardContent>
        </Card>
        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Always on</CardTitle>
            <p className="text-sm text-muted-foreground">
              Platform guarantees that do not depend on your settings.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  icon: Lock,
                  text: "Sensitive fields encrypted with AES-256-GCM before they are stored",
                },
                {
                  icon: ShieldCheck,
                  text: "Ownership and role checked server-side on every request, with row-level security as a second barrier",
                },
                {
                  icon: KeyRound,
                  text: "Access links are stored hash-only, expire, and are exchanged once for a secure session",
                },
                {
                  icon: ActivityIcon,
                  text: "An append-only audit log records who did what, when and with which outcome",
                },
              ].map(({ icon: Icon, text }) => (
                <li
                  key={text}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  <span className="text-muted-foreground">{text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeading
          title="Controls"
          description="Each control shows its state, what it protects and the next step."
        />
        <StaggerGrid className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {checks.map((check) => (
            <StaggerItem key={check.id}>
              <SecurityCard
                check={check}
                icon={icons[check.id as keyof typeof icons] ?? ShieldCheck}
              />
            </StaggerItem>
          ))}
        </StaggerGrid>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">Active sessions</CardTitle>
            <p className="text-sm text-muted-foreground">
              Devices signed in to your account. Sessions are managed by Clerk; revocation is
              audited.
            </p>
          </CardHeader>
          <CardContent>
            {clerkSessions.loading ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Loading your devices…
              </p>
            ) : clerkSessions.sessions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No other active sessions.
              </p>
            ) : (
              <ul className="space-y-2">
                {clerkSessions.sessions.map((session) => {
                  const activityInfo = session.latestActivity;
                  const deviceLabel = activityInfo?.deviceType ?? "Unknown device";
                  const Icon = /phone|mobile|android|ios/i.test(deviceLabel) ? Smartphone : Monitor;
                  const isCurrent = session.id === currentSessionId;
                  const place = [activityInfo?.city, activityInfo?.country]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <li
                      key={session.id}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {activityInfo?.browserName ?? "Browser"} · {deviceLabel}
                          {isCurrent && (
                            <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                              This device
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {place ? `${place} · ` : ""}active{" "}
                          {formatRelative(session.lastActiveAt.toISOString(), now)}
                        </p>
                      </div>
                      {!isCurrent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await clerkSessions.revoke(session.id);
                              toast.success("Session revoked");
                            } catch {
                              toast.error("Could not revoke that session.");
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">Recommendations</CardTitle>
            <p className="text-sm text-muted-foreground">Ordered by impact.</p>
          </CardHeader>
          <CardContent>
            {recommendations.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing to recommend — keep checking in and reviewing periodically.
              </p>
            ) : (
              <ul className="space-y-2">
                {recommendations.map((rec) => (
                  <li key={rec.id}>
                    <Link
                      href={rec.href ?? "/settings"}
                      className="group flex items-center gap-3 rounded-lg border border-border p-3 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${rec.status === "risk" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"}`}
                      >
                        <ShieldCheck className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{rec.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {rec.detail}
                        </span>
                      </span>
                      <ArrowRight
                        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div id="audit" className="scroll-mt-24 space-y-4">
        <SectionHeading
          title="Recent security events"
          description="Sign-ins, re-verified reveals, access links, switch and emergency-access changes."
        />
        <Card className="glass">
          <CardContent className="p-5">
            <ActivityFeed items={securityEvents} limit={10} emptyTitle="No security events yet" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
