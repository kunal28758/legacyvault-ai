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
import { SecurityCard } from "@/components/shared/security-card";
import { StaggerGrid, StaggerItem } from "@/components/shared/page-transition";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDemoWorkspace, useNow } from "@/hooks/use-demo-workspace";
import { securityChecks, securityScore } from "@/lib/demo/selectors";
import { useDemoStore } from "@/lib/demo/store";
import { formatRelative } from "@/lib/format";

const icons = {
  auth: Fingerprint,
  encryption: Lock,
  documents: FileText,
  dms: TimerReset,
  ea: Siren,
  sessions: Monitor,
} as const;

/** Security Center (task T118 — UI; Clerk Backend API session data pending T113/T115). */
export function SecurityCenterView() {
  const { workspace: ws, ready } = useDemoWorkspace();
  const revokeSession = useDemoStore((s) => s.revokeSession);
  const now = useNow();
  if (!ready) return <PageSkeleton stats={0} />;

  const score = securityScore(ws);
  const checks = securityChecks(ws);
  const recommendations = checks.filter((c) => c.status !== "good");
  const securityEvents = ws.activity.filter((a) =>
    /^(auth|session|access|ea|dms)\.|credential/.test(a.action),
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
                {ws.security.mfaEnabled ? "2FA on" : "2FA off"}
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
            <ul className="space-y-2">
              {ws.security.sessions.map((session) => {
                const Icon = /phone|iphone|android/i.test(session.device) ? Smartphone : Monitor;
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
                        {session.browser} · {session.device}
                        {session.current && (
                          <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                            This device
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {session.location} · active {formatRelative(session.lastActiveAt, now)}
                      </p>
                    </div>
                    {!session.current && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const result = revokeSession(session.id);
                          if (result.ok) toast.success("Session revoked");
                          else toast.error(result.message);
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
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
