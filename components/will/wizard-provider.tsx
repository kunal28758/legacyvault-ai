"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useAssets } from "@/hooks/use-assets";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { useDocuments } from "@/hooks/use-documents";
import {
  useCreateNewDraft,
  useFinalizePlan,
  useLegacyPlan,
  useOpenDraft,
  usePlanVersion,
  usePlanVersions,
  useSavePlanStep,
} from "@/hooks/use-legacy-plan";
import { ApiError } from "@/lib/client/api-client";
import { computeCompleteness } from "@/lib/legacy-plan/completeness";
import { normalizeWizardStep, PLAN_STEPS, TOTAL_PLAN_STEPS } from "@/lib/legacy-plan/steps";
import type { Asset, AssetWithAssignments } from "@/lib/types/asset";
import type { BeneficiaryWithRoles } from "@/lib/types/beneficiary";
import type { DocumentSummary } from "@/lib/types/document";
import type {
  LegacyPlan,
  PlanCompleteness,
  PlanSectionKey,
  PlanStepsData,
  PlanVersionDetail,
  PlanVersionSummary,
} from "@/lib/types/legacy-plan";
import {
  SKIPPABLE_SECTIONS,
  fieldErrors,
  sectionSchemas,
} from "@/lib/validators/legacy-plan.validators";

/**
 * `saved` is only ever set after the server has confirmed every buffered edit;
 * `dirty` means there are edits the server has not yet accepted.
 */
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface WizardContextValue {
  plan: LegacyPlan;
  beneficiaries: BeneficiaryWithRoles[];
  assets: Asset[];
  assetItems: AssetWithAssignments[];
  documents: DocumentSummary[];
  versions: PlanVersionSummary[];
  snapshot: PlanVersionDetail | null;
  unassignedAssetCount: number;
  currentStep: number;
  totalSteps: number;
  percent: number;
  completeness: PlanCompleteness;
  saveStatus: SaveStatus;
  /** When the server last confirmed a save in this session. */
  lastSavedAt: number | null;
  saveError: string | null;
  errors: Record<string, string>;
  clearError: (key: string) => void;
  getSection: <T extends Record<string, unknown>>(key: PlanSectionKey, fallback: T) => T;
  /** Debounced auto-save against `PATCH /legacy-plans/:id/steps/:step` (FR-C002). */
  updateSection: (key: PlanSectionKey, data: Record<string, unknown>) => void;
  /** Saves everything buffered now; resolves true once the server has confirmed it all. */
  flush: () => Promise<boolean>;
  goTo: (step: number) => void;
  previous: () => void;
  validateCurrent: () => boolean;
  /** Validates the step, waits for the server to confirm the save, then moves on. */
  saveAndContinue: () => Promise<void>;
  /** Records "Skip for now" on an optional step (keeping what was typed) and moves on. */
  skipCurrent: () => Promise<void>;
  canSkipCurrent: boolean;
  isSkipped: (key: PlanSectionKey) => boolean;
  advancing: boolean;
  finalize: (acknowledgeIncomplete: boolean) => Promise<boolean>;
  createNewDraft: () => Promise<boolean>;
  readOnly: boolean;
  busy: boolean;
}

const AUTOSAVE_DEBOUNCE_MS = 1_200;
/** Automatic retries for transient failures (network, 5xx, rate limit). */
const MAX_AUTO_RETRIES = 3;

