"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  FlaskConical,
  Gem,
  Pause,
  Play,
  Power,
  RotateCcw,
  ScrollText,
  Settings2,
  ShieldCheck,
  TimerReset,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { FormField } from "@/components/forms/form-field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader, SectionHeading } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { Timeline } from "@/components/shared/timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useDemoWorkspace, useNow } from "@/hooks/use-demo-workspace";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { DMS_STAGES, PLAN_SECTION_TITLES, dmsView } from "@/lib/demo/selectors";
import { useDemoStore } from "@/lib/demo/store";
import type { DmsEventType } from "@/lib/demo/types";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const eventTone: Record<DmsEventType, "neutral" | "success" | "warning" | "danger" | "info"> = {
  CHECK_IN: "success",
  MISSED_CHECK_IN: "warning",
  ESCALATION_STEP: "danger",
  RECOVERY: "success",
  RELEASE: "danger",
  PAUSE: "info",
  RESUME: "success",
  CONFIG_CHANGE: "neutral",
};

const eventLabel: Record<DmsEventType, string> = {
  CHECK_IN: "Checked in",
  MISSED_CHECK_IN: "Missed check-in",
  ESCALATION_STEP: "Escalation step",
  RECOVERY: "Recovered",
  RELEASE: "Release executed",
  PAUSE: "Paused",
  RESUME: "Resumed",
  CONFIG_CHANGE: "Configuration changed",
};

