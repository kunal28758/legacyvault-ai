"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Download,
  FileCheck2,
  Pencil,
  Share2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { WizardNavigation, WizardStep } from "@/components/wizard/wizard-step";
import { useWizard } from "@/components/wizard/wizard-provider";
import { usePlanReview } from "@/hooks/use-legacy-plan";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PLAN_STEPS } from "@/lib/legacy-plan/steps";
import { stepForSection } from "@/lib/legacy-plan/steps";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/* Step 10 — review (T069 / T103) */
export function ReviewStep() {
  const { completeness, goTo, previous, finalize, plan, unassignedAssetCount, readOnly, busy } =
    useWizard();
  // The server recomputes completeness from the persisted records; that verdict,
  // not the local one, is what finalization will act on. The local computation
  // keeps the list rendered while the request is in flight.
  const review = usePlanReview(plan.status === "DRAFT" ? plan.id : null);
  const [open, setOpen] = useState(false);

  const sections = Object.values(review.data?.sections ?? completeness.sections);
  const incomplete = review.data?.incompleteSections ?? completeness.incompleteSections;
  const personalMissing = !(
    review.data?.personalDetailsComplete ?? completeness.sections["personal-details"].complete
  );
  const optionalIncomplete = incomplete.filter((k) => k !== "personal-details");
  const unassignedInPlan = review.data?.unassignedAssetCount ?? unassignedAssetCount;
  const percent = review.data?.percent ?? completeness.percent;

  const handleFinalize = async () => {
    // The wizard flushes pending edits, re-checks completeness server-side and
    // only then calls finalize_legacy_plan(); any refusal is surfaced by it.
    if (await finalize(optionalIncomplete.length > 0)) {
      toast.success(`Legacy plan v${plan.version} finalized`, {
        description: "Previous versions stay available in the history.",
      });
    }
  };

  return (
    <WizardStep
      eyebrow="Step 10"
      title="Review your plan"
      description="Check every section before you finalize. Personal details are required; any other incomplete section can be acknowledged and completed in a later version."
      hideNavigation
    >
      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <ul className="space-y-2">
          {sections.map((section) => (
            <li
              key={section.key}
              className="flex items-center gap-3 rounded-xl border border-border p-3"
            >
              {section.complete ? (
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
              ) : (
                <CircleDashed
                  className={cn(
                    "size-5 shrink-0",
                    section.required ? "text-destructive" : "text-warning",
                  )}
                  aria-hidden
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {section.title}
                  {section.required && (
                    <span className="ml-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                      Required
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">{section.summary}</p>
              </div>
              <span className="sr-only">{section.complete ? "complete" : "incomplete"}</span>
              {!readOnly && (
                <Button variant="ghost" size="sm" onClick={() => goTo(stepForSection(section.key))}>
                  <Pencil data-icon="inline-start" />
                  Edit
                </Button>
              )}
            </li>
          ))}
        </ul>

        <div className="space-y-4">
          <Card className="glass">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Completeness</p>
                <span className="text-2xl font-semibold tabular-nums">{percent}%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {sections.length - incomplete.length} of {sections.length} sections complete
              </p>
              {unassignedInPlan > 0 && (
                <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {unassignedInPlan} asset{unassignedInPlan > 1 ? "s" : ""} have no beneficiary
                  assignment yet.
                </p>
              )}
            </CardContent>
          </Card>

          {personalMissing ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Personal details are required</AlertTitle>
              <AlertDescription>
                Complete step 1 before finalizing. This section cannot be acknowledged away.
              </AlertDescription>
            </Alert>
          ) : optionalIncomplete.length > 0 ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle>
                {optionalIncomplete.length} incomplete section
                {optionalIncomplete.length > 1 ? "s" : ""}
              </AlertTitle>
              <AlertDescription>
                You can finalize now and acknowledge them; they are recorded in the version
                snapshot.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>Everything is in place</AlertTitle>
              <AlertDescription>
                Finalizing creates version {plan.version} and keeps it read-only.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      <WizardNavigation
        canPrevious
        onPrevious={previous}
        extra={
          !readOnly && (
            <Button
              className="shadow-glow-blue"
              disabled={personalMissing || busy || review.isPending}
              onClick={() => setOpen(true)}
            >
              <FileCheck2 data-icon="inline-start" />
              Finalize plan
            </Button>
          )
        }
      />

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Finalize legacy plan v${plan.version}?`}
        description="Finalization creates a read-only version snapshot. You can start a new draft from it at any time. It does not by itself make the document legally valid — review with a qualified professional."
        confirmLabel="Finalize plan"
        requiresReverification
        acknowledgement={
          optionalIncomplete.length > 0
            ? `I acknowledge that ${optionalIncomplete.map((k) => (review.data?.sections ?? completeness.sections)[k].title).join(", ")} ${optionalIncomplete.length > 1 ? "are" : "is"} incomplete.`
            : undefined
        }
        onConfirm={handleFinalize}
      >
        {optionalIncomplete.length > 0 && (
          <ul className="space-y-1 text-sm">
            {optionalIncomplete.map((key) => (
              <li key={key} className="flex items-center gap-2 text-muted-foreground">
                <CircleDashed className="size-3.5 text-warning" aria-hidden />
                {(review.data?.sections ?? completeness.sections)[key].title}
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </WizardStep>
  );
}

/* Step 11 — confirmation (T224) */
export function ConfirmationStep() {
  const { plan, versions, createNewDraft, goTo, busy } = useWizard();
  const latest = versions[0];
  const finalized = plan.status === "FINALIZED";

  if (!finalized) {
    return (
      <WizardStep
        eyebrow="Step 11"
        title="Confirmation"
        description="This step becomes available after you finalize the plan in the review step."
        hideNavigation
      >
        <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-border p-6">
          <StatusBadge tone="info">Draft in progress</StatusBadge>
          <p className="text-sm text-muted-foreground">
            Your plan is still a draft. Return to the review step to finalize it.
          </p>
          <Button variant="outline" onClick={() => goTo(10)}>
            Back to review
          </Button>
        </div>
      </WizardStep>
    );
  }

  return (
    <WizardStep
      eyebrow="Step 11"
      title="Plan finalized"
      description="Your legacy plan is now a read-only version. Keep it current by creating a new draft whenever something changes."
      hideNavigation
    >
      <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
        <Card className="glass-highlight glass-strong">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-success/15 text-success">
                <CheckCircle2 className="size-6" aria-hidden />
              </span>
              <div>
                <p className="text-lg font-semibold">Legacy plan · version {plan.version}</p>
                <p className="text-sm text-muted-foreground">
                  Finalized {formatDateTime(plan.finalizedAt)}
                </p>
              </div>
              <StatusBadge tone="success" className="ml-auto">
                Finalized
              </StatusBadge>
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Sections complete</dt>
                <dd className="font-medium">{9 - (latest?.incompleteSections.length ?? 0)} of 9</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Acknowledged incomplete</dt>
                <dd className="font-medium">
                  {latest?.acknowledgedIncomplete ? latest.incompleteSections.length : "None"}
                </dd>
              </div>
            </dl>
            {latest?.incompleteSections.length ? (
              <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                Acknowledged as incomplete:{" "}
                {latest.incompleteSections
                  .map((k) => PLAN_STEPS.find((s) => s.key === k)?.title)
                  .join(", ")}
                .
              </p>
            ) : null}
            <p className="text-xs leading-5 text-muted-foreground">
              Finalization records your explicit confirmation and preserves this version. It is not
              a substitute for legal counsel and does not guarantee legal validity.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <p className="text-sm font-medium">What’s next</p>
          <Button
            variant="outline"
            className="w-full justify-start"
            nativeButton={false}
            render={<Link href="/legacy-plan" />}
          >
            <Download data-icon="inline-start" />
            View version history & export
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            nativeButton={false}
            render={<Link href="/beneficiaries" />}
          >
            <Share2 data-icon="inline-start" />
            Share with beneficiaries
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            nativeButton={false}
            render={<Link href="/ai" />}
          >
            <Sparkles data-icon="inline-start" />
            Ask AI to review the plan
          </Button>
          <Button
            className="w-full justify-start shadow-glow-blue"
            disabled={busy}
            onClick={async () => {
              if (await createNewDraft())
                toast.success(`Draft v${plan.version + 1} created from the finalized plan`);
            }}
          >
            <ArrowRight data-icon="inline-start" />
            Create a new draft (v{plan.version + 1})
          </Button>
        </div>
      </div>
    </WizardStep>
  );
}
