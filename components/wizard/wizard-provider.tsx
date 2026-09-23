"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useAssets } from "@/hooks/use-assets";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import {
  useCreateNewDraft,
  useFinalizePlan,
  useOpenDraft,
  usePlanVersions,
  useSavePlanStep,
} from "@/hooks/use-legacy-plan";
import { ApiError } from "@/lib/api/client";
import { computeCompleteness } from "@/lib/legacy-plan/completeness";
import { PLAN_STEPS, TOTAL_PLAN_STEPS } from "@/lib/legacy-plan/steps";
import type { Asset, AssetWithAssignments } from "@/lib/types/asset";
import type { BeneficiaryWithRoles } from "@/lib/types/beneficiary";
import type {
  LegacyPlan,
  PlanCompleteness,
  PlanSectionKey,
  PlanStepsData,
  PlanVersionSummary,
} from "@/lib/types/legacy-plan";
import { fieldErrors, sectionSchemas } from "@/lib/validators/legacy-plan.validators";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface WizardContextValue {
  plan: LegacyPlan;
  beneficiaries: BeneficiaryWithRoles[];
  assets: Asset[];
  assetItems: AssetWithAssignments[];
  versions: PlanVersionSummary[];
  unassignedAssetCount: number;
  currentStep: number;
  totalSteps: number;
  percent: number;
  completeness: PlanCompleteness;
  saveStatus: SaveStatus;
  errors: Record<string, string>;
  clearError: (key: string) => void;
  getSection: <T extends Record<string, unknown>>(key: PlanSectionKey, fallback: T) => T;
  /** Debounced auto-save against `PATCH /legacy-plans/:id/steps/:step` (FR-C002). */
  updateSection: (key: PlanSectionKey, data: Record<string, unknown>) => void;
  /** Immediate save, used before navigation and before finalizing. */
  flush: () => Promise<void>;
  goTo: (step: number) => void;
  next: () => void;
  previous: () => void;
  validateCurrent: () => boolean;
  finalize: (acknowledgeIncomplete: boolean) => Promise<boolean>;
  createNewDraft: () => Promise<boolean>;
  readOnly: boolean;
  busy: boolean;
}

/**
 * The mutable half of the wizard: the debounce timer, the buffered section
 * edits, the authoritative `lockVersion` and the in-flight save.
 *
 * Deliberately a plain object held in `useState` rather than a set of refs —
 * none of it participates in rendering, and reading a ref while rendering is a
 * bug the lint rules (correctly) refuse.
 */
class DraftSession {
  private pending: Partial<Record<PlanSectionKey, Record<string, unknown>>> = {};
  private timer: number | null = null;
  private lock = 0;
  private saving: Promise<void> | null = null;
  private claimed = false;
  private conflict = false;

  /** The token `save_plan_step()` compares; each save returns the next one. */
  get lockVersion(): number {
    return this.lock;
  }

  setLockVersion(next: number) {
    this.lock = next;
  }

  /** True once, so the draft is resolved a single time per mount. */
  claimOpen(): boolean {
    if (this.claimed) return false;
    this.claimed = true;
    return true;
  }

  /**
   * Set when the server refused a save because the draft moved on. Every later
   * save would carry the same stale token and fail identically, so auto-save
   * stops until the page is reloaded rather than retrying once per keystroke.
   */
  get conflicted(): boolean {
    return this.conflict;
  }

  markConflicted() {
    this.conflict = true;
    this.cancel();
  }

  /** Callers await the running save chain instead of starting a second one. */
  get inFlight(): Promise<void> | null {
    return this.saving;
  }