/** Dead Man's Switch (tasks T124/T129 — UI; guarded functions `dms_*` wired later via API). */
export function DeadManSwitchView() {
  const { workspace: ws, ready } = useDemoWorkspace();
  const checkIn = useDemoStore((s) => s.dmsCheckIn);
  const pause = useDemoStore((s) => s.dmsPause);
  const resume = useDemoStore((s) => s.dmsResume);
  const disable = useDemoStore((s) => s.dmsDisable);
  const cancelEscalation = useDemoStore((s) => s.dmsCancelEscalation);
  const simulate = useDemoStore((s) => s.dmsSimulateNextStage);
  const now = useNow(30_000);
  const reduced = useReducedMotion();

  const [configOpen, setConfigOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);

  if (!ready) return <PageSkeleton stats={0} />;

  const dms = ws.dms;
  const view = dmsView(dms.status);
  const canCheckIn = ["ACTIVE", "REMINDER_SENT", "GRACE_PERIOD"].includes(dms.status);
  const escalated = ["ESCALATING", "RELEASING", "RELEASED"].includes(dms.status);
  const monitoring = dms.status !== "INACTIVE" && dms.status !== "PAUSED";
  const contacts = dms.contactIds
    .map((id) => ws.beneficiaries.find((b) => b.id === id))
    .filter(Boolean);
  const scope = dms.releaseScope;
  const dueMs = dms.nextCheckInAt ? Date.parse(dms.nextCheckInAt) - now : null;
  const windowMs = dms.checkInFrequencyDays * 86_400_000;
  const windowPct = dueMs === null ? 0 : Math.max(0, Math.min(100, 100 - (dueMs / windowMs) * 100));

  const run = (action: () => { ok: boolean; message?: string }, success: string) => {
    const result = action();
    if (result.ok) toast.success(success);
    else toast.error(result.message);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Protection"
        title="Dead Man’s Switch"
        description="Confirms you are active on a schedule. If check-ins stop, it escalates step by step — and only at the very end releases the resources you chose to your trusted contacts."
        actions={
          <>
            <Button variant="outline" onClick={() => setConfigOpen(true)}>
              <Settings2 data-icon="inline-start" />
              {dms.status === "INACTIVE" ? "Enable" : "Configure"}
            </Button>
            <Button
              className="shadow-glow-blue"
              disabled={!canCheckIn}
              onClick={() => run(checkIn, "Check-in recorded — thank you")}
            >
              <CheckCircle2 data-icon="inline-start" />
              Check in
            </Button>
          </>
        }
      />

      {/* State machine */}
      <Card className="glass-highlight glass-strong">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-purple/15 text-brand-purple">
              <TimerReset className="size-5" aria-hidden />
            </span>
            <div>
              <CardTitle className="text-lg">Current state</CardTitle>
              <p className="text-sm text-muted-foreground">
                {dms.status === "INACTIVE"
                  ? "The switch is disabled — nothing is monitored."
                  : dms.status === "PAUSED"
                    ? "Monitoring is paused. Resume to restart the schedule."
                    : escalated
                      ? "Escalation in progress. You can recover at any stage with re-verification."
                      : "Monitoring on schedule."}
              </p>
            </div>
          </div>
          <StatusBadge
            tone={view.tone}
            pulse={view.tone === "success"}
            className="h-7 px-3 text-sm"
          >
            {view.label}
          </StatusBadge>
        </CardHeader>
        <CardContent className="space-y-6">
          <ol
            className="relative grid grid-cols-3 gap-y-6 sm:grid-cols-6 sm:gap-y-0"
            aria-label="Escalation stages"
          >
            <span
              aria-hidden
              className="absolute top-4 right-[8%] left-[8%] hidden h-0.5 bg-border sm:block"
            />
            {DMS_STAGES.map((stage, index) => {
              const state =
                view.stageIndex === -1
                  ? "off"
                  : index < view.stageIndex
                    ? "past"
                    : index === view.stageIndex
                      ? "current"
                      : "future";
              return (
                <li
                  key={stage.status}
                  className="relative flex flex-col items-center gap-2 text-center"
                >
                  <motion.span
                    layout
                    transition={reduced ? { duration: 0 } : undefined}
                    className={cn(
                      "relative z-10 flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold",
                      state === "current" &&
                        (index >= 3
                          ? "border-destructive bg-destructive/15 text-destructive shadow-[0_0_24px_-6px_var(--destructive)]"
                          : index >= 1
                            ? "border-warning bg-warning/15 text-warning"
                            : "border-success bg-success/15 text-success shadow-[0_0_24px_-6px_var(--success)]"),
                      state === "past" &&
                        "border-muted-foreground/40 bg-muted text-muted-foreground",
                      (state === "future" || state === "off") &&
                        "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {index + 1}
                  </motion.span>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      state === "current" ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {stage.label}
                  </span>
                  <span className="hidden text-[11px] leading-tight text-muted-foreground lg:block">
                    {stage.description}
                  </span>
                  {state === "current" && <span className="sr-only">(current)</span>}
                </li>
              );
            })}
          </ol>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">Last check-in</p>
              <p className="mt-1 font-medium">{formatRelative(dms.lastCheckInAt, now)}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(dms.lastCheckInAt)}</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">Next check-in</p>
              <p className="mt-1 font-medium">
                {dms.nextCheckInAt && monitoring ? formatRelative(dms.nextCheckInAt, now) : "—"}
              </p>
              {monitoring && dms.nextCheckInAt && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className={cn(
                      "h-full rounded-full",
                      windowPct > 85 ? "bg-warning" : "bg-primary",
                    )}
                    style={{ width: `${windowPct}%` }}
                  />
                </div>
              )}
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">Inactivity threshold</p>
              <p className="mt-1 font-medium">{dms.inactivityPeriodDays} days</p>
              <p className="text-xs text-muted-foreground">
                Check-in every {dms.checkInFrequencyDays} days
              </p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">Escalation</p>
              <p className="mt-1 font-medium">
                {escalated ? `Step ${dms.currentEscalationStep}` : "Not escalating"}
              </p>
              <p className="text-xs text-muted-foreground">
                {dms.escalationDelayHours} h between steps
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {dms.status === "PAUSED" ? (
              <Button variant="outline" onClick={() => run(resume, "Monitoring resumed")}>
                <Play data-icon="inline-start" />
                Resume
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={!monitoring}
                onClick={() => run(pause, "Monitoring paused")}
              >
                <Pause data-icon="inline-start" />
                Pause
              </Button>
            )}
            {(escalated || dms.status === "GRACE_PERIOD" || dms.status === "REMINDER_SENT") && (
              <Button
                variant="outline"
                className="border-warning/40 text-warning"
                onClick={() => setRecoverOpen(true)}
              >
                <RotateCcw data-icon="inline-start" />
                Cancel escalation & recover
              </Button>
            )}
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={dms.status === "INACTIVE"}
              onClick={() => setDisableOpen(true)}
            >
              <Power data-icon="inline-start" />
              Disable
            </Button>
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
            <Button
              variant="ghost"
              size="sm"
              className="text-warning"
              disabled={!monitoring || dms.status === "RELEASED"}
              onClick={() => run(simulate, "Simulated the next stage")}
            >
              <FlaskConical data-icon="inline-start" />
              Demo: simulate missed check-in
            </Button>
          </div>
          {dms.status === "RELEASED" && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              Release executed: access links for the release scope are queued for your trusted
              contacts. Recovering revokes them.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Trusted contacts</CardTitle>
              <p className="text-sm text-muted-foreground">
                Notified in order during escalation; receive release links.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setConfigOpen(true)}>
              Edit
            </Button>
          </CardHeader>
          <CardContent>
            {contacts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No trusted contacts selected.
              </p>
            ) : (
              <ol className="space-y-2">
                {contacts.map((contact, index) => (
                  <li
                    key={contact!.id}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                  >
                    <span className="flex size-7 items-center justify-center rounded-full bg-brand-purple/15 text-xs font-semibold text-brand-purple">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{contact!.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {contact!.relationship} · {contact!.email}
                      </p>
                    </div>
                    <Users className="size-4 text-muted-foreground" aria-hidden />
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">Release scope</CardTitle>
            <p className="text-sm text-muted-foreground">
              Only these resources are released — never your whole vault.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              {
                icon: FileText,
                label: "Documents",
                items: scope.documents.map(
                  (id) => ws.documents.find((d) => d.id === id)?.name ?? id,
                ),
                href: "/documents",
              },
              {
                icon: Gem,
                label: "Assets",
                items: scope.assets.map((a) => ws.assets.find((x) => x.id === a.id)?.name ?? a.id),
                href: "/assets",
              },
              {
                icon: Video,
                label: "Videos",
                items: scope.videos.map((id) => ws.videos.find((v) => v.id === id)?.title ?? id),
                href: "/video-legacy",
              },
              {
                icon: ScrollText,
                label: "Plan sections",
                items: scope.planSections.map((k) => PLAN_SECTION_TITLES[k]),
                href: "/legacy-plan",
              },
            ].map(({ icon: Icon, label, items, href }) => (
              <div
                key={label}
                className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-brand-cyan" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {label} <span className="text-muted-foreground">· {items.length}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {items.length ? items.join(", ") : "None selected"}
                  </p>
                </div>
                <Link href={href} className="text-xs text-primary hover:underline">
                  Manage
                </Link>
              </div>
            ))}
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              Videos in the scope must be marked “Immediate” or “On switch release”. Release links
              are hash-only, expire, and are revoked on recovery.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeading
          title="Activity"
          description="Every transition is recorded with its previous and new state."
        />
        <Card className="glass">
          <CardContent className="p-5">
            <Timeline
              items={dms.events.slice(0, 12).map((event) => ({
                id: event.id,
                title: eventLabel[event.eventType],
                description: `${event.previousState.replace(/_/g, " ").toLowerCase()} → ${event.newState.replace(/_/g, " ").toLowerCase()}${event.note ? ` · ${event.note}` : ""}`,
                timestamp: event.createdAt,
                tone: eventTone[event.eventType],
                icon:
                  event.eventType === "CHECK_IN"
                    ? CheckCircle2
                    : event.eventType === "MISSED_CHECK_IN"
                      ? Clock
                      : undefined,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      {/* Configure sheet */}
      <Sheet open={configOpen} onOpenChange={setConfigOpen}>
        <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-md">
          <DmsConfigForm onClose={() => setConfigOpen(false)} />
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title="Disable the Dead Man’s Switch?"
        description="Monitoring stops immediately and no release can happen until you enable it again. This is a sensitive change."
        confirmLabel="Disable switch"
        variant="destructive"
        requiresReverification
        onConfirm={() => run(disable, "Dead Man’s Switch disabled")}
      />
      <ConfirmDialog
        open={recoverOpen}
        onOpenChange={setRecoverOpen}
        title="Cancel the escalation and recover?"
        description="The switch returns to Active with a fresh check-in. Any release links already issued are revoked."
        confirmLabel="Recover now"
        requiresReverification
        onConfirm={() => run(cancelEscalation, "Escalation cancelled — switch is Active again")}
      />
    </div>
  );
}

/** Mounted with the sheet, so the form seeds from the current configuration without effects. */
function DmsConfigForm({ onClose }: { onClose: () => void }) {
  const { workspace: ws } = useDemoWorkspace();
  const configure = useDemoStore((s) => s.configureDms);
  const dms = ws.dms;
  const [form, setForm] = useState({
    inactivityPeriodDays: dms.inactivityPeriodDays,
    checkInFrequencyDays: dms.checkInFrequencyDays,
    escalationDelayHours: dms.escalationDelayHours,
    contactIds: dms.contactIds,
  });
  return (
    <>
      <SheetHeader className="pr-10">
        <SheetTitle>
          {dms.status === "INACTIVE" ? "Enable the Dead Man’s Switch" : "Configure the switch"}
        </SheetTitle>
        <SheetDescription>
          Schedule, escalation timing and who is contacted. Saving requires re-verification in the
          live application.
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4">
        <FormField
          label="Inactivity period (days)"
          hint="7–365. After this much inactivity the escalation completes."
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              min={7}
              max={365}
              value={form.inactivityPeriodDays}
              onChange={(e) => setForm({ ...form, inactivityPeriodDays: Number(e.target.value) })}
            />
          )}
        </FormField>
        <FormField
          label="Check-in frequency (days)"
          hint="1–90. How often you confirm you are active."
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              min={1}
              max={90}
              value={form.checkInFrequencyDays}
              onChange={(e) => setForm({ ...form, checkInFrequencyDays: Number(e.target.value) })}
            />
          )}
        </FormField>
        <FormField label="Escalation delay (hours)" hint="1–168 between escalation steps.">
          {(props) => (
            <Input
              {...props}
              type="number"
              min={1}
              max={168}
              value={form.escalationDelayHours}
              onChange={(e) => setForm({ ...form, escalationDelayHours: Number(e.target.value) })}
            />
          )}
        </FormField>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Trusted contacts</legend>
          <p className="text-xs text-muted-foreground">Choose at least one active beneficiary.</p>
          <ul className="space-y-2">
            {ws.beneficiaries
              .filter((b) => b.status !== "INACTIVE")
              .map((b) => (
                <li key={b.id}>
                  <Label className="flex items-center gap-3 rounded-lg border border-border p-3 font-normal">
                    <Checkbox
                      checked={form.contactIds.includes(b.id)}
                      onCheckedChange={(v) =>
                        setForm({
                          ...form,
                          contactIds: v
                            ? [...form.contactIds, b.id]
                            : form.contactIds.filter((id) => id !== b.id),
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{b.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {b.relationship} · {b.email}
                      </span>
                    </span>
                  </Label>
                </li>
              ))}
          </ul>
        </fieldset>
      </div>
      <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            const result = configure(form);
            if (!result.ok) return toast.error(result.message);
            toast.success(
              dms.status === "INACTIVE" ? "Dead Man’s Switch enabled" : "Configuration saved",
            );
            onClose();
          }}
        >
          {dms.status === "INACTIVE" ? "Enable switch" : "Save"}
        </Button>
      </SheetFooter>
    </>
  );
}
