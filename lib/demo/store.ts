"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createSeedWorkspace } from "@/lib/demo/seed";
import { getPlanCompleteness } from "@/lib/demo/selectors";
import type {
  AccessScope,
  AssetKind,
  AssignmentResourceType,
  DemoAsset,
  DemoAssetInput,
  DemoBeneficiary,
  DemoChatMessage,
  DemoDmsEvent,
  DemoDocument,
  DemoEmergencyContact,
  DemoEmergencyRequest,
  DemoLegacyPlan,
  DemoPreferences,
  DemoVideoMessage,
  DemoWorkspace,
  DmsStatus,
  EaOnTimeout,
  PlanSectionKey,
} from "@/lib/demo/types";

/**
 * Demo workspace store.
 *
 * This is deliberately NOT a data layer: it holds a synthetic workspace in the
 * current browser tab (sessionStorage) so the product experience can be
 * exercised end to end before the Route Handlers / services of Phase 2–3 exist.
 * Nothing here is sent to a server, nothing is persisted beyond the tab, and the
 * UI labels it as a demo workspace. Business rules that are enforced by the
 * guarded PostgreSQL functions (Σ allocation ≤ 100 %, one DRAFT plan, plan
 * finalization rules, DMS / emergency-access state machines) are mirrored here so
 * the interface behaves the way the real system will.
 */
export const DEMO_STORAGE_KEY = "legacyvault.demo-workspace.v1";

export interface ActionResult {
  ok: boolean;
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

const ok: ActionResult = { ok: true };
const fail = (code: string, message: string, details?: Record<string, unknown>): ActionResult => ({
  ok: false,
  code,
  message,
  details,
});

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

const EMPTY_SCOPE: AccessScope = { documents: [], assets: [], videos: [], planSections: [] };

export interface DemoStore {
  hydrated: boolean;
  workspace: DemoWorkspace;
  setHydrated: (value: boolean) => void;
  resetWorkspace: () => void;
  logActivity: (action: string, resourceType: string, description: string) => void;

  // Beneficiaries
  addBeneficiary: (
    input: Pick<DemoBeneficiary, "name" | "relationship" | "email" | "phone" | "notes">,
  ) => ActionResult;
  updateBeneficiary: (
    id: string,
    patch: Partial<Pick<DemoBeneficiary, "name" | "relationship" | "email" | "phone" | "notes">>,
  ) => ActionResult;
  setBeneficiaryStatus: (id: string, status: "ACTIVE" | "INACTIVE") => ActionResult;
  removeBeneficiary: (id: string) => ActionResult;
  resendInvitation: (id: string) => ActionResult;

  // Assets
  addAsset: (asset: DemoAssetInput) => ActionResult;
  updateAsset: (id: string, patch: Partial<DemoAssetInput>) => ActionResult;
  removeAsset: (id: string) => ActionResult;

  // Assignments
  assign: (
    beneficiaryId: string,
    resourceType: AssignmentResourceType,
    resourceId: string,
    allocationPercentage: number | null,
  ) => ActionResult;
  unassign: (assignmentId: string) => ActionResult;

  // Vault
  addFolder: (name: string, parentId?: string | null) => ActionResult;
  addDemoDocument: (
    input: Pick<DemoDocument, "name" | "mimeType" | "sizeBytes" | "folderId">,
  ) => ActionResult;
  markDocumentScanned: (id: string) => void;
  renameDocument: (id: string, name: string) => ActionResult;
  moveDocument: (id: string, folderId: string | null) => ActionResult;
  removeDocument: (id: string) => ActionResult;
  addDemoVideo: (
    input: Pick<DemoVideoMessage, "title" | "description" | "deliveryCondition" | "sizeBytes">,
  ) => ActionResult;
  updateVideo: (
    id: string,
    patch: Partial<Pick<DemoVideoMessage, "title" | "description" | "deliveryCondition">>,
  ) => ActionResult;
  removeVideo: (id: string) => ActionResult;

  // Legacy plan
  ensurePlan: () => DemoLegacyPlan;
  savePlanStep: (section: PlanSectionKey, data: Record<string, unknown>) => ActionResult;
  setPlanStep: (step: number) => void;
  finalizePlan: (options: { acknowledgeIncomplete: boolean }) => ActionResult;
  createNewDraft: () => ActionResult;

  // Dead Man's Switch
  configureDms: (
    config: Pick<
      DemoWorkspace["dms"],
      "inactivityPeriodDays" | "checkInFrequencyDays" | "escalationDelayHours"
    > & { contactIds: string[]; releaseScope?: AccessScope },
  ) => ActionResult;
  dmsCheckIn: () => ActionResult;
  dmsPause: () => ActionResult;
  dmsResume: () => ActionResult;
  dmsDisable: () => ActionResult;
  dmsCancelEscalation: () => ActionResult;
  dmsSimulateNextStage: () => ActionResult;