  setInFlight(promise: Promise<void> | null) {
    this.saving = promise;
  }

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
 * Wizard state backed by the real plan API (tasks T061/T065/T069).
 *
 * Auto-save is debounced at 1.2 s and coalesces per section, so a burst of
 * keystrokes is one request. Each save returns the plan's next `lockVersion`,
 * which is carried into the following one — the sections queue sequentially for
 * that reason, and a stale token surfaces as a 409 the user is told about
 * rather than one edit silently overwriting another.
 *
 * Completeness is computed here from the same pure module the server uses, so
 * the stepper and the review step agree with what finalization will record.
 */
export function WizardProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const openDraft = useOpenDraft();
  const [plan, setPlan] = useState<LegacyPlan | null>(null);
  const [stepsData, setStepsData] = useState<PlanStepsData>({});
  const [currentStep, setCurrentStep] = useState(1);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [session] = useState(() => new DraftSession());

  const beneficiariesQuery = useBeneficiaries();
  const financial = useAssets("FINANCIAL_ASSET");
  const physical = useAssets("PHYSICAL_ASSET");
  const digital = useAssets("DIGITAL_ASSET");
  // Only the confirmation step renders the version history, so it is not
  // fetched on every wizard load.
  const versionsQuery = usePlanVersions(plan?.id ?? null, {
    enabled: currentStep === TOTAL_PLAN_STEPS || (plan != null && plan.status !== "DRAFT"),
  });

  const savePlanStep = useSavePlanStep(plan?.id ?? null);
  const finalizePlan = useFinalizePlan(plan?.id ?? null);
  const newDraft = useCreateNewDraft();

  // One call on mount: find the open draft or create it server-side.
  useEffect(() => {
    if (!session.claimOpen()) return;
    openDraft
      .mutateAsync()
      .then((result) => {
        session.setLockVersion(result.lockVersion);
        setPlan(result);
        setStepsData(result.stepsData);
        const requested = Number(searchParams.get("step"));
        const start =
          requested >= 1 && requested <= TOTAL_PLAN_STEPS ? requested : result.currentStep;
        setCurrentStep(Math.min(Math.max(start, 1), TOTAL_PLAN_STEPS));
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof ApiError ? error.message : "Could not open your legacy plan draft.",
        );
      });
    // Intentionally once: the draft is resolved a single time per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beneficiaries = useMemo(
    () => beneficiariesQuery.data?.items ?? [],
    [beneficiariesQuery.data],
  );
  const assetItems = useMemo(
    () => [
      ...(financial.data?.items ?? []),
      ...(physical.data?.items ?? []),
      ...(digital.data?.items ?? []),
    ],
    [financial.data, physical.data, digital.data],
  );
  const assets = useMemo(() => assetItems.map((item) => item.asset), [assetItems]);
  const unassignedAssetCount = useMemo(
    () => assetItems.filter((item) => item.assignments.length === 0).length,
    [assetItems],
  );

  const completeness = useMemo(
    () =>
      computeCompleteness({
        stepsData,
        beneficiaries,
        assets: assets.map((asset) => ({ id: asset.id, kind: asset.kind })),
        // The vault is not persisted yet (Batch 3), so an attachment selection
        // cannot be cross-checked; the section is complete only when the user
        // marks it "none".
        documents: [],
      }),
    [stepsData, beneficiaries, assets],
  );

  /**
   * Writes every buffered section, one request at a time so each carries the
   * `lockVersion` the previous one returned. Concurrent callers await the same
   * in-flight promise rather than starting a second chain.
   */
  const flush = useCallback(async (): Promise<void> => {
    if (session.conflicted) return;
    session.cancel();
    if (session.inFlight) await session.inFlight;

    const entries = session.drain();
    if (entries.length === 0 || !plan) return;

    const run = (async () => {
      setSaveStatus("saving");
      try {
        for (const [key, data] of entries) {
          const result = await savePlanStep.mutateAsync({
            step: key,
            data,
            lockVersion: session.lockVersion,
          });
          session.setLockVersion(result.lockVersion);
        }
        setSaveStatus("saved");
      } catch (error) {
        setSaveStatus("error");
        if (error instanceof ApiError && error.code === "LOCK_CONFLICT") {
          session.markConflicted();
          toast.error("This draft changed somewhere else", {
            description: "Reload the page to pick up the newer version before editing again.",
          });
        } else {
          toast.error(
            error instanceof ApiError ? error.message : "Could not save this step. Try again.",
          );
        }
      } finally {
        session.setInFlight(null);
      }
    })();

    session.setInFlight(run);
    await run;
  }, [session, plan, savePlanStep]);