type Entry = [PlanSectionKey, Record<string, unknown>];

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
  private saving: Promise<boolean> | null = null;
  private claimed = false;
  private conflict = false;
  /** False after a failed save, until a later save succeeds. */
  lastSaveOk = true;
  retries = 0;

  get lockVersion(): number {
    return this.lock;
  }

  setLockVersion(next: number) {
    this.lock = next;
  }

  claimOpen(): boolean {
    if (this.claimed) return false;
    this.claimed = true;
    return true;
  }

  /**
   * Set when the server refused a save because the draft moved on (another
   * tab). Every later save would carry the same stale token, so auto-save
   * stops until the page is reloaded.
   */
  get conflicted(): boolean {
    return this.conflict;
  }

  markConflicted() {
    this.conflict = true;
    this.cancel();
  }

  get inFlight(): Promise<boolean> | null {
    return this.saving;
  }

  setInFlight(promise: Promise<boolean> | null) {
    this.saving = promise;
  }

  get hasPending(): boolean {
    return Object.keys(this.pending).length > 0;
  }

  /** Anything the server has not confirmed: buffered, saving, or failed. */
  get hasUnsavedWork(): boolean {
    return this.hasPending || this.saving !== null || !this.lastSaveOk;
  }

  set(key: PlanSectionKey, data: Record<string, unknown>) {
    this.pending[key] = data;
  }

  /** Puts unsent sections back after a failure, unless a newer edit replaced them. */
  restore(entries: Entry[]) {
    for (const [key, data] of entries) {
      if (!(key in this.pending)) this.pending[key] = data;
    }
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

  drain(): Entry[] {
    const entries = Object.entries(this.pending) as Entry[];
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

function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isRateLimited) return "Saving is paused for a moment — too many requests.";
    if (error.status === 0)
      return "You appear to be offline. Changes will save when you reconnect.";
    return error.message;
  }
  return "Could not save this step.";
}

function isTransient(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.isRateLimited)
  );
}