  // Emergency access
  configureEmergencyContact: (input: {
    beneficiaryId: string;
    onTimeout: EaOnTimeout;
    timeoutHours: number | null;
    requestExpiryHours: number;
    accessDurationHours: number;
    accessScope?: AccessScope;
  }) => ActionResult;
  removeEmergencyContact: (configId: string) => ActionResult;
  decideEmergencyRequest: (requestId: string, decision: "APPROVE" | "DENY") => ActionResult;
  revokeEmergencyAccess: (requestId: string) => ActionResult;
  simulateEmergencyRequest: (configId: string) => ActionResult;

  // Notifications
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  // Settings & security
  updatePreferences: (patch: Partial<DemoPreferences>) => void;
  revokeSession: (sessionId: string) => ActionResult;

  // AI assistant (session-scoped, never persisted server-side — ADR-016)
  appendChatMessage: (message: Omit<DemoChatMessage, "id" | "createdAt">) => void;
  clearChat: () => void;
}

export const useDemoStore = create<DemoStore>()(
  persist(
    (set, get) => {
      const update = (recipe: (ws: DemoWorkspace) => DemoWorkspace) =>
        set((state) => ({ workspace: recipe(state.workspace) }));

      const pushActivity = (
        ws: DemoWorkspace,
        action: string,
        resourceType: string,
        description: string,
      ): DemoWorkspace => ({
        ...ws,
        activity: [
          {
            id: newId("act"),
            action,
            resourceType,
            outcome: "SUCCESS" as const,
            description,
            createdAt: nowIso(),
          },
          ...ws.activity,
        ].slice(0, 60),
      });

      const pushDmsEvent = (
        ws: DemoWorkspace,
        event: Omit<DemoDmsEvent, "id" | "createdAt">,
        patch: Partial<DemoWorkspace["dms"]>,
      ): DemoWorkspace => ({
        ...ws,
        dms: {
          ...ws.dms,
          ...patch,
          status: event.newState,
          events: [{ id: newId("dev"), createdAt: nowIso(), ...event }, ...ws.dms.events],
        },
      });

      return {
        hydrated: false,
        workspace: createSeedWorkspace(),
        setHydrated: (value) => set({ hydrated: value }),
        resetWorkspace: () => set({ workspace: createSeedWorkspace() }),
        logActivity: (action, resourceType, description) =>
          update((ws) => pushActivity(ws, action, resourceType, description)),

        // ── Beneficiaries ─────────────────────────────────────────────────
        addBeneficiary: (input) => {
          const email = input.email.trim().toLowerCase();
          const ws = get().workspace;
          if (ws.beneficiaries.some((b) => b.email === email)) {
            return fail("DUPLICATE_EMAIL", "A beneficiary with this email already exists.");
          }
          const beneficiary: DemoBeneficiary = {
            id: newId("ben"),
            name: input.name.trim(),
            relationship: input.relationship.trim(),
            email,
            phone: input.phone?.trim() || null,
            notes: input.notes?.trim() || null,
            status: "PENDING",
            invitedAt: nowIso(),
            activatedAt: null,
            createdAt: nowIso(),
          };
          update((w) =>
            pushActivity(
              { ...w, beneficiaries: [beneficiary, ...w.beneficiaries] },
              "beneficiary.created",
              "beneficiary",
              `Added ${beneficiary.name} as a beneficiary`,
            ),
          );
          return ok;
        },
        updateBeneficiary: (id, patch) => {
          const ws = get().workspace;
          const target = ws.beneficiaries.find((b) => b.id === id);
          if (!target) return fail("NOT_FOUND", "Beneficiary not found.");
          const email = patch.email?.trim().toLowerCase();
          if (email && ws.beneficiaries.some((b) => b.id !== id && b.email === email)) {
            return fail("DUPLICATE_EMAIL", "Another beneficiary already uses this email.");
          }
          update((w) =>
            pushActivity(
              {
                ...w,
                beneficiaries: w.beneficiaries.map((b) =>
                  b.id === id
                    ? {
                        ...b,
                        ...patch,
                        email: email ?? b.email,
                        phone: patch.phone === undefined ? b.phone : patch.phone || null,
                        notes: patch.notes === undefined ? b.notes : patch.notes || null,
                      }
                    : b,
                ),
              },
              "beneficiary.updated",
              "beneficiary",
              `Updated beneficiary ${patch.name ?? target.name}`,
            ),
          );
          return ok;
        },
        setBeneficiaryStatus: (id, status) => {
          const target = get().workspace.beneficiaries.find((b) => b.id === id);
          if (!target) return fail("NOT_FOUND", "Beneficiary not found.");
          update((w) =>
            pushActivity(
              {
                ...w,
                beneficiaries: w.beneficiaries.map((b) =>
                  b.id === id
                    ? {
                        ...b,
                        status,
                        activatedAt: b.activatedAt ?? (status === "ACTIVE" ? nowIso() : null),
                      }
                    : b,
                ),
              },
              "beneficiary.status_changed",
              "beneficiary",
              `${target.name} marked ${status.toLowerCase()}${status === "INACTIVE" ? " — access links revoked" : ""}`,
            ),
          );
          return ok;
        },
        removeBeneficiary: (id) => {
          const target = get().workspace.beneficiaries.find((b) => b.id === id);
          if (!target) return fail("NOT_FOUND", "Beneficiary not found.");
          update((w) =>
            pushActivity(
              {
                ...w,
                beneficiaries: w.beneficiaries.filter((b) => b.id !== id),
                assignments: w.assignments.filter((a) => a.beneficiaryId !== id),
                emergencyContacts: w.emergencyContacts.filter((c) => c.beneficiaryId !== id),
                dms: { ...w.dms, contactIds: w.dms.contactIds.filter((c) => c !== id) },
              },
              "beneficiary.removed",
              "beneficiary",
              `Removed ${target.name} (assignments, links and contact roles cleared)`,
            ),
          );
          return ok;
        },
        resendInvitation: (id) => {
          const target = get().workspace.beneficiaries.find((b) => b.id === id);
          if (!target) return fail("NOT_FOUND", "Beneficiary not found.");
          update((w) =>
            pushActivity(
              {
                ...w,
                beneficiaries: w.beneficiaries.map((b) =>
                  b.id === id ? { ...b, invitedAt: nowIso() } : b,
                ),
              },
              "beneficiary.invited",
              "beneficiary",
              `Re-sent the invitation to ${target.name}`,
            ),
          );
          return ok;
        },

        // ── Assets ────────────────────────────────────────────────────────
        addAsset: (asset) => {
          const record = {
            ...asset,
            id: newId(
              asset.kind === "FINANCIAL_ASSET"
                ? "fin"
                : asset.kind === "PHYSICAL_ASSET"
                  ? "phy"
                  : "dig",
            ),
            createdAt: nowIso(),
            updatedAt: nowIso(),
          } as DemoAsset;
          update((w) =>
            pushActivity(
              { ...w, assets: [record, ...w.assets] },
              "asset.created",
              record.kind.toLowerCase(),
              `Added ${record.name}`,
            ),
          );
          return ok;
        },
        updateAsset: (id, patch) => {
          const target = get().workspace.assets.find((a) => a.id === id);
          if (!target) return fail("NOT_FOUND", "Asset not found.");
          update((w) =>
            pushActivity(
              {
                ...w,
                assets: w.assets.map((a) =>
                  a.id === id ? ({ ...a, ...patch, updatedAt: nowIso() } as DemoAsset) : a,
                ),
              },
              "asset.updated",
              target.kind.toLowerCase(),
              `Updated ${patch.name ?? target.name}`,
            ),
          );
          return ok;
        },
        removeAsset: (id) => {
          const target = get().workspace.assets.find((a) => a.id === id);
          if (!target) return fail("NOT_FOUND", "Asset not found.");
          update((w) =>
            pushActivity(
              {
                ...w,
                assets: w.assets.filter((a) => a.id !== id),
                assignments: w.assignments.filter((a) => a.resourceId !== id),
              },
              "asset.deleted",
              target.kind.toLowerCase(),
              `Deleted ${target.name} (assignments removed)`,
            ),
          );
          return ok;
        },

        // ── Assignments ───────────────────────────────────────────────────
        assign: (beneficiaryId, resourceType, resourceId, allocationPercentage) => {
          const ws = get().workspace;
          const beneficiary = ws.beneficiaries.find((b) => b.id === beneficiaryId);
          if (!beneficiary) return fail("NOT_FOUND", "Beneficiary not found.");
          if (beneficiary.status === "INACTIVE") {
            return fail(
              "BENEFICIARY_INACTIVE",
              "Inactive beneficiaries cannot receive assignments.",
            );
          }
          if (
            ws.assignments.some(
              (a) =>
                a.beneficiaryId === beneficiaryId &&
                a.resourceType === resourceType &&
                a.resourceId === resourceId,
            )
          ) {
            return fail("DUPLICATE", `${beneficiary.name} is already assigned to this resource.`);
          }
          const used = ws.assignments
            .filter((a) => a.resourceType === resourceType && a.resourceId === resourceId)
            .reduce((sum, a) => sum + (a.allocationPercentage ?? 0), 0);
          const remaining = Math.max(0, 100 - used);
          if (allocationPercentage !== null && allocationPercentage > remaining) {
            return fail(
              "ALLOCATION_EXCEEDED",
              `Only ${remaining}% of this resource is still unallocated.`,
              { remaining },
            );
          }
          update((w) =>
            pushActivity(
              {
                ...w,
                assignments: [
                  ...w.assignments,
                  {
                    id: newId("asg"),
                    beneficiaryId,
                    resourceType,
                    resourceId,
                    allocationPercentage,
                    createdAt: nowIso(),
                  },
                ],
              },
              "assignment.created",
              "beneficiary_assignment",
              `Assigned ${beneficiary.name}${allocationPercentage !== null ? ` · ${allocationPercentage}%` : ""}`,
            ),
          );
          return ok;
        },
        unassign: (assignmentId) => {
          update((w) =>
            pushActivity(
              { ...w, assignments: w.assignments.filter((a) => a.id !== assignmentId) },
              "assignment.removed",
              "beneficiary_assignment",
              "Removed a beneficiary assignment",
            ),
          );
          return ok;
        },

        // ── Vault ─────────────────────────────────────────────────────────
        addFolder: (name, parentId = null) => {
          const trimmed = name.trim();
          if (!trimmed) return fail("VALIDATION", "Folder name is required.");
          const ws = get().workspace;
          if (
            ws.folders.some(
              (f) => f.parentId === parentId && f.name.toLowerCase() === trimmed.toLowerCase(),
            )
          ) {
            return fail("DUPLICATE", "A folder with this name already exists here.");
          }
          update((w) => ({
            ...w,
            folders: [...w.folders, { id: newId("fld"), name: trimmed, parentId }],
          }));
          return ok;
        },
        addDemoDocument: (input) => {
          const doc: DemoDocument = {
            id: newId("doc"),
            ...input,
            scanStatus: "PENDING",
            versionCount: 1,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            demoOnly: true,
          };
          update((w) =>
            pushActivity(
              { ...w, documents: [doc, ...w.documents] },
              "document.upload_previewed",
              "document",
              `Previewed upload of “${doc.name}” (demo workspace — not uploaded)`,
            ),
          );
          return { ok: true, details: { id: doc.id } };
        },
        markDocumentScanned: (id) =>
          update((w) => ({
            ...w,
            documents: w.documents.map((d) =>
              d.id === id ? { ...d, scanStatus: "CLEAN", updatedAt: nowIso() } : d,
            ),
          })),
        renameDocument: (id, name) => {
          if (!name.trim()) return fail("VALIDATION", "Name is required.");
          update((w) => ({
            ...w,
            documents: w.documents.map((d) =>
              d.id === id ? { ...d, name: name.trim(), updatedAt: nowIso() } : d,
            ),
          }));
          return ok;
        },
        moveDocument: (id, folderId) => {
          update((w) => ({
            ...w,
            documents: w.documents.map((d) => (d.id === id ? { ...d, folderId } : d)),
          }));
          return ok;
        },
        removeDocument: (id) => {
          const target = get().workspace.documents.find((d) => d.id === id);
          if (!target) return fail("NOT_FOUND", "Document not found.");
          update((w) =>
            pushActivity(
              {
                ...w,
                documents: w.documents.filter((d) => d.id !== id),
                assignments: w.assignments.filter((a) => a.resourceId !== id),
              },
              "document.deleted",
              "document",
              `Deleted “${target.name}” (shares removed, audit retained)`,
            ),
          );
          return ok;
        },
        addDemoVideo: (input) => {
          const video: DemoVideoMessage = {
            id: newId("vid"),
            title: input.title,
            description: input.description,
            deliveryCondition: input.deliveryCondition,
            sizeBytes: input.sizeBytes,
            durationSeconds: 0,
            scanStatus: "PENDING",
            createdAt: nowIso(),
            demoOnly: true,
          };
          update((w) =>
            pushActivity(
              { ...w, videos: [video, ...w.videos] },
              "video.upload_previewed",
              "video_message",
              `Previewed video “${video.title}” (demo workspace — not uploaded)`,
            ),
          );
          return { ok: true, details: { id: video.id } };
        },
        updateVideo: (id, patch) => {
          update((w) => ({
            ...w,
            videos: w.videos.map((v) => (v.id === id ? { ...v, ...patch } : v)),
          }));
          return ok;
        },
        removeVideo: (id) => {
          const target = get().workspace.videos.find((v) => v.id === id);
          if (!target) return fail("NOT_FOUND", "Video not found.");
          update((w) =>
            pushActivity(
              {
                ...w,
                videos: w.videos.filter((v) => v.id !== id),
                assignments: w.assignments.filter((a) => a.resourceId !== id),
              },
              "video.deleted",
              "video_message",
              `Deleted video “${target.title}”`,
            ),
          );
          return ok;
        },

        // ── Legacy plan ───────────────────────────────────────────────────
        ensurePlan: () => {
          const existing = get().workspace.plan;
          if (existing) return existing;
          const plan: DemoLegacyPlan = {
            id: newId("plan"),
            status: "DRAFT",
            version: get().workspace.planVersions.length + 1,
            currentStep: 1,
            stepsData: {},
            lockVersion: 0,
            finalizedAt: null,
            updatedAt: nowIso(),
          };
          update((w) =>
            pushActivity(
              { ...w, plan },
              "plan.created",
              "legacy_plan",
              "Started a new legacy plan draft",
            ),
          );
          return plan;
        },
        savePlanStep: (section, data) => {
          const plan = get().workspace.plan;
          if (!plan) return fail("NOT_FOUND", "No plan draft exists.");
          if (plan.status !== "DRAFT") {
            return fail(
              "INVALID_TRANSITION",
              "Finalized plans are read-only. Create a new draft first.",
            );
          }
          update((w) => ({
            ...w,
            plan: w.plan
              ? {
                  ...w.plan,
                  stepsData: { ...w.plan.stepsData, [section]: data },
                  lockVersion: w.plan.lockVersion + 1,
                  updatedAt: nowIso(),
                }
              : w.plan,
          }));
          return ok;
        },
        setPlanStep: (step) =>
          update((w) => ({ ...w, plan: w.plan ? { ...w.plan, currentStep: step } : w.plan })),
        finalizePlan: ({ acknowledgeIncomplete }) => {
          const ws = get().workspace;
          const plan = ws.plan;
          if (!plan) return fail("NOT_FOUND", "No plan draft exists.");
          if (plan.status !== "DRAFT")
            return fail("INVALID_TRANSITION", "This plan is already finalized.");
          const completeness = getPlanCompleteness(ws);
          if (!completeness.sections["personal-details"].complete) {
            return fail(
              "PERSONAL_DETAILS_REQUIRED",
              "Personal Details must be complete before a plan can be finalized.",
            );
          }
          const incomplete = completeness.incompleteSections.filter(
            (s) => s !== "personal-details",
          );
          if (incomplete.length > 0 && !acknowledgeIncomplete) {
            return fail(
              "PLAN_INCOMPLETE",
              "Some sections are incomplete. Acknowledge them to finalize anyway.",
              { incompleteSections: incomplete },
            );
          }
          const finalizedAt = nowIso();
          update((w) =>
            pushActivity(
              {
                ...w,
                plan: w.plan
                  ? {
                      ...w.plan,
                      status: "FINALIZED",
                      finalizedAt,
                      currentStep: 11,
                      updatedAt: finalizedAt,
                    }
                  : w.plan,
                planVersions: [
                  {
                    id: newId("ver"),
                    versionNumber: plan.version,
                    finalizedAt,
                    acknowledgedIncomplete: incomplete.length > 0,
                    incompleteSections: incomplete,
                  },
                  ...w.planVersions,
                ],
              },
              "plan.finalized",
              "legacy_plan",
              `Finalized legacy plan v${plan.version}${incomplete.length ? ` (acknowledged ${incomplete.length} incomplete section${incomplete.length > 1 ? "s" : ""})` : ""}`,
            ),
          );
          return ok;
        },
        createNewDraft: () => {
          const plan = get().workspace.plan;
          if (!plan) return fail("NOT_FOUND", "No plan exists.");
          if (plan.status === "DRAFT")
            return fail("DRAFT_EXISTS", "You already have a draft in progress.");
          update((w) =>
            pushActivity(
              {
                ...w,
                plan: {
                  id: newId("plan"),
                  status: "DRAFT",
                  version: plan.version + 1,
                  currentStep: 1,
                  stepsData: plan.stepsData,
                  lockVersion: 0,
                  finalizedAt: null,
                  updatedAt: nowIso(),
                },
              },
              "plan.draft_created",
              "legacy_plan",
              `Created draft v${plan.version + 1} from the finalized plan`,
            ),
          );
          return ok;
        },

        // ── Dead Man's Switch ─────────────────────────────────────────────
        configureDms: (config) => {
          const ws = get().workspace;
          const contacts = config.contactIds.filter((id) =>
            ws.beneficiaries.some((b) => b.id === id && b.status !== "INACTIVE"),
          );
          if (contacts.length === 0)
            return fail("VALIDATION", "Choose at least one active trusted contact.");
          const wasInactive = ws.dms.status === "INACTIVE";
          const now = nowIso();
          update((w) =>
            pushActivity(
              pushDmsEvent(
                w,
                {
                  eventType: "CONFIG_CHANGE",
                  previousState: w.dms.status,
                  newState: wasInactive ? "ACTIVE" : w.dms.status,
                  note: `${config.inactivityPeriodDays}-day inactivity · check-in every ${config.checkInFrequencyDays} days`,
                },
                {
                  inactivityPeriodDays: config.inactivityPeriodDays,
                  checkInFrequencyDays: config.checkInFrequencyDays,
                  escalationDelayHours: config.escalationDelayHours,
                  contactIds: contacts,
                  releaseScope: config.releaseScope ?? w.dms.releaseScope,
                  ...(wasInactive
                    ? {
                        lastCheckInAt: now,
                        nextCheckInAt: addHours(now, config.checkInFrequencyDays * 24),
                        currentEscalationStep: 0,
                      }
                    : {}),
                },
              ),
              wasInactive ? "dms.enabled" : "dms.configured",
              "dead_man_switch",
              wasInactive
                ? "Enabled the Dead Man's Switch"
                : "Updated Dead Man's Switch configuration",
            ),
          );
          return ok;
        },
        dmsCheckIn: () => {
          const dms = get().workspace.dms;
          const allowed: DmsStatus[] = ["ACTIVE", "REMINDER_SENT", "GRACE_PERIOD"];
          if (!allowed.includes(dms.status)) {
            return fail(
              "INVALID_TRANSITION",
              "Check-in is only available while the switch is monitoring.",
            );
          }
          const now = nowIso();
          update((w) =>
            pushActivity(
              pushDmsEvent(
                w,
                {
                  eventType: "CHECK_IN",
                  previousState: w.dms.status,
                  newState: "ACTIVE",
                  note: null,
                },
                {
                  lastCheckInAt: now,
                  nextCheckInAt: addHours(now, w.dms.checkInFrequencyDays * 24),
                  currentEscalationStep: 0,
                },
              ),
              "dms.check_in",
              "dead_man_switch",
              "Checked in to the Dead Man's Switch",
            ),
          );
          return ok;
        },
        dmsPause: () => {
          const status = get().workspace.dms.status;
          if (status === "INACTIVE" || status === "PAUSED") {
            return fail("INVALID_TRANSITION", "The switch is not currently monitoring.");
          }
          update((w) =>
            pushActivity(
              pushDmsEvent(
                w,
                { eventType: "PAUSE", previousState: w.dms.status, newState: "PAUSED", note: null },
                {},
              ),
              "dms.paused",
              "dead_man_switch",
              "Paused the Dead Man's Switch",
            ),
          );
          return ok;
        },
        dmsResume: () => {
          if (get().workspace.dms.status !== "PAUSED") {
            return fail("INVALID_TRANSITION", "Only a paused switch can be resumed.");
          }
          const now = nowIso();
          update((w) =>
            pushActivity(
              pushDmsEvent(
                w,
                { eventType: "RESUME", previousState: "PAUSED", newState: "ACTIVE", note: null },
                {
                  lastCheckInAt: now,
                  nextCheckInAt: addHours(now, w.dms.checkInFrequencyDays * 24),
                  currentEscalationStep: 0,
                },
              ),
              "dms.resumed",
              "dead_man_switch",
              "Resumed the Dead Man's Switch",
            ),
          );
          return ok;
        },
        dmsDisable: () => {
          if (get().workspace.dms.status === "INACTIVE")
            return fail("INVALID_TRANSITION", "Already disabled.");
          update((w) =>
            pushActivity(
              pushDmsEvent(
                w,
                {
                  eventType: "CONFIG_CHANGE",
                  previousState: w.dms.status,
                  newState: "INACTIVE",
                  note: "Switch disabled by owner",
                },
                { nextCheckInAt: null, currentEscalationStep: 0 },
              ),
              "dms.disabled",
              "dead_man_switch",
              "Disabled the Dead Man's Switch (re-verified)",
            ),
          );
          return ok;
        },
        dmsCancelEscalation: () => {
          const status = get().workspace.dms.status;
          const allowed: DmsStatus[] = [
            "ESCALATING",
            "RELEASING",
            "RELEASED",
            "GRACE_PERIOD",
            "REMINDER_SENT",
          ];
          if (!allowed.includes(status))
            return fail("INVALID_TRANSITION", "There is no escalation to cancel.");
          const now = nowIso();
          update((w) =>
            pushActivity(
              pushDmsEvent(
                w,
                {
                  eventType: "RECOVERY",
                  previousState: w.dms.status,
                  newState: "ACTIVE",
                  note:
                    w.dms.status === "RELEASED"
                      ? "Recovery — release links revoked"
                      : "Escalation cancelled by owner",
                },
                {
                  lastCheckInAt: now,
                  nextCheckInAt: addHours(now, w.dms.checkInFrequencyDays * 24),
                  currentEscalationStep: 0,
                },
              ),
              "dms.recovered",
              "dead_man_switch",
              "Cancelled the escalation and recovered the switch (re-verified)",
            ),
          );
          return ok;
        },
        dmsSimulateNextStage: () => {
          const dms = get().workspace.dms;
          const next: Partial<
            Record<DmsStatus, { to: DmsStatus; type: DemoDmsEvent["eventType"]; note: string }>
          > = {
            ACTIVE: {
              to: "REMINDER_SENT",
              type: "MISSED_CHECK_IN",
              note: "Simulated: check-in window passed, reminder sent",
            },
            REMINDER_SENT: {
              to: "GRACE_PERIOD",
              type: "MISSED_CHECK_IN",
              note: "Simulated: reminder unanswered, grace period started",
            },
            GRACE_PERIOD: {
              to: "ESCALATING",
              type: "ESCALATION_STEP",
              note: "Simulated: grace period expired, contacting secondary channels",
            },
            ESCALATING: {
              to: "RELEASING",
              type: "ESCALATION_STEP",
              note: "Simulated: escalation steps exhausted",
            },
            RELEASING: {
              to: "RELEASED",
              type: "RELEASE",
              note: "Simulated: release executed — access links queued for trusted contacts",
            },
          };
          const step = next[dms.status];
          if (!step)
            return fail("INVALID_TRANSITION", "Nothing further to simulate from this state.");
          update((w) =>
            pushDmsEvent(
              w,
              {
                eventType: step.type,
                previousState: w.dms.status,
                newState: step.to,
                note: step.note,
              },
              {
                currentEscalationStep:
                  step.to === "ESCALATING" || step.to === "RELEASING"
                    ? w.dms.currentEscalationStep + 1
                    : w.dms.currentEscalationStep,
              },
            ),
          );
          return ok;
        },

        // ── Emergency access ──────────────────────────────────────────────
        configureEmergencyContact: (input) => {
          const ws = get().workspace;
          const beneficiary = ws.beneficiaries.find((b) => b.id === input.beneficiaryId);
          if (!beneficiary) return fail("NOT_FOUND", "Beneficiary not found.");
          if (beneficiary.status === "INACTIVE")
            return fail(
              "BENEFICIARY_INACTIVE",
              "Inactive beneficiaries cannot be emergency contacts.",
            );
          if (input.onTimeout !== "WAIT" && !input.timeoutHours) {
            return fail("VALIDATION", "A timeout is required for automatic decisions.");
          }
          const existing = ws.emergencyContacts.find(
            (c) => c.beneficiaryId === input.beneficiaryId,
          );
          const record: DemoEmergencyContact = {
            id: existing?.id ?? newId("ea_cfg"),
            beneficiaryId: input.beneficiaryId,
            accessScope: input.accessScope ?? existing?.accessScope ?? EMPTY_SCOPE,
            onTimeout: input.onTimeout,
            timeoutHours: input.onTimeout === "WAIT" ? null : input.timeoutHours,
            requestExpiryHours: input.requestExpiryHours,
            accessDurationHours: input.accessDurationHours,
            status: "ACTIVE",
            lastDesignationSentAt: nowIso(),
          };
          update((w) =>
            pushActivity(
              {
                ...w,
                emergencyContacts: existing
                  ? w.emergencyContacts.map((c) => (c.id === existing.id ? record : c))
                  : [...w.emergencyContacts, record],
              },
              existing ? "ea.contact_updated" : "ea.contact_designated",
              "emergency_access_config",
              `${existing ? "Updated" : "Designated"} ${beneficiary.name} as an emergency contact`,
            ),
          );
          return ok;
        },
        removeEmergencyContact: (configId) => {
          update((w) =>
            pushActivity(
              { ...w, emergencyContacts: w.emergencyContacts.filter((c) => c.id !== configId) },
              "ea.contact_removed",
              "emergency_access_config",
              "Removed an emergency contact designation",
            ),
          );
          return ok;
        },
        decideEmergencyRequest: (requestId, decision) => {
          const ws = get().workspace;
          const request = ws.emergencyRequests.find((r) => r.id === requestId);
          if (!request) return fail("NOT_FOUND", "Request not found.");
          if (request.status !== "VERIFIED")
            return fail("INVALID_TRANSITION", "Only verified requests can be decided.");
          const config = ws.emergencyContacts.find((c) => c.id === request.configId);
          const now = nowIso();
          update((w) =>
            pushActivity(
              {
                ...w,
                emergencyRequests: w.emergencyRequests.map((r) =>
                  r.id === requestId
                    ? decision === "APPROVE"
                      ? {
                          ...r,
                          status: "ACTIVE",
                          decidedAt: now,
                          expiresAt: addHours(now, config?.accessDurationHours ?? 72),
                        }
                      : { ...r, status: "DENIED", decidedAt: now }
                    : r,
                ),
              },
              decision === "APPROVE" ? "ea.request_approved" : "ea.request_denied",
              "emergency_access_request",
              decision === "APPROVE"
                ? "Approved an emergency access request (re-verified) — access link queued for delivery"
                : "Denied an emergency access request",
            ),
          );
          return ok;
        },
        revokeEmergencyAccess: (requestId) => {
          const request = get().workspace.emergencyRequests.find((r) => r.id === requestId);
          if (!request || request.status !== "ACTIVE")
            return fail("INVALID_TRANSITION", "Only active access can be revoked.");
          update((w) =>
            pushActivity(
              {
                ...w,
                emergencyRequests: w.emergencyRequests.map((r) =>
                  r.id === requestId ? { ...r, status: "REVOKED" } : r,
                ),
              },
              "ea.access_revoked",
              "emergency_access_request",
              "Revoked active emergency access",
            ),
          );
          return ok;
        },
        simulateEmergencyRequest: (configId) => {
          const ws = get().workspace;
          const config = ws.emergencyContacts.find((c) => c.id === configId);
          if (!config) return fail("NOT_FOUND", "Emergency contact not found.");
          if (
            ws.emergencyRequests.some(
              (r) =>
                r.configId === configId &&
                ["PENDING", "VERIFYING", "VERIFIED", "ACTIVE"].includes(r.status),
            )
          ) {
            return fail("DUPLICATE", "This contact already has an open request.");
          }
          const beneficiary = ws.beneficiaries.find((b) => b.id === config.beneficiaryId);
          const now = nowIso();
          const request: DemoEmergencyRequest = {
            id: newId("ea_req"),
            configId,
            requesterEmail: beneficiary?.email ?? "contact@example.com",
            status: "VERIFIED",
            createdAt: now,
            requestExpiresAt: addHours(now, config.requestExpiryHours),
            decidedAt: null,
            expiresAt: null,
          };
          update((w) => ({
            ...w,
            emergencyRequests: [request, ...w.emergencyRequests],
            notifications: [
              {
                id: newId("ntf"),
                type: "ea.request",
                category: "security",
                title: "Emergency access request awaiting your decision",
                content: `${beneficiary?.name ?? "A contact"} verified their identity and requested emergency access.`,
                channel: "BOTH",
                readAt: null,
                createdAt: now,
              },
              ...w.notifications,
            ],
          }));
          return ok;
        },

        // ── Notifications ─────────────────────────────────────────────────
        markNotificationRead: (id) =>
          update((w) => ({
            ...w,
            notifications: w.notifications.map((n) =>
              n.id === id && !n.readAt ? { ...n, readAt: nowIso() } : n,
            ),
          })),
        markAllNotificationsRead: () =>
          update((w) => ({
            ...w,
            notifications: w.notifications.map((n) => (n.readAt ? n : { ...n, readAt: nowIso() })),
          })),

        // ── Settings & security ───────────────────────────────────────────
        updatePreferences: (patch) =>
          update((w) => ({
            ...w,
            preferences: {
              ...w.preferences,
              ...patch,
              profile: { ...w.preferences.profile, ...(patch.profile ?? {}) },
              notificationPreferences: {
                ...w.preferences.notificationPreferences,
                ...(patch.notificationPreferences ?? {}),
              },
              securityPreferences: {
                ...w.preferences.securityPreferences,
                ...(patch.securityPreferences ?? {}),
              },
            },
          })),
        revokeSession: (sessionId) => {
          const session = get().workspace.security.sessions.find((s) => s.id === sessionId);
          if (!session) return fail("NOT_FOUND", "Session not found.");
          if (session.current)
            return fail("INVALID_TRANSITION", "Sign out to end the current session.");
          update((w) =>
            pushActivity(
              {
                ...w,
                security: {
                  ...w.security,
                  sessions: w.security.sessions.filter((s) => s.id !== sessionId),
                },
              },
              "session.revoked",
              "session",
              `Revoked session on ${session.device} (${session.location})`,
            ),
          );
          return ok;
        },

        // ── AI assistant ──────────────────────────────────────────────────
        appendChatMessage: (message) =>
          update((w) => ({
            ...w,
            chat: [...w.chat, { id: newId("msg"), createdAt: nowIso(), ...message }].slice(-40),
          })),
        clearChat: () => update((w) => ({ ...w, chat: [] })),
      };
    },
    {
      name: DEMO_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: (state) => ({ workspace: state.workspace }),
    },
  ),
);

/** Convenience selectors used across pages. */
export const selectWorkspace = (state: DemoStore) => state.workspace;
export const selectHydrated = (state: DemoStore) => state.hydrated;

export type { AssetKind };