  const updateSection = useCallback(
    (key: PlanSectionKey, data: Record<string, unknown>) => {
      setStepsData((previous) => ({ ...previous, [key]: data }));
      if (session.conflicted) {
        setSaveStatus("error");
        return;
      }
      session.set(key, data);
      setSaveStatus("dirty");
      session.schedule(() => void flush(), 1200);
    },
    [session, flush],
  );

  // A pending edit must not be lost when the wizard unmounts.
  useEffect(() => () => void flush(), [flush]);

  const value = useMemo<WizardContextValue | null>(() => {
    if (!plan) return null;
    const readOnly = plan.status !== "DRAFT";

    const getSection = <T extends Record<string, unknown>>(
      key: PlanSectionKey,
      fallbackValue: T,
    ): T => ({ ...fallbackValue, ...((stepsData[key] as Partial<T> | undefined) ?? {}) });

    const validateCurrent = () => {
      const step = PLAN_STEPS.find((entry) => entry.step === currentStep);
      if (!step || step.key === "review" || step.key === "confirmation") return true;
      const schema = sectionSchemas[step.key];
      const result = schema.safeParse(stepsData[step.key] ?? {});
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
      void flush();
      const clamped = Math.min(Math.max(step, 1), TOTAL_PLAN_STEPS);
      setErrors({});
      setCurrentStep(clamped);
      router.replace(`/legacy-plan/wizard?step=${clamped}`, { scroll: true });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    };

    return {
      plan,
      beneficiaries,
      assets,
      assetItems,
      versions: versionsQuery.data?.items ?? [],
      unassignedAssetCount,
      currentStep,
      totalSteps: TOTAL_PLAN_STEPS,
      percent: completeness.percent,
      completeness,
      saveStatus,
      errors,
      clearError: (key) =>
        setErrors((previous) =>
          previous[key]
            ? Object.fromEntries(Object.entries(previous).filter(([k]) => k !== key))
            : previous,
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
      finalize: async (acknowledgeIncomplete: boolean) => {
        await flush();
        try {
          const result = await finalizePlan.mutateAsync({
            lockVersion: session.lockVersion,
            acknowledgeIncomplete,
          });
          session.setLockVersion(result.plan.lockVersion);
          setPlan(result.plan);
          setStepsData(result.plan.stepsData);
          setCurrentStep(TOTAL_PLAN_STEPS);
          router.replace(`/legacy-plan/wizard?step=${TOTAL_PLAN_STEPS}`);
          return true;
        } catch (error) {
          toast.error(
            error instanceof ApiError ? error.message : "Could not finalize this plan.",
            error instanceof ApiError && Array.isArray(error.details?.incompleteSections)
              ? { description: "Acknowledge the incomplete sections and try again." }
              : undefined,
          );
          return false;
        }
      },
      createNewDraft: async () => {
        try {
          const draft = await newDraft.mutateAsync(plan.id);
          session.setLockVersion(draft.lockVersion);
          setPlan(draft);
          setStepsData(draft.stepsData);
          setCurrentStep(1);
          router.replace("/legacy-plan/wizard?step=1");
          return true;
        } catch (error) {
          toast.error(error instanceof ApiError ? error.message : "Could not start a new draft.");
          return false;
        }
      },
      readOnly,
      busy: savePlanStep.isPending || finalizePlan.isPending || newDraft.isPending,
    };
  }, [
    plan,
    beneficiaries,
    assets,
    assetItems,
    unassignedAssetCount,
    versionsQuery.data,
    stepsData,
    currentStep,
    completeness,
    saveStatus,
    errors,
    updateSection,
    flush,
    router,
    session,
    finalizePlan,
    newDraft,
    savePlanStep.isPending,
  ]);

  if (!value) return <>{fallback}</>;
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}