/**
 * Wizard state backed by the real plan API (tasks T061/T065/T069).
 *
 * Auto-save is debounced and coalesces per section, so a burst of keystrokes
 * is one request. Each save returns the plan's next `lockVersion`, which is
 * carried into the following one — the sections queue sequentially for that
 * reason, and a stale token surfaces as a 409 the user is told about rather
 * than one edit silently overwriting another.
 *
 * Nothing is reported as saved until the server says so. A failed save keeps
 * its edits buffered (they are retried automatically for transient failures,
 * and on demand otherwise), and leaving the page with unconfirmed edits asks
 * first.
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
  const snapshotPlanId = searchParams.get("planId");
  const requestedVersionId = searchParams.get("versionId");

  const openDraft = useOpenDraft();
  const selectedPlan = useLegacyPlan(snapshotPlanId);
  const [plan, setPlan] = useState<LegacyPlan | null>(null);
  const [stepsData, setStepsData] = useState<PlanStepsData>({});
  const [currentStep, setCurrentStep] = useState(1);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [advancing, setAdvancing] = useState(false);
  const [session] = useState(() => new DraftSession());

  const beneficiariesQuery = useBeneficiaries();
  const financial = useAssets("FINANCIAL_ASSET");
  const physical = useAssets("PHYSICAL_ASSET");
  const digital = useAssets("DIGITAL_ASSET");
  const documentsQuery = useDocuments({ limit: 100 });
  // Only the confirmation step renders the version history, so it is not
  // fetched on every wizard load.
  const versionsQuery = usePlanVersions(plan?.id ?? null, {
    enabled: currentStep === TOTAL_PLAN_STEPS || (plan != null && plan.status !== "DRAFT"),
  });
  const snapshotVersionId = requestedVersionId ?? versionsQuery.data?.items[0]?.id ?? null;
  const snapshotVersionQuery = usePlanVersion(plan?.id ?? snapshotPlanId, snapshotVersionId);

  const saveStep = useSavePlanStep(plan?.id ?? null);
  const finalizePlan = useFinalizePlan(plan?.id ?? null);
  const newDraft = useCreateNewDraft();
  const saveStepAsync = saveStep.mutateAsync;

  // One call on mount: find the open draft or create it server-side.
  useEffect(() => {
    if (snapshotPlanId && !selectedPlan.data) return;
    if (!session.claimOpen()) return;
    const opening = snapshotPlanId
      ? selectedPlan.data
        ? Promise.resolve(selectedPlan.data)
        : Promise.resolve(null)
      : openDraft.mutateAsync();
    opening
      .then((result) => {
        if (!result) return;
        session.setLockVersion(result.lockVersion);
        setPlan(result);
        setStepsData(result.stepsData);
        const requested = Number(searchParams.get("step"));
        const start =
          requested >= 1 && requested <= TOTAL_PLAN_STEPS
            ? requested
            : normalizeWizardStep(result.currentStep);
        setCurrentStep(Math.min(Math.max(start, 1), TOTAL_PLAN_STEPS));
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof ApiError ? error.message : "Could not open your legacy plan draft.",
        );
      });
    // Intentionally once: the draft is resolved a single time per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlan.data]);

  const beneficiaries = useMemo(
    () => beneficiariesQuery.data?.items ?? [],
    [beneficiariesQuery.data],
  );
  const documents = useMemo(() => documentsQuery.data?.items ?? [], [documentsQuery.data]);
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
        documents: documents.map((document) => ({ id: document.id })),
      }),
    [stepsData, beneficiaries, assets, documents],
  );

  // The scheduled callbacks below must always call the latest `flush`.
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  /**
   * Writes every buffered section, one request at a time so each carries the
   * `lockVersion` the previous one returned. Concurrent callers await the same
   * in-flight chain rather than starting a second one.
   */
  const flush = useCallback(async (): Promise<boolean> => {
    if (session.conflicted) return false;
    session.cancel();
    if (session.inFlight) await session.inFlight;

    const entries = session.drain();
    if (entries.length === 0) return session.lastSaveOk;
    if (!plan) {
      session.restore(entries);
      return false;
    }

    const run = (async (): Promise<boolean> => {
      setSaveStatus("saving");
      let index = 0;
      try {
        for (; index < entries.length; index += 1) {
          const [key, data] = entries[index]!;
          const result = await saveStepAsync({ step: key, data, lockVersion: session.lockVersion });
          session.setLockVersion(result.lockVersion);
        }
        session.lastSaveOk = true;
        session.retries = 0;
        setSaveError(null);
        setLastSavedAt(Date.now());
        if (session.hasPending) {
          // Edits made while this save was in flight are not saved yet.
          setSaveStatus("dirty");
          session.schedule(() => void flushRef.current(), AUTOSAVE_DEBOUNCE_MS);
        } else {
          setSaveStatus("saved");
        }
        return true;
      } catch (error) {
        session.restore(entries.slice(index));
        session.lastSaveOk = false;
        setSaveStatus("error");
        setSaveError(saveErrorMessage(error));
        if (error instanceof ApiError && error.code === "LOCK_CONFLICT") {
          session.markConflicted();
          toast.error("This draft changed in another tab or device", {
            description: "Reload to pick up the newer version before editing again.",
            action: { label: "Reload", onClick: () => window.location.reload() },
            duration: Infinity,
          });
        } else if (isTransient(error) && session.retries < MAX_AUTO_RETRIES) {
          session.retries += 1;
          const retryAfter =
            error instanceof ApiError && error.retryAfterSeconds
              ? error.retryAfterSeconds * 1000
              : 2_000 * 2 ** session.retries;
          session.schedule(() => void flushRef.current(), retryAfter);
        }
        return false;
      } finally {
        session.setInFlight(null);
      }
    })();

    session.setInFlight(run);
    return await run;
  }, [session, plan, saveStepAsync]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const updateSection = useCallback(
    (key: PlanSectionKey, data: Record<string, unknown>) => {
      // A real edit un-skips the section; what was typed before is kept.
      const { skipped: _skipped, ...edited } = data;
      setStepsData((previous) => ({ ...previous, [key]: edited }));
      if (session.conflicted) {
        setSaveStatus("error");
        return;
      }
      session.set(key, edited);
      setSaveStatus("dirty");
      session.schedule(() => void flushRef.current(), AUTOSAVE_DEBOUNCE_MS);
    },
    [session],
  );

  // Leaving the wizard inside the app saves what is buffered.
  useEffect(() => () => void flushRef.current(), []);

  // Hiding the tab (switching apps, locking the phone) saves immediately; a
  // reload or close with unconfirmed edits asks first. Coming back online
  // retries a save that failed while offline.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!session.hasUnsavedWork) return;
      void flushRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    const onOnline = () => {
      if (!session.lastSaveOk) void flushRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("online", onOnline);
    };
  }, [session]);

  const value = useMemo<WizardContextValue | null>(() => {
    if (!plan) return null;
    const readOnly = plan.status !== "DRAFT";
    const stepMeta = PLAN_STEPS.find((entry) => entry.step === currentStep);
    const currentKey =
      stepMeta && stepMeta.key !== "review" && stepMeta.key !== "confirmation"
        ? stepMeta.key
        : null;

    const getSection = <T extends Record<string, unknown>>(
      key: PlanSectionKey,
      fallbackValue: T,
    ): T => ({ ...fallbackValue, ...((stepsData[key] as Partial<T> | undefined) ?? {}) });

    const validateCurrent = () => {
      if (!currentKey) return true;
      const { skipped: _skipped, ...data } = stepsData[currentKey] ?? {};
      const result = sectionSchemas[currentKey].safeParse(data);
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
      router.replace(`/legacy-plan/wizard?step=${clamped}`, { scroll: false });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const canSkipCurrent =
      !readOnly && currentKey !== null && SKIPPABLE_SECTIONS.includes(currentKey);

    return {
      plan,
      beneficiaries,
      assets,
      assetItems,
      documents,
      versions: versionsQuery.data?.items ?? [],
      snapshot: snapshotVersionQuery.data ?? null,
      unassignedAssetCount,
      currentStep,
      totalSteps: TOTAL_PLAN_STEPS,
      percent: completeness.percent,
      completeness,
      saveStatus,
      lastSavedAt,
      saveError,
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
      previous: () => goTo(currentStep - 1),
      validateCurrent,
      saveAndContinue: async () => {
        if (readOnly) {
          goTo(currentStep + 1);
          return;
        }
        if (!validateCurrent()) return;
        setAdvancing(true);
        try {
          if (await flush()) goTo(currentStep + 1);
          else
            toast.error("Your changes are not saved yet", {
              description: "Retry the save before moving on.",
            });
        } finally {
          setAdvancing(false);
        }
      },
      skipCurrent: async () => {
        if (!canSkipCurrent || !currentKey) return;
        const data = { ...(stepsData[currentKey] ?? {}), skipped: true };
        setStepsData((previous) => ({ ...previous, [currentKey]: data }));
        session.set(currentKey, data);
        setAdvancing(true);
        try {
          if (await flush()) {
            toast("Step skipped", {
              description: "You can complete it later from the review step.",
            });
            goTo(currentStep + 1);
          }
        } finally {
          setAdvancing(false);
        }
      },
      canSkipCurrent,
      isSkipped: (key) => completeness.sections[key].skipped === true,
      advancing,
      finalize: async (acknowledgeIncomplete: boolean) => {
        if (!(await flush())) {
          toast.error("Save your changes before finalizing", {
            description: "The latest edits have not reached the server yet.",
          });
          return false;
        }
        try {
          const result = await finalizePlan.mutateAsync({
            lockVersion: session.lockVersion,
            acknowledgeIncomplete,
          });
          session.setLockVersion(result.plan.lockVersion);
          setPlan(result.plan);
          setStepsData(result.plan.stepsData);
          setCurrentStep(TOTAL_PLAN_STEPS);
          router.replace(
            `/legacy-plan/wizard?step=${TOTAL_PLAN_STEPS}&planId=${result.plan.id}&versionId=${result.versionId}`,
          );
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
      busy: saveStep.isPending || finalizePlan.isPending || newDraft.isPending || advancing,
    };
  }, [
    plan,
    beneficiaries,
    assets,
    assetItems,
    documents,
    unassignedAssetCount,
    versionsQuery.data,
    snapshotVersionQuery.data,
    stepsData,
    currentStep,
    completeness,
    saveStatus,
    lastSavedAt,
    saveError,
    errors,
    advancing,
    updateSection,
    flush,
    router,
    session,
    finalizePlan,
    newDraft,
    saveStep.isPending,
  ]);

  if (!value) return <>{fallback}</>;
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}
