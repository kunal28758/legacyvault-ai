"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CloudOff,
  CloudUpload,
  Loader2,
  RotateCcw,
  SkipForward,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { easeOut, useReducedMotion } from "@/hooks/use-reduced-motion";
import { useNow } from "@/hooks/use-now";
import { formatRelative } from "@/lib/format";
import { PLAN_STEPS } from "@/lib/legacy-plan/steps";
import { cn } from "@/lib/utils";

import { useWizard } from "./wizard-provider";

/**
 * Save status, as the server reported it. "Saved" appears only after the
 * server confirmed every buffered edit; a failure offers a retry.
 */
function SaveIndicator() {
  const { saveStatus, lastSavedAt, saveError, flush } = useWizard();
  const now = useNow(15_000);

  const content = (() => {
    switch (saveStatus) {
      case "saving":
        return {
          icon: (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          ),
          label: "Saving…",
          className: "text-muted-foreground",
        };
      case "saved":
        return {
          icon: <Check className="size-3.5" aria-hidden />,
          label: lastSavedAt
            ? `Saved ${formatRelative(new Date(lastSavedAt).toISOString(), Math.max(now, lastSavedAt))}`
            : "Saved",
          className: "text-success",
        };
      case "dirty":
        return {
          icon: <CloudUpload className="size-3.5" aria-hidden />,
          label: "Unsaved changes",
          className: "text-warning",
        };
      case "error":
        return {
          icon: <CloudOff className="size-3.5" aria-hidden />,
          label: "Save failed",
          className: "text-destructive",
        };
      default:
        return {
          icon: <CloudUpload className="size-3.5" aria-hidden />,
          label: lastSavedAt ? "All changes saved" : "Auto-save on",
          className: "text-muted-foreground",
        };
    }
  })();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        role="status"
        aria-live="polite"
        className={cn("inline-flex items-center gap-1.5 text-xs font-medium", content.className)}
        title={saveStatus === "error" ? (saveError ?? undefined) : undefined}
      >
        {content.icon}
        {content.label}
      </span>
      {saveStatus === "error" && (
        <Button size="xs" variant="outline" onClick={() => void flush()}>
          <RotateCcw data-icon="inline-start" />
          Retry
        </Button>
      )}
    </div>
  );
}

interface WizardStepProps {
  title: string;
  description?: React.ReactNode;
  eyebrow?: string;
  children: React.ReactNode;
  /** Hide the default navigation (review & confirmation supply their own). */
  hideNavigation?: boolean;
  nextLabel?: string;
}

/** Step frame (task T063): heading, save status, animated content and navigation. */
export function WizardStep({
  title,
  description,
  eyebrow,
  children,
  hideNavigation,
  nextLabel,
}: WizardStepProps) {
  const {
    currentStep,
    totalSteps,
    previous,
    saveAndContinue,
    skipCurrent,
    canSkipCurrent,
    isSkipped,
    advancing,
    saveError,
    saveStatus,
    readOnly,
  } = useWizard();
  const reduced = useReducedMotion();
  const meta = PLAN_STEPS.find((step) => step.step === currentStep);
  const sectionKey = meta && meta.key !== "review" && meta.key !== "confirmation" ? meta.key : null;
  const skipped = sectionKey ? isSkipped(sectionKey) : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          {eyebrow && (
            <p className="text-xs font-medium tracking-wide text-brand-cyan uppercase">{eyebrow}</p>
          )}
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
          {description && (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          )}
        </div>
        {!readOnly && <SaveIndicator />}
      </div>

      {skipped && (
        <p
          role="note"
          className="flex items-center gap-2 rounded-xl border border-dashed border-warning/50 bg-warning/5 px-4 py-2.5 text-sm"
        >
          <SkipForward className="size-4 shrink-0 text-warning" aria-hidden />
          Skipped — you can complete this later. Anything you fill in here is kept.
        </p>
      )}

      {saveStatus === "error" && saveError && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive"
        >
          {saveError} Your edits are kept on this page until they save.
        </p>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: reduced ? 0 : 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduced ? 0 : -20 }}
          transition={{ duration: reduced ? 0 : 0.28, ease: easeOut }}
          className="space-y-6"
        >
          {children}
        </motion.div>
      </AnimatePresence>

      {!hideNavigation && (
        <WizardNavigation
          canPrevious={currentStep > 1}
          onPrevious={previous}
          onNext={() => void saveAndContinue()}
          onSkip={canSkipCurrent ? () => void skipCurrent() : undefined}
          busy={advancing}
          nextLabel={
            nextLabel ??
            (readOnly
              ? "Next"
              : currentStep === totalSteps - 2
                ? "Save & review"
                : "Save & continue")
          }
        />
      )}
    </div>
  );
}

interface WizardNavigationProps {
  canPrevious: boolean;
  onPrevious: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  busy?: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  extra?: React.ReactNode;
}

/** Previous / Skip for now / Save & continue, sticky at the bottom on small screens. */
export function WizardNavigation({
  canPrevious,
  onPrevious,
  onNext,
  onSkip,
  busy,
  nextLabel = "Next",
  nextDisabled,
  extra,
}: WizardNavigationProps) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/85 px-4 py-3 backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
      <Button variant="ghost" onClick={onPrevious} disabled={!canPrevious || busy}>
        <ArrowLeft data-icon="inline-start" />
        Previous
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        {extra}
        {onSkip && (
          <Button variant="outline" onClick={onSkip} disabled={busy}>
            <SkipForward data-icon="inline-start" />
            Skip for now
          </Button>
        )}
        {onNext && (
          <Button onClick={onNext} disabled={nextDisabled || busy} className="shadow-glow-blue">
            {busy ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {busy ? "Saving…" : nextLabel}
            {!busy && <ArrowRight data-icon="inline-end" />}
          </Button>
        )}
      </div>
    </div>
  );
}
