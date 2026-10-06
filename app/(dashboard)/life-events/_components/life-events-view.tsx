"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  HeartHandshake,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLegacyState } from "@/hooks/use-legacy-snapshot";
import { useProfile, useUpdatePreferences } from "@/hooks/use-profile";
import { ApiError } from "@/lib/client/api-client";
import { lifeEventEvidence } from "@/lib/client/legacy-snapshot";
import {
  LIFE_EVENT_CATALOGUE,
  LIFE_EVENT_TYPES,
  lifeEventSteps,
  readLifeEvents,
  type LifeEventType,
  type StoredLifeEvent,
} from "@/lib/legacy-plan/life-events";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Life Events: the owner records what happened; the catalogue turns it into
 * steps. A step is ticked when real state proves it (labelled "from your
 * account") or when the owner marks it done ("marked by you"). Nothing is
 * inferred about events themselves.
 */
export function LifeEventsView() {
  const profile = useProfile();
  const update = useUpdatePreferences();
  const { state } = useLegacyState();
  const [adding, setAdding] = useState<LifeEventType | null>(null);
  const [occurredOn, setOccurredOn] = useState("");
  const [removing, setRemoving] = useState<StoredLifeEvent | null>(null);

  if (profile.isPending) return <PageSkeleton stats={0} />;

  const events = readLifeEvents(profile.data?.preferences);
  const save = async (next: StoredLifeEvent[], message: string) => {
    try {
      await update.mutateAsync({
        preferences: { ...(profile.data?.preferences ?? {}), lifeEvents: next },
      });
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save your life events.");
      throw error;
    }
  };

  const record = async () => {
    if (!adding) return;
    const event: StoredLifeEvent = {
      id: `evt-${crypto.randomUUID().slice(0, 12)}`,
      type: adding,
      occurredOn: occurredOn || null,
      recordedAt: new Date().toISOString(),
      done: [],
    };
    await save([event, ...events], `${LIFE_EVENT_CATALOGUE[adding].label} recorded`).catch(
      () => {},
    );
    setAdding(null);
    setOccurredOn("");
  };

  const toggleStep = (event: StoredLifeEvent, stepId: string) => {
    const done = event.done.includes(stepId)
      ? event.done.filter((id) => id !== stepId)
      : [...event.done, stepId];
    void save(
      events.map((entry) => (entry.id === event.id ? { ...entry, done } : entry)),
      "Progress saved",
    ).catch(() => {});
  };

  const evidence = state ? lifeEventEvidence(state.snapshot) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Legacy Planning"
        title="Life events"
        description="Big changes usually mean your legacy needs a review. Record what happened and LegacyVault turns it into concrete steps — tracked in your Action Centre."
      />

      <section aria-labelledby="record-event" className="space-y-3">
        <h2 id="record-event" className="text-lg font-semibold tracking-tight">
          Record a life event
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {LIFE_EVENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setAdding(type)}
              className="group flex surface-interactive flex-col items-start gap-1 rounded-xl p-3 text-left glass outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
                {LIFE_EVENT_CATALOGUE[type].label}
                <Plus
                  className="size-4 text-muted-foreground transition-colors group-hover:text-primary"
                  aria-hidden
                />
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {LIFE_EVENT_CATALOGUE[type].description}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="recorded-events" className="space-y-3">
        <h2 id="recorded-events" className="text-lg font-semibold tracking-tight">
          Your life events
        </h2>
        {events.length === 0 ? (
          <EmptyState
            icon={HeartHandshake}
            title="No life events recorded"
            description="When something changes — a marriage, a child, a new property — record it here to get a checklist for your legacy."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {events.map((event) => {
              const steps = evidence ? lifeEventSteps(event, evidence) : null;
              const done = steps?.filter((step) => step.complete).length ?? 0;
              return (
                <Card key={event.id} className="glass">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="font-heading text-base font-semibold">
                          {LIFE_EVENT_CATALOGUE[event.type].label}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {event.occurredOn ? `On ${formatDate(event.occurredOn)} · ` : ""}
                          Recorded {formatDate(event.recordedAt)}
                          {steps ? ` · ${done} of ${steps.length} steps done` : ""}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${LIFE_EVENT_CATALOGUE[event.type].label}`}
                        onClick={() => setRemoving(event)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {!steps ? (
                      <p className="text-sm text-muted-foreground">Checking your account…</p>
                    ) : (
                      <ul className="space-y-2">
                        {steps.map((step) => (
                          <li
                            key={step.id}
                            className="flex items-start gap-3 rounded-lg border border-border/70 bg-surface/40 p-3"
                          >
                            <button
                              type="button"
                              disabled={step.completedBy === "state" || update.isPending}
                              aria-pressed={step.complete}
                              aria-label={
                                step.completedBy === "state"
                                  ? `${step.title}: done, confirmed from your account`
                                  : step.complete
                                    ? `Mark “${step.title}” as not done`
                                    : `Mark “${step.title}” as done`
                              }
                              onClick={() => toggleStep(event, step.id)}
                              className="mt-0.5 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
                            >
                              {step.complete ? (
                                <CheckCircle2 className="size-5 text-success" aria-hidden />
                              ) : (
                                <Circle
                                  className="size-5 text-muted-foreground/60 hover:text-primary"
                                  aria-hidden
                                />
                              )}
                            </button>
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <p
                                className={cn(
                                  "text-sm font-medium",
                                  step.complete && "text-muted-foreground",
                                )}
                              >
                                {step.title}
                              </p>
                              <p className="text-xs text-muted-foreground">{step.detail}</p>
                              {step.completedBy && (
                                <p
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[11px]",
                                    step.completedBy === "state"
                                      ? "text-success"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {step.completedBy === "state" && (
                                    <ShieldCheck className="size-3" aria-hidden />
                                  )}
                                  {step.completedBy === "state"
                                    ? "Confirmed from your account"
                                    : "Marked done by you"}
                                </p>
                              )}
                            </div>
                            {!step.complete && (
                              <Link
                                href={step.href}
                                className="shrink-0 rounded-md p-1 text-primary outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50"
                                aria-label={`Go to: ${step.title}`}
                              >
                                <ArrowRight className="size-4" aria-hidden />
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Dialog open={Boolean(adding)} onOpenChange={(open) => !open && setAdding(null)}>
        <DialogContent className="glass-strong sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record: {adding ? LIFE_EVENT_CATALOGUE[adding].label : ""}</DialogTitle>
            <DialogDescription>
              {adding ? LIFE_EVENT_CATALOGUE[adding].description : ""} The steps appear in your
              Action Centre until they are done.
            </DialogDescription>
          </DialogHeader>
          <FormField label="When did it happen?" optional hint="Leave blank if you are not sure.">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="date"
                value={occurredOn}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setOccurredOn(event.target.value)}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(null)}>
              Cancel
            </Button>
            <Button loading={update.isPending} onClick={() => void record()}>
              Record event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing ? LIFE_EVENT_CATALOGUE[removing.type].label : "this event"}?`}
        description="Its steps leave your Action Centre. Nothing else in your vault changes."
        confirmLabel="Remove event"
        variant="destructive"
        onConfirm={async () => {
          if (!removing) return;
          await save(
            events.filter((entry) => entry.id !== removing.id),
            "Life event removed",
          ).catch(() => {});
        }}
      />
    </div>
  );
}
