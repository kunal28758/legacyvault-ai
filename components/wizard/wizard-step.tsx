"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, CloudOff, CloudUpload, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { easeOut, useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

import { useWizard, type SaveStatus } from "./wizard-provider";

function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { icon: React.ReactNode; label: string; className: string }> = {
    idle: {
      icon: <CloudUpload className="size-3.5" aria-hidden />,
      label: "Auto-save on",
      className: "text-muted-foreground",
    },
    dirty: {
      icon: <CloudUpload className="size-3.5" aria-hidden />,
      label: "Unsaved changes",
      className: "text-warning",
    },
    saving: {
      icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />,
      label: "Saving…",
      className: "text-muted-foreground",
    },
    saved: {
      icon: <Check className="size-3.5" aria-hidden />,
      label: "Saved",
      className: "text-success",
    },
    error: {
      icon: <CloudOff className="size-3.5" aria-hidden />,
      label: "Not saved",
      className: "text-destructive",
    },
  };
  const item = map[status];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", item.className)}
    >
      {item.icon}
      {item.label}
    </span>
  );
}

interface WizardStepProps {
  title: string;
  description?: React.ReactNode;
  eyebrow?: string;
  children: React.ReactNode;
  /** Hide the default Previous / Next navigation (review & confirmation supply their own). */
  hideNavigation?: boolean;
  nextLabel?: string;
}

/** Step frame (task T063): heading, save status, animated content and navigation (T061 nav). */
export function WizardStep({
  title,
  description,
  eyebrow,
  children,
  hideNavigation,
  nextLabel,
}: WizardStepProps) {
  const { currentStep, totalSteps, saveStatus, next, previous, flush, readOnly } = useWizard();
  const reduced = useReducedMotion();

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
        {!readOnly && <SaveIndicator status={saveStatus} />}
      </div>

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
          onNext={next}
          onSave={
            readOnly
              ? undefined
              : () => {
                  flush();
                  toast.success("Draft saved", {
                    description: "You can leave and come back any time.",
                  });
                }
          }
          nextLabel={nextLabel ?? (currentStep === totalSteps - 2 ? "Review plan" : "Next")}
        />
      )}
    </div>
  );
}

interface WizardNavigationProps {
  canPrevious: boolean;
  onPrevious: () => void;
  onNext?: () => void;
  onSave?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  extra?: React.ReactNode;
}

/** Previous / Save draft / Next bar, sticky at the bottom on small screens. */
export function WizardNavigation({
  canPrevious,
  onPrevious,
  onNext,
  onSave,
  nextLabel = "Next",
  nextDisabled,
  extra,
}: WizardNavigationProps) {
  return (
    <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/80 px-4 py-3 backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
      <Button variant="ghost" onClick={onPrevious} disabled={!canPrevious}>
        <ArrowLeft data-icon="inline-start" />
        Previous
      </Button>
      <div className="flex items-center gap-2">
        {extra}
        {onSave && (
          <Button variant="outline" onClick={onSave}>
            <Save data-icon="inline-start" />
            Save draft
          </Button>
        )}
        {onNext && (
          <Button onClick={onNext} disabled={nextDisabled} className="shadow-glow-blue">
            {nextLabel}
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}
