"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  FileText,
  KeyRound,
  Mail,
  ShieldAlert,
  Siren,
  TimerReset,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LegacySnapshot } from "@/lib/client/legacy-snapshot";
import type { ActivityEntry } from "@/lib/types/activity";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Who has access?" — every route by which someone other than the owner can
 * reach part of the legacy, with live counts. Read-only: each row links to the
 * page that manages it, so no access rule is changed from here.
 */
export function AccessOverview({ snapshot }: { snapshot: LegacySnapshot | null }) {
  if (!snapshot) {
    return (
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">Who has access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2" aria-hidden>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }
  const s = snapshot;
  const armed = !["INACTIVE", "PAUSED"].includes(s.dms.status);
  const rows: { icon: LucideIcon; label: string; detail: string; href: string; tone: string }[] = [
    {
      icon: Users,
      label: "Beneficiaries",
      detail: `${s.beneficiaries.active} active · ${s.beneficiaries.pending} invitation${s.beneficiaries.pending === 1 ? "" : "s"} pending`,
      href: "/beneficiaries",
      tone: s.beneficiaries.active ? "text-success" : "text-muted-foreground",
    },
    {
      icon: FileText,
      label: "Shared documents",
      detail: s.documents.shared
        ? `${pluralize(s.documents.shared, "document")} shared through scoped, revocable links`
        : "No document is shared",
      href: "/documents?filter=shared",
      tone: s.documents.shared ? "text-primary" : "text-muted-foreground",
    },
    {
      icon: KeyRound,
      label: "Access links",
      detail: "Issued per beneficiary — hash-only, expiring, revocable",
      href: "/beneficiaries",
      tone: "text-primary",
    },
    {
      icon: Siren,
      label: "Emergency access",
      detail: s.emergency.openRequests.length
        ? `${pluralize(s.emergency.openRequests.length, "request")} waiting for your decision`
        : s.emergency.contacts
          ? `${pluralize(s.emergency.contacts, "contact")} can request verified access`
          : "Nobody can request emergency access",
      href: "/emergency-access",
      tone: s.emergency.openRequests.length ? "text-warning" : "text-muted-foreground",
    },
    {
      icon: TimerReset,
      label: "Dead Man’s Switch release",
      detail: armed
        ? `${pluralize(s.dms.trustedContacts, "trusted contact")} · ${pluralize(s.dms.releaseScopeSize, "item")} in the release scope`
        : "Not monitoring — nothing will be released",
      href: "/dead-man-switch",
      tone: armed ? "text-success" : "text-muted-foreground",
    },
  ];
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">Who has access</CardTitle>
        <p className="text-sm text-muted-foreground">
          Every way someone else can reach part of your legacy. Access is always scoped to what you
          chose.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60">
          {rows.map((row) => (
            <li key={row.label}>
              <Link
                href={row.href}
                className="group flex items-center gap-3 rounded-lg py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className={cn("icon-tile size-8", row.tone)}>
                  <row.icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * How the owner signs in and recovers access, read live from Clerk (the
 * identity provider). Only facts Clerk reports are shown.
 */
export function AuthenticationCard({
  recoveryEmail,
  events,
}: {
  recoveryEmail: boolean;
  events: ActivityEntry[];
}) {
  const { user, isLoaded } = useUser();
  const failed = events.filter((entry) => entry.outcome !== "SUCCESS");
  const rows: { label: string; on: boolean | null; detail: string }[] = [
    {
      label: "Email verification code",
      on: Boolean(user?.primaryEmailAddress),
      detail: user?.primaryEmailAddress?.emailAddress ?? "—",
    },
    {
      label: "Password",
      on: user ? user.passwordEnabled : null,
      detail: user?.passwordEnabled ? "Set" : "Not set",
    },
    {
      label: "Google sign-in",
      on: user ? user.externalAccounts.some((account) => account.provider === "google") : null,
      detail: user?.externalAccounts.some((account) => account.provider === "google")
        ? "Connected"
        : "Not connected",
    },
    {
      label: "Two-factor authentication",
      on: user ? user.twoFactorEnabled : null,
      detail: user?.totpEnabled ? "Authenticator app" : user?.twoFactorEnabled ? "On" : "Off",
    },
    {
      label: "Backup codes",
      on: user ? user.backupCodeEnabled : null,
      detail: user?.backupCodeEnabled ? "Generated" : "Not generated",
    },
    {
      label: "Recovery email",
      on: recoveryEmail,
      detail: recoveryEmail ? "On file" : "Not added",
    },
  ];
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">Authentication & recovery</CardTitle>
        <p className="text-sm text-muted-foreground">
          How you sign in and get back in, as reported by your identity provider.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isLoaded ? (
          <Skeleton className="h-40 w-full rounded-lg" aria-hidden />
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((row) => (
              <li key={row.label} className="flex items-center gap-2.5">
                {row.on ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
                )}
                <span className="min-w-0 flex-1">{row.label}</span>
                <span className="truncate text-xs text-muted-foreground">{row.detail}</span>
              </li>
            ))}
          </ul>
        )}
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5",
            failed.length
              ? "border-warning/30 bg-warning/10 text-warning"
              : "border-border bg-muted/30 text-muted-foreground",
          )}
        >
          {failed.length ? (
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          {failed.length
            ? `${pluralize(failed.length, "denied or failed action")} in your recent audit trail. Review them below.`
            : "No denied or failed actions in your recent audit trail. Security alerts are also emailed to you."}
        </div>
      </CardContent>
    </Card>
  );
}
