"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useDemoWorkspace } from "@/hooks/use-demo-workspace";
import { PLAN_STEPS, getPlanCompleteness } from "@/lib/demo/selectors";
import { useDemoStore, type ActionResult } from "@/lib/demo/store";
import type { DemoLegacyPlan, DemoWorkspace, PlanSectionKey } from "@/lib/demo/types";
import { fieldErrors, sectionSchemas } from "@/lib/validators/legacy-plan.validators";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved";

interface WizardContextValue {
  workspace: DemoWorkspace;
  plan: DemoLegacyPlan;
  currentStep: number;
  totalSteps: number;
  percent: number;
  completeness: ReturnType<typeof getPlanCompleteness>;
  saveStatus: SaveStatus;
  errors: Record<string, string>;
  clearError: (key: string) => void;
  getSection: <T extends Record<string, unknown>>(key: PlanSectionKey, fallback: T) => T;
  /** Debounced auto-save (FR-C002). */
  updateSection: (key: PlanSectionKey, data: Record<string, unknown>) => void;
  /** Immediate save, used by "Save draft" and before navigation. */
  flush: () => void;
  goTo: (step: number) => void;
  next: () => void;
  previous: () => void;
  validateCurrent: () => boolean;
  finalize: (acknowledgeIncomplete: boolean) => ActionResult;
  createNewDraft: () => ActionResult;
  readOnly: boolean;
}

/** Debounced, un-rendered edit buffer (kept outside React state on purpose). */
class PendingEdits {
  private pending: Partial<Record<PlanSectionKey, Record<string, unknown>>> = {};
  private timer: number | null = null;

  set(key: PlanSectionKey, data: Record<string, unknown>) {
    this.pending[key] = data;
  }

  schedule(fn: () => void, ms: number) {
    this.cancel();
    this.timer = window.setTimeout(fn, ms);
  }

  cancel() {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  drain(): [PlanSectionKey, Record<string, unknown>][] {
    const entries = Object.entries(this.pending) as [PlanSectionKey, Record<string, unknown>][];
    this.pending = {};
    return entries;
  }
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used inside <WizardProvider>");
  return ctx;
}

/**
 * Wizard state (task T061 — demo-store backed; the TanStack mutation against
 * `PATCH /legacy-plans/:id/steps/:step` replaces `savePlanStep` later): current
 * step, per-section data with a 1.2 s debounced auto-save, per-step validation,
 * navigation and finalize/new-draft transitions.
 */
export function WizardProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const { workspace, ready } = useDemoWorkspace();
  const ensurePlan = useDemoStore((s) => s.ensurePlan);
  const savePlanStep = useDemoStore((s) => s.savePlanStep);
  const setPlanStep = useDemoStore((s) => s.setPlanStep);
  const finalizePlan = useDemoStore((s) => s.finalizePlan);
  const createNewDraftAction = useDemoStore((s) => s.createNewDraft);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [edits] = useState(() => new PendingEdits());

  useEffect(() => {
    if (ready && !workspace.plan) ensurePlan();
  }, [ready, workspace.plan, ensurePlan]);

  const plan = workspace.plan;

  // Deep-link `?step=n`
  useEffect(() => {
    const requested = Number(searchParams.get("step"));
    if (
      plan &&
      requested >= 1 &&
      requested <= 11 &&
      requested !== plan.currentStep &&
      plan.status === "DRAFT"
    ) {
      setPlanStep(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);

  const flush = useCallback(() => {
    edits.cancel();
    const entries = edits.drain();
    if (entries.length === 0) return;
    setSaveStatus("saving");
    for (const [key, data] of entries) savePlanStep(key, data);
    window.setTimeout(() => setSaveStatus("saved"), 250);
  }, [savePlanStep, edits]);

  const updateSection = useCallback(
    (key: PlanSectionKey, data: Record<string, unknown>) => {
      edits.set(key, data);
      setSaveStatus("dirty");
      edits.schedule(flush, 1200);
    },
    [flush, edits],
  );

  useEffect(() => () => flush(), [flush]);

  const completeness = useMemo(() => getPlanCompleteness(workspace), [workspace]);

  const value = useMemo<WizardContextValue | null>(() => {
    if (!plan) return null;
    const currentStep = Math.min(Math.max(plan.currentStep, 1), 11);
    const readOnly = plan.status !== "DRAFT";

    // Pending edits are flushed before every navigation, so the store is the source of truth here.
    const getSection = <T extends Record<string, unknown>>(
      key: PlanSectionKey,
      fallbackValue: T,
    ): T => {
      const saved = plan.stepsData[key] as Partial<T> | undefined;
      return { ...fallbackValue, ...(saved ?? {}) };
    };

    const validateCurrent = () => {
      const step = PLAN_STEPS.find((s) => s.step === currentStep);
      if (!step || step.key === "review" || step.key === "confirmation") return true;
      const schema = sectionSchemas[step.key];
      flush();
      const data = useDemoStore.getState().workspace.plan?.stepsData[step.key] ?? {};
      const result = schema.safeParse(data);
      if (result.success) {
        setErrors({});
        return true;
      }
      const flat = fieldErrors(result.error);
      setErrors(flat);
      toast.error("Please complete the highlighted fields", {
        description: Object.values(flat)[0],
      });
      return false;
    };

    const goTo = (step: number) => {
      flush();
      const clamped = Math.min(Math.max(step, 1), 11);
      setErrors({});
      setPlanStep(clamped);
      router.replace(`/legacy-plan/wizard?step=${clamped}`, { scroll: true });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    };

    return {
      workspace,
      plan,
      currentStep,
      totalSteps: 11,
      percent: completeness.percent,
      completeness,
      saveStatus,
      errors,
      clearError: (key) =>
        setErrors((prev) =>
          prev[key] ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)) : prev,
        ),
      getSection,
      updateSection,
      flush,
      goTo,
      next: () => {
        if (readOnly || validateCurrent()) goTo(currentStep + 1);
      },
      previous: () => goTo(currentStep - 1),
      validateCurrent,
      finalize: (acknowledgeIncomplete) => {
        flush();
        const result = finalizePlan({ acknowledgeIncomplete });
        if (result.ok) {
          setPlanStep(11);
          router.replace("/legacy-plan/wizard?step=11");
        }
        return result;
      },
      createNewDraft: () => {
        const result = createNewDraftAction();
        if (result.ok) router.replace("/legacy-plan/wizard?step=1");
        return result;
      },
      readOnly,
    };
  }, [
    plan,
    workspace,
    completeness,
    saveStatus,
    errors,
    updateSection,
    flush,
    setPlanStep,
    router,
    finalizePlan,
    createNewDraftAction,
  ]);

  if (!ready || !value) return <>{fallback}</>;
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}
