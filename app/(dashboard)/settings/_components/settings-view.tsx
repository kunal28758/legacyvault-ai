"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useClerk, useUser } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import {
  AlertTriangle,
  Bell,
  Download,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  Smartphone,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClerkSessions } from "@/hooks/use-clerk-sessions";
import { useNow } from "@/hooks/use-now";
import {
  useCancelAccountDeletion,
  useExportMyData,
  useProfile,
  useRefreshProfile,
  useRequestAccountDeletion,
  useUpdatePreferences,
  useUpdateProfile,
} from "@/hooks/use-profile";
import { isReverificationCancelled, useReverifiedAction } from "@/hooks/use-reverified-action";
import { ApiError } from "@/lib/client/api-client";

/**
 * Preference defaults.
 *
 * `users.preferences` and friends are free-form JSON, so the view reads through
 * these rather than assuming a shape that an older row may not have.
 */
const DEFAULT_PREFERENCES = {
  currency: "INR",
  dateFormat: "DD MMM YYYY",
  compactSidebar: false,
} as const;

const DEFAULT_NOTIFICATIONS = {
  email: true,
  securityAlerts: true,
  checkInReminders: true,
  productUpdates: false,
} as const;

const DEFAULT_SECURITY = {
  idleTimeoutMinutes: 30 as number | null,
  loginNotifications: true,
  securityReviewReminder: true,
} as const;
import { formatRelative, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface SettingsUser {
  name: string;
  email: string | null;
  imageUrl: string | null;
}

const TABS = ["profile", "preferences", "notifications", "security", "account"] as const;
type Tab = (typeof TABS)[number];

/**
 * Settings (tasks T056/T184/T189). Profile, preferences, notifications, data
 * export/deletion and session controls are API-backed; password and two-factor
 * authentication open Clerk's own account portal, which owns enrolment and
 * verification, and the MFA state shown is Clerk's live value.
 */
export function SettingsView({
  user,
  clerkEnabled,
}: {
  user: SettingsUser;
  clerkEnabled: boolean;
}) {
  const profile = useProfile();
  const updatePreferencesMutation = useUpdatePreferences();
  const clerkSessions = useClerkSessions();
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = useNow();
  const requested = searchParams.get("tab");
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "profile";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const exportMyData = useExportMyData();
  const requestDeletion = useRequestAccountDeletion();
  const cancelDeletion = useCancelAccountDeletion();
  const reverified = useReverifiedAction();
  const [exporting, setExporting] = useState(false);

  // Clerk owns two-factor enrolment; this reads its live, authoritative state
  // and opens its own UI for changes. The mirror the dashboard/security score
  // read is re-synced below when Clerk's state moves ahead of it.
  const { user: clerkUser } = useUser();
  const clerk = useClerk();
  const { mutate: syncMirror } = useRefreshProfile();
  const liveMfaEnabled = clerkUser?.twoFactorEnabled ?? profile.data?.mfaEnabled ?? false;
  const syncedMfaRef = useRef<boolean | null>(null);

  const mirroredMfa = profile.data?.mfaEnabled;
  const clerkMfa = clerkUser?.twoFactorEnabled;
  useEffect(() => {
    if (clerkMfa === undefined || mirroredMfa === undefined) return;
    if (clerkMfa === mirroredMfa) return;
    // One sync attempt per target value, so a transient Clerk failure cannot
    // spin the effect.
    if (syncedMfaRef.current === clerkMfa) return;
    syncedMfaRef.current = clerkMfa;
    syncMirror();
  }, [clerkMfa, mirroredMfa, syncMirror]);

  if (profile.isPending) return <PageSkeleton stats={0} />;

  const prefs = {
    ...DEFAULT_PREFERENCES,
    ...(profile.data?.preferences ?? {}),
    notificationPreferences: {
      ...DEFAULT_NOTIFICATIONS,
      ...(profile.data?.notificationPreferences ?? {}),
    },
    securityPreferences: {
      ...DEFAULT_SECURITY,
      ...(profile.data?.securityPreferences ?? {}),
    },
  } as {
    currency: string;
    dateFormat: string;
    compactSidebar: boolean;
    notificationPreferences: Record<string, boolean>;
    securityPreferences: {
      idleTimeoutMinutes: number | null;
      loginNotifications: boolean;
      securityReviewReminder: boolean;
    };
  };

  /** Merges a patch into the three preference objects and saves it. */
  const updatePreferences = (patch: Record<string, unknown>) => {
    const { notificationPreferences, securityPreferences, ...rest } = patch;
    void (async () => {
      try {
        await updatePreferencesMutation.mutateAsync({
          ...(Object.keys(rest).length > 0
            ? {
                preferences: {
                  // Keep every stored key (e.g. recorded life events), then apply the edit.
                  ...(profile.data?.preferences ?? {}),
                  currency: prefs.currency,
                  dateFormat: prefs.dateFormat,
                  compactSidebar: prefs.compactSidebar,
                  ...rest,
                },
              }
            : {}),
          ...(notificationPreferences
            ? { notificationPreferences: notificationPreferences as Record<string, unknown> }
            : {}),
          ...(securityPreferences
            ? { securityPreferences: securityPreferences as Record<string, unknown> }
            : {}),
        });
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Could not save that preference.");
      }
    })();
  };
  // The view only renders after hydration, so next-themes has resolved by now.
  const isDark = resolvedTheme !== "light";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Your profile, preferences, notifications, account security and data controls."
      />

      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(`/settings?tab=${v}`)}
        className="gap-6"
      >
        <TabsList className="h-auto w-full flex-wrap justify-start glass sm:w-fit">
          <TabsTrigger value="profile" className="h-9 px-3">
            <UserRound /> Profile
          </TabsTrigger>
          <TabsTrigger value="preferences" className="h-9 px-3">
            <Palette /> Preferences
          </TabsTrigger>
          <TabsTrigger value="notifications" className="h-9 px-3">
            <Bell /> Notifications
          </TabsTrigger>
          <TabsTrigger value="security" className="h-9 px-3">
            <Fingerprint /> Security
          </TabsTrigger>
          <TabsTrigger value="account" className="h-9 px-3">
            <KeyRound /> Account
          </TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile" className="space-y-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Identity</CardTitle>
              <CardDescription>
                Name, email and avatar are managed by your sign-in provider and mirrored here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Avatar size="lg" className="size-16">
                {user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
                <AvatarFallback className="bg-gradient-brand text-lg text-primary-foreground">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-lg font-semibold">{user.name}</p>
                <p className="text-sm text-muted-foreground">{user.email ?? "No email on file"}</p>
              </div>
              <Button
                variant="outline"
                disabled={!clerkEnabled}
                onClick={() => void clerk.openUserProfile()}
              >
                <ExternalLink data-icon="inline-start" />
                Manage with Clerk
              </Button>
            </CardContent>
          </Card>
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Personal details</CardTitle>
              <CardDescription>
                Used in your legacy plan and for account recovery. Identity document numbers are
                stored encrypted and set from the plan wizard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Preferences */}
        <TabsContent value="preferences" className="space-y-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Appearance</CardTitle>
              <CardDescription>LegacyVault is dark-first; light mode is available.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Theme">
                {[
                  { value: "dark", label: "Dark", icon: Moon, active: isDark },
                  { value: "light", label: "Light", icon: Sun, active: !isDark },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={option.active}
                    onClick={() => setTheme(option.value)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      option.active
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-10 items-center justify-center rounded-lg",
                        option.value === "dark"
                          ? "bg-[oklch(0.159_0.03_260.6)] text-primary"
                          : "bg-[oklch(0.985_0.005_260)] text-[oklch(0.55_0.19_258)]",
                      )}
                    >
                      <option.icon className="size-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {option.value === "dark"
                          ? "Default · glassmorphism on deep navy"
                          : "Bright surfaces, same accents"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Interface</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 font-normal">
                <span>
                  <span className="block text-sm font-medium">Compact sidebar</span>
                  <span className="block text-xs text-muted-foreground">
                    Show icons only on large screens
                  </span>
                </span>
                <Switch
                  checked={prefs.compactSidebar}
                  onCheckedChange={(v) => updatePreferences({ compactSidebar: Boolean(v) })}
                />
              </Label>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Currency">
                  {(props) => (
                    <Select
                      value={prefs.currency}
                      onValueChange={(v) => updatePreferences({ currency: String(v ?? "INR") })}
                      items={["INR", "USD", "EUR", "GBP"].map((c) => ({ value: c, label: c }))}
                    >
                      <SelectTrigger id={props.id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["INR", "USD", "EUR", "GBP"].map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                <FormField label="Date format">
                  {(props) => (
                    <Select
                      value={prefs.dateFormat}
                      onValueChange={(v) =>
                        updatePreferences({ dateFormat: v as typeof prefs.dateFormat })
                      }
                      items={["DD MMM YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((c) => ({
                        value: c,
                        label: c,
                      }))}
                    >
                      <SelectTrigger id={props.id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["DD MMM YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Notification channels</CardTitle>
              <CardDescription>
                Security alerts cannot be fully disabled — you will always be told about new
                sign-ins and emergency requests.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  key: "email",
                  label: "Email notifications",
                  description: "Receive notifications by email as well as in the app",
                },
                {
                  key: "securityAlerts",
                  label: "Security alerts",
                  description: "New device sign-ins, failed attempts, revoked sessions",
                  locked: true,
                },
                {
                  key: "checkInReminders",
                  label: "Check-in reminders",
                  description: "Dead Man’s Switch reminders before the window closes",
                },
                {
                  key: "productUpdates",
                  label: "Product updates",
                  description: "Occasional news about new capabilities",
                },
              ].map((item) => (
                <Label
                  key={item.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 font-normal"
                >
                  <span>
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  <Switch
                    checked={
                      prefs.notificationPreferences[
                        item.key as keyof typeof prefs.notificationPreferences
                      ]
                    }
                    disabled={item.locked}
                    onCheckedChange={(v) =>
                      updatePreferences({
                        notificationPreferences: {
                          ...prefs.notificationPreferences,
                          [item.key]: Boolean(v),
                        },
                      })
                    }
                  />
                </Label>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="space-y-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Authentication</CardTitle>
              <CardDescription>
                Password, two-factor authentication and backup codes are managed by Clerk with
                re-verification.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Two-factor authentication</p>
                  <p className="text-xs text-muted-foreground">
                    Authenticator app (TOTP) with one-time backup codes
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={liveMfaEnabled ? "success" : "warning"}>
                    {liveMfaEnabled ? "Enabled" : "Off"}
                  </StatusBadge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!clerkEnabled}
                    onClick={() => void clerk.openUserProfile()}
                  >
                    {liveMfaEnabled ? "Manage" : "Enable"}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Password</p>
                  <p className="text-xs text-muted-foreground">
                    Minimum 12 characters; other sessions are signed out on reset
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!clerkEnabled}
                  onClick={() => void clerk.openUserProfile()}
                >
                  Change
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Session behaviour</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                label="Sign me out after inactivity"
                hint="Enforced in the app; the platform session itself lasts at most 24 hours."
              >
                {(props) => (
                  <Select
                    value={String(prefs.securityPreferences.idleTimeoutMinutes ?? "off")}
                    onValueChange={(v) =>
                      updatePreferences({
                        securityPreferences: {
                          ...prefs.securityPreferences,
                          idleTimeoutMinutes: v === "off" ? null : Number(v),
                        },
                      })
                    }
                    items={[
                      { value: "15", label: "15 minutes" },
                      { value: "30", label: "30 minutes" },
                      { value: "60", label: "1 hour" },
                      { value: "240", label: "4 hours" },
                      { value: "off", label: "Off" },
                    ]}
                  >
                    <SelectTrigger id={props.id} className="w-full sm:w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        { value: "15", label: "15 minutes" },
                        { value: "30", label: "30 minutes" },
                        { value: "60", label: "1 hour" },
                        { value: "240", label: "4 hours" },
                        { value: "off", label: "Off" },
                      ].map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <Label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 font-normal">
                <span>
                  <span className="block text-sm font-medium">New sign-in notifications</span>
                  <span className="block text-xs text-muted-foreground">
                    Email me when a new device or location signs in
                  </span>
                </span>
                <Switch
                  checked={prefs.securityPreferences.loginNotifications}
                  onCheckedChange={(v) =>
                    updatePreferences({
                      securityPreferences: {
                        ...prefs.securityPreferences,
                        loginNotifications: Boolean(v),
                      },
                    })
                  }
                />
              </Label>
            </CardContent>
          </Card>
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Active sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {clerkSessions.sessions.map((session) => {
                  const info = session.latestActivity;
                  const deviceLabel = info?.deviceType ?? "Unknown device";
                  const Icon = /phone|mobile|android|ios/i.test(deviceLabel) ? Smartphone : Monitor;
                  const place = [info?.city, info?.country].filter(Boolean).join(", ");
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
                          {info?.browserName ?? "Browser"} · {deviceLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {place ? `${place} · ` : ""}active{" "}
                          {formatRelative(session.lastActiveAt.toISOString(), now)}
                        </p>
                      </div>
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
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Account */}
        <TabsContent value="account" className="space-y-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Your data</CardTitle>
              <CardDescription>
                Export everything you have stored — profile, beneficiaries, assets, document
                metadata, plans and your own audit rows — as JSON after re-verification.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                disabled={exporting}
                onClick={() => {
                  void (async () => {
                    setExporting(true);
                    try {
                      // Straight from the response to a download: the payload
                      // holds decrypted fields and is never cached or stored.
                      const payload = await reverified(exportMyData);
                      downloadJson(payload, `legacyvault-export-${todayStamp()}.json`);
                      toast.success("Your export has been downloaded");
                    } catch (error) {
                      if (!isReverificationCancelled(error)) {
                        toast.error(
                          error instanceof ApiError
                            ? error.message
                            : "Could not prepare your export.",
                        );
                      }
                    } finally {
                      setExporting(false);
                    }
                  })();
                }}
              >
                <Download data-icon="inline-start" />
                {exporting ? "Preparing…" : "Export my data"}
              </Button>
            </CardContent>
          </Card>
          <Card className="border-destructive/30 glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <AlertTriangle className="size-4" aria-hidden /> Delete account
              </CardTitle>
              <CardDescription>
                Deletion starts a 30-day grace period: sessions are revoked, the Dead Man’s Switch
                is paused and access links are revoked. You can cancel during the grace period.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {profile.data?.deletionRequestedAt ? (
                <>
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                    Deletion was requested {formatRelative(profile.data.deletionRequestedAt, now)}.
                    Everything is deleted 30 days after that, and the account is read-only until you
                    cancel.
                  </p>
                  <Button
                    variant="outline"
                    disabled={cancelDeletion.isPending}
                    onClick={() => {
                      void (async () => {
                        try {
                          await cancelDeletion.mutateAsync();
                          toast.success("Deletion cancelled — your account is active again");
                        } catch (error) {
                          toast.error(
                            error instanceof ApiError
                              ? error.message
                              : "Could not cancel the deletion.",
                          );
                        }
                      })();
                    }}
                  >
                    Cancel deletion
                  </Button>
                </>
              ) : (
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 data-icon="inline-start" />
                  Request account deletion
                </Button>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Looking for the legal notice? LegacyVault AI provides secure organization and
            informational assistance, not legal advice. See the{" "}
            <Link href="/" className="underline">
              product overview
            </Link>
            .
          </p>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Request account deletion?"
        description="Your account enters a 30-day grace period after which everything is permanently deleted. Audit records are retained as required."
        confirmLabel="Request deletion"
        variant="destructive"
        requiresReverification
        acknowledgement="I understand my legacy plan, assets, documents and beneficiary access will be deleted after 30 days."
        onConfirm={async () => {
          try {
            await reverified(() => requestDeletion.mutateAsync());
            toast.success("Deletion requested — you have 30 days to change your mind");
          } catch (error) {
            if (isReverificationCancelled(error)) return;
            toast.error(error instanceof ApiError ? error.message : "Could not request deletion.");
          }
        }}
      />
    </div>
  );
}

/**
 * The app-owned half of the profile.
 *
 * Name, email and password belong to Clerk and are changed there (FR-B007);
 * these are the columns `PATCH /users/me` may write.
 */
function ProfileForm() {
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const saved = profileQuery.data;
  const address = (saved?.address ?? {}) as { city?: string; country?: string };
  const [profile, setProfile] = useState({
    phone: saved?.phone ?? "",
    alternateEmail: saved?.alternateEmail ?? "",
    dateOfBirth: saved?.dateOfBirth ?? "",
    city: address.city ?? "",
    country: address.country ?? "",
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void (async () => {
          try {
            await updateProfile.mutateAsync({
              phone: profile.phone || null,
              alternateEmail: profile.alternateEmail || null,
              dateOfBirth: profile.dateOfBirth || null,
            });
            toast.success("Profile saved");
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "Could not save your profile.");
          }
        })();
      }}
    >
      <FormField label="Phone" optional>
        {(props) => (
          <Input
            {...props}
            type="tel"
            value={profile.phone}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
          />
        )}
      </FormField>
      <FormField label="Alternate email" optional hint="Used for recovery notices only.">
        {(props) => (
          <Input
            {...props}
            type="email"
            value={profile.alternateEmail}
            onChange={(e) => setProfile({ ...profile, alternateEmail: e.target.value })}
          />
        )}
      </FormField>
      <FormField label="Date of birth">
        {(props) => (
          <Input
            {...props}
            type="date"
            value={profile.dateOfBirth}
            onChange={(e) => setProfile({ ...profile, dateOfBirth: e.target.value })}
          />
        )}
      </FormField>
      <FormField label="City">
        {(props) => (
          <Input
            {...props}
            value={profile.city}
            onChange={(e) => setProfile({ ...profile, city: e.target.value })}
          />
        )}
      </FormField>
      <FormField label="Country">
        {(props) => (
          <Input
            {...props}
            value={profile.country}
            onChange={(e) => setProfile({ ...profile, country: e.target.value })}
          />
        )}
      </FormField>
      <div className="flex items-end sm:justify-end">
        <Button type="submit">Save profile</Button>
      </div>
    </form>
  );
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Hands a payload to the browser as a file.
 *
 * The object URL is revoked immediately afterwards so the export — which holds
 * decrypted values — does not stay reachable from the page.
 */
function downloadJson(payload: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
