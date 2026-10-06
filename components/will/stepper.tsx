"use client";

import { Check, Lock, SkipForward } from "lucide-react";
import { motion } from "framer-motion";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

export interface StepperStep {
  step: number;
  title: string;
  description?: string;
  complete: boolean;
  /** Skipped for now: incomplete, but deliberately set aside. */
  skipped?: boolean;
}

interface StepperProps {
  steps: StepperStep[];
  current: number;
  percent: number;
  onSelect?: (step: number) => void;
  locked?: boolean;
  className?: string;
}

/**
 * Wizard stepper (task T062): horizontal rail on desktop, compact vertical list
 * on mobile. Completed steps are navigable; upcoming steps are reachable in
 * order through the wizard navigation.
 */
export function Stepper({ steps, current, percent, onSelect, locked, className }: StepperProps) {
  const reduced = useReducedMotion();
  return (
    <nav aria-label="Plan steps" className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Step {current} of {steps.length}
        </span>
        <span className="tabular-nums">{percent}% complete</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <motion.div
          className="h-full w-full origin-left rounded-full bg-gradient-brand shadow-[0_0_12px_var(--brand-blue)]"
          initial={false}
          animate={{ scaleX: percent / 100 }}
          transition={{ duration: reduced ? 0 : 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {/* Desktop rail */}
      <ol
        className="hidden gap-1 lg:grid"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step) => {
          const state =
            step.step === current
              ? "current"
              : step.complete
                ? "complete"
                : step.skipped
                  ? "skipped"
                  : step.step < current
                    ? "visited"
                    : "upcoming";
          const clickable =
            Boolean(onSelect) && !locked && (state !== "upcoming" || step.step === current + 1);
          return (
            <li key={step.step} className="relative min-w-0">
              {step.step < steps.length && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-6 right-[calc(-50%+18px)] left-[calc(50%+18px)] h-px transition-colors duration-500",
                    step.complete ? "bg-success/50" : "bg-border",
                  )}
                />
              )}
              <button
                type="button"
                onClick={clickable ? () => onSelect?.(step.step) : undefined}
                disabled={!clickable}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "group relative flex w-full flex-col items-center gap-2 rounded-lg px-1 py-2 text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
                  clickable && "hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border bg-background text-xs font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-300",
                    clickable && "group-hover:scale-105",
                    state === "current" &&
                      "border-transparent bg-gradient-ai text-white shadow-glow-blue ring-4 ring-primary/15",
                    state === "complete" && "border-success bg-success text-primary-foreground",
                    state === "visited" && "border-warning/50 bg-warning/10 text-warning",
                    state === "skipped" &&
                      "border-dashed border-muted-foreground/50 text-muted-foreground",
                    state === "upcoming" && "border-border text-muted-foreground",
                  )}
                >
                  {state === "complete" ? (
                    <Check className="size-4" aria-hidden />
                  ) : state === "skipped" ? (
                    <SkipForward className="size-3.5" aria-hidden />
                  ) : locked && state === "upcoming" ? (
                    <Lock className="size-3.5" aria-hidden />
                  ) : (
                    step.step
                  )}
                </span>
                <span
                  className={cn(
                    "line-clamp-2 text-[11px] leading-tight",
                    state === "current" ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.title}
                </span>
                <span className="sr-only">
                  {state === "complete"
                    ? "completed"
                    : state === "current"
                      ? "current step"
                      : state === "skipped"
                        ? "skipped for now"
                        : state === "visited"
                          ? "incomplete"
                          : "upcoming"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Mobile list */}
      <ol className="flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="Steps">
        {steps.map((step) => {
          const state =
            step.step === current
              ? "current"
              : step.complete
                ? "complete"
                : step.skipped
                  ? "skipped"
                  : step.step < current
                    ? "visited"
                    : "upcoming";
          const clickable =
            Boolean(onSelect) && !locked && (state !== "upcoming" || step.step === current + 1);
          return (
            <li key={step.step} className="shrink-0">
              <button
                type="button"
                onClick={clickable ? () => onSelect?.(step.step) : undefined}
                disabled={!clickable}
                aria-current={state === "current" ? "step" : undefined}
                aria-label={`Step ${step.step}: ${step.title}${state === "skipped" ? " (skipped)" : ""}`}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  state === "current" &&
                    "border-transparent bg-gradient-ai text-white shadow-glow-blue",
                  state === "complete" && "border-success/40 bg-success/10 text-success",
                  state === "visited" && "border-warning/40 bg-warning/10 text-warning",
                  state === "skipped" &&
                    "border-dashed border-muted-foreground/50 text-muted-foreground",
                  state === "upcoming" && "border-border text-muted-foreground",
                )}
              >
                {state === "complete" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : state === "skipped" ? (
                  <SkipForward className="size-3.5" aria-hidden />
                ) : (
                  <span>{step.step}</span>
                )}
                <span className={cn(state !== "current" && "sr-only sm:not-sr-only")}>
                  {step.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
