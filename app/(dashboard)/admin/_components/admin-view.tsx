"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  HardDrive,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlock,
  UserCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { ActivityFeed } from "@/components/shared/activity-feed";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader, SectionHeading } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useAdminAnalytics,
  useAdminAudit,
  useAdminOperations,
  useAdminUser,
  useAdminUsers,
  useResendSystemAccessToken,
  useResetUserMfa,
  useSetUserRole,
  useUnlockUser,
} from "@/hooks/use-admin";
import { useNow } from "@/hooks/use-now";
import { isReverificationCancelled, useReverifiedAction } from "@/hooks/use-reverified-action";
import { ApiError } from "@/lib/api/client";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import type { AdminUserSummary } from "@/lib/types/admin";

/**
 * The operator console (FR-P001–P012).
 *
 * What an operator can see is deliberately limited to how much a user holds,
 * what state their protection is in, and what the platform is doing — never
 * what is inside anyone's vault. Every action here is re-checked and audited on
 * the server with the operator as the actor.
 */
export function AdminView() {
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const now = useNow(60_000);

  const users = useAdminUsers({ q: search.trim() || undefined });
  const analytics = useAdminAnalytics(30);
  const operations = useAdminOperations();

  if (analytics.isPending && users.isPending) return <PageSkeleton stats={4} />;

  const stats = analytics.data;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operations"
        title="Platform administration"
        description="Accounts, the audit trail, platform analytics and the operational queues. Nothing here exposes the contents of anyone's vault."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Users}
          label="Accounts"
          value={String(stats?.users.total ?? 0)}
          hint={`${stats?.users.active ?? 0} active in 30 days`}
        />
        <StatCard
          icon={ShieldCheck}
          label="Protection"
          value={String(stats?.protection.switchesActive ?? 0)}
          hint={`${stats?.protection.switchesReleased ?? 0} released · ${stats?.protection.emergencyPending ?? 0} awaiting a decision`}
        />
        <StatCard
          icon={HardDrive}
          label="Stored"
          value={formatBytes(
            (stats?.storage.documents.bytes ?? 0) + (stats?.storage.videos.bytes ?? 0),
          )}
          hint={`${stats?.storage.documents.count ?? 0} documents · ${stats?.storage.videos.count ?? 0} videos`}
        />
        <StatCard
          icon={Activity}
          label="Jobs"
          value={String(stats?.jobs.queued ?? 0)}
          hint={`${stats?.jobs.dead ?? 0} dead · ${stats?.jobs.succeededLastDay ?? 0} done today`}
          accent={stats && stats.jobs.dead > 0 ? "warning" : "neutral"}
        />
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Accounts</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <div className="relative max-w-sm">
            <Search
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-9"
              placeholder="Search by name or email"
              aria-label="Search accounts"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {(users.data?.items ?? []).length === 0 ? (
            <EmptyState
              compact
              icon={Users}
              title="No accounts match"
              description="Try a different name or email address."
            />
          ) : (
            <Card className="glass">
              <CardContent className="divide-y divide-border p-0">
                {(users.data?.items ?? []).map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setDetailId(account.id)}
                    className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{account.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{account.email}</p>
                    </div>
                    <AccountBadges account={account} />
                    <span className="w-28 text-right text-xs text-muted-foreground">
                      {account.lastLoginAt
                        ? formatRelative(account.lastLoginAt, now)
                        : "Never signed in"}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
          <p className="text-xs text-muted-foreground">
            {users.data?.total ?? 0} account{(users.data?.total ?? 0) === 1 ? "" : "s"} total.
          </p>
        </TabsContent>

        <TabsContent value="operations" className="space-y-4">
          <SectionHeading
            title="Needs attention"
            description="Jobs that exhausted their retries, and system links that were minted but never delivered."
          />
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Dead-lettered jobs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(operations.data?.deadJobs ?? []).length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Nothing has dead-lettered.
                </p>
              ) : (
                (operations.data?.deadJobs ?? []).map((job) => (
                  <div key={job.id} className="rounded-lg border border-destructive/30 px-3 py-2.5">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <AlertTriangle className="size-4 text-destructive" aria-hidden />
                      {job.type}
                      <span className="text-xs font-normal text-muted-foreground">
                        {job.attempts} attempts · {formatRelative(job.finishedAt, now)}
                      </span>
                    </p>
                    {job.lastError && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">{job.lastError}</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <UndeliveredLinks />
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <PlatformAudit />
        </TabsContent>
      </Tabs>

      <Sheet open={Boolean(detailId)} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-lg">
          {detailId && <AccountDetail id={detailId} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AccountBadges({ account }: { account: AdminUserSummary }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {account.role === "SUPER_ADMIN" && <StatusBadge tone="info">Super Admin</StatusBadge>}
      {account.deletedAt ? (
        <StatusBadge tone="neutral">Deleted</StatusBadge>
      ) : account.deletionRequestedAt ? (
        <StatusBadge tone="danger">Deletion requested</StatusBadge>
      ) : null}
      {!account.onboardingCompletedAt && <StatusBadge tone="warning">Onboarding</StatusBadge>}
      {account.mfaEnabled && <StatusBadge tone="success">MFA</StatusBadge>}
    </span>
  );
}

function AccountDetail({ id }: { id: string }) {
  const detail = useAdminUser(id);
  const setRole = useSetUserRole();
  const unlock = useUnlockUser();
  const resetMfa = useResetUserMfa();
  const reverified = useReverifiedAction();
  const now = useNow(60_000);
  const [confirm, setConfirm] = useState<"role" | "mfa" | null>(null);

  if (detail.isPending || !detail.data) {
    return (
      <div className="p-6">
        <PageSkeleton stats={0} />
      </div>
    );
  }

  const account = detail.data;
  const nextRole = account.role === "SUPER_ADMIN" ? "USER" : "SUPER_ADMIN";

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await reverified(action);
      toast.success(success);
    } catch (error) {
      if (isReverificationCancelled(error)) return;
      toast.error(error instanceof ApiError ? error.message : "That action did not complete.");
    }
  };

  return (
    <>
      <SheetHeader className="pr-10">
        <SheetTitle>{account.name}</SheetTitle>
        <SheetDescription>{account.email}</SheetDescription>
      </SheetHeader>
      <div className="space-y-6 px-4 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <AccountBadges account={account} />
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Fact label="Joined" value={formatDateTime(account.createdAt)} />
          <Fact
            label="Last sign-in"
            value={account.lastLoginAt ? formatRelative(account.lastLoginAt, now) : "Never"}
          />
          <Fact label="Email verified" value={account.emailVerified ? "Yes" : "No"} />
          <Fact
            label="Dead Man's Switch"
            value={
              account.deadManSwitch
                ? `${account.deadManSwitch.status.replace(/_/g, " ").toLowerCase()}`
                : "Not configured"
            }
          />
        </dl>

        <div className="space-y-2">
          <p className="text-sm font-medium">What this account holds</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Beneficiaries", account.counts.beneficiaries],
              ["Assets", account.counts.assets],
              ["Documents", account.counts.documents],
              ["Videos", account.counts.videos],
              ["Plans", account.counts.legacyPlans],
              ["Live links", account.counts.accessTokensLive],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-border px-2 py-3">
                <p className="text-lg font-semibold">{value}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Counts only. An operator cannot open anyone&rsquo;s plan, assets or documents.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Support actions</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={unlock.isPending}
              onClick={() => void run(() => unlock.mutateAsync(id), "Account unlocked")}
            >
              <Unlock data-icon="inline-start" />
              Unlock sign-in
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={resetMfa.isPending}
              onClick={() => setConfirm("mfa")}
            >
              <ShieldCheck data-icon="inline-start" />
              Reset two-factor
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={setRole.isPending}
              onClick={() => setConfirm("role")}
            >
              <UserCog data-icon="inline-start" />
              {nextRole === "SUPER_ADMIN" ? "Make Super Admin" : "Remove Super Admin"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Their recent activity</p>
          <ActivityFeed
            items={account.recentActivity}
            limit={10}
            emptyTitle="No recorded activity"
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "role"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={nextRole === "SUPER_ADMIN" ? "Grant Super Admin?" : "Remove Super Admin?"}
        description={
          nextRole === "SUPER_ADMIN"
            ? "They will be able to see every account, the platform audit trail and the operational queues — and to change other people's roles."
            : "They lose access to the operator console. The last Super Admin cannot be removed."
        }
        confirmLabel="Change role"
        variant={nextRole === "SUPER_ADMIN" ? "default" : "destructive"}
        requiresReverification
        onConfirm={() => run(() => setRole.mutateAsync({ id, role: nextRole }), "Role changed")}
      />

      <ConfirmDialog
        open={confirm === "mfa"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Reset two-factor authentication?"
        description="Every second factor on this account is removed and the person is emailed about it. Only do this after verifying who you are speaking to."
        confirmLabel="Reset two-factor"
        variant="destructive"
        requiresReverification
        acknowledgement="I have verified this request with the account holder."
        onConfirm={() => run(() => resetMfa.mutateAsync(id), "Two-factor reset")}
      />
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function UndeliveredLinks() {
  const operations = useAdminOperations();
  const resend = useResendSystemAccessToken();
  const reverified = useReverifiedAction();
  const now = useNow(60_000);
  const tokens = operations.data?.undeliveredTokens ?? [];

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">Undelivered access links</CardTitle>
        <p className="text-sm text-muted-foreground">
          A resend revokes the undelivered link and mints exactly one replacement — the original
          secret was never stored.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {tokens.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Every system link has been delivered.
          </p>
        ) : (
          tokens.map((token) => (
            <div
              key={token.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="size-4 text-brand-cyan" aria-hidden />
                  {token.grantType.replace(/_/g, " ").toLowerCase()}
                </p>
                <p className="text-xs text-muted-foreground">
                  Minted {formatRelative(token.createdAt, now)} · expires{" "}
                  {formatRelative(token.expiresAt, now)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={resend.isPending}
                onClick={() => {
                  void (async () => {
                    try {
                      await reverified(() => resend.mutateAsync(token.id));
                      toast.success("A replacement link is queued");
                    } catch (error) {
                      if (isReverificationCancelled(error)) return;
                      toast.error(
                        error instanceof ApiError ? error.message : "Could not queue that resend.",
                      );
                    }
                  })();
                }}
              >
                <RefreshCw data-icon="inline-start" />
                Resend
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

const AUDIT_FILTERS = [
  { label: "Everything", value: "" },
  { label: "Access", value: "access." },
  { label: "Switch", value: "dms." },
  { label: "Emergency", value: "ea." },
  { label: "Admin", value: "admin." },
  { label: "Auth", value: "auth." },
];

function PlatformAudit() {
  const [action, setAction] = useState("");
  const [deniedOnly, setDeniedOnly] = useState(false);
  const audit = useAdminAudit({
    action: action || undefined,
    outcome: deniedOnly ? "DENIED" : undefined,
  });

  return (
    <>
      <SectionHeading
        title="Platform audit trail"
        description="Append-only. Metadata was redacted when it was written, so nothing sensitive is stored here to begin with."
      />
      <div className="flex flex-wrap gap-2">
        {AUDIT_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={action === filter.value ? "default" : "outline"}
            onClick={() => setAction(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={deniedOnly ? "destructive" : "outline"}
          onClick={() => setDeniedOnly((previous) => !previous)}
        >
          Refusals only
        </Button>
      </div>
      <Card className="glass">
        <CardContent className="p-5">
          <ActivityFeed
            items={audit.data?.items ?? []}
            limit={40}
            emptyTitle="Nothing matches that filter"
          />
        </CardContent>
      </Card>
    </>
  );
}
