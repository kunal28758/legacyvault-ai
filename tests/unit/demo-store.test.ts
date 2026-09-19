import { beforeEach, describe, expect, it } from "vitest";

import { ids } from "@/lib/demo/seed";
import { getPlanCompleteness, readiness } from "@/lib/demo/selectors";
import { useDemoStore } from "@/lib/demo/store";

/**
 * The demo workspace mirrors the invariants the guarded PostgreSQL functions
 * enforce (allocation ≤ 100 %, one DRAFT plan, finalization rules, state
 * machines). These tests pin that behaviour so the UI demonstrates the real
 * rules until the API replaces the store.
 */
describe("demo workspace store", () => {
  beforeEach(() => {
    useDemoStore.getState().resetWorkspace();
  });

  it("rejects duplicate beneficiary emails and inactive assignments", () => {
    const store = useDemoStore.getState();
    const dup = store.addBeneficiary({
      name: "Someone",
      relationship: "Friend",
      email: "PRIYA.MEHTA@example.com",
      phone: null,
      notes: null,
    });
    expect(dup.ok).toBe(false);
    expect(dup.code).toBe("DUPLICATE_EMAIL");

    store.setBeneficiaryStatus(ids.advisor, "INACTIVE");
    const assign = useDemoStore.getState().assign(ids.advisor, "PHYSICAL_ASSET", ids.phyCar, 10);
    expect(assign.ok).toBe(false);
    expect(assign.code).toBe("BENEFICIARY_INACTIVE");
  });

  it("enforces Σ allocation ≤ 100 % per resource", () => {
    const store = useDemoStore.getState();
    // Insurance policy already has 60 + 20 + 20 = 100 %
    const over = store.assign(ids.advisor, "FINANCIAL_ASSET", ids.finInsurance, 5);
    expect(over.ok).toBe(false);
    expect(over.code).toBe("ALLOCATION_EXCEEDED");
    expect(over.details?.remaining).toBe(0);

    // Car has no assignments yet
    expect(store.assign(ids.advisor, "PHYSICAL_ASSET", ids.phyCar, 70).ok).toBe(true);
    const second = useDemoStore.getState().assign(ids.son, "PHYSICAL_ASSET", ids.phyCar, 40);
    expect(second.ok).toBe(false);
    expect(second.details?.remaining).toBe(30);
  });

  it("removing a beneficiary cascades assignments and contact roles", () => {
    const store = useDemoStore.getState();
    expect(store.workspace.dms.contactIds).toContain(ids.spouse);
    store.removeBeneficiary(ids.spouse);
    const ws = useDemoStore.getState().workspace;
    expect(ws.beneficiaries.some((b) => b.id === ids.spouse)).toBe(false);
    expect(ws.assignments.some((a) => a.beneficiaryId === ids.spouse)).toBe(false);
    expect(ws.dms.contactIds).not.toContain(ids.spouse);
  });

  it("requires Personal Details and an acknowledgement to finalize an incomplete plan", () => {
    const store = useDemoStore.getState();
    const before = getPlanCompleteness(store.workspace);
    expect(before.sections["personal-details"].complete).toBe(true);
    expect(before.incompleteSections.length).toBeGreaterThan(0);

    const blocked = store.finalizePlan({ acknowledgeIncomplete: false });
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe("PLAN_INCOMPLETE");

    const done = useDemoStore.getState().finalizePlan({ acknowledgeIncomplete: true });
    expect(done.ok).toBe(true);
    const ws = useDemoStore.getState().workspace;
    expect(ws.plan?.status).toBe("FINALIZED");
    expect(ws.planVersions[0].acknowledgedIncomplete).toBe(true);

    // Only one draft at a time; a new draft continues the version count.
    expect(useDemoStore.getState().createNewDraft().ok).toBe(true);
    expect(useDemoStore.getState().createNewDraft().code).toBe("DRAFT_EXISTS");
    expect(useDemoStore.getState().workspace.plan?.version).toBe(2);
  });

  it("refuses to finalize without personal details", () => {
    const store = useDemoStore.getState();
    store.savePlanStep("personal-details", {});
    const result = useDemoStore.getState().finalizePlan({ acknowledgeIncomplete: true });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PERSONAL_DETAILS_REQUIRED");
  });

  it("walks the Dead Man's Switch state machine and recovers", () => {
    const store = useDemoStore.getState();
    expect(store.workspace.dms.status).toBe("ACTIVE");
    for (const expected of [
      "REMINDER_SENT",
      "GRACE_PERIOD",
      "ESCALATING",
      "RELEASING",
      "RELEASED",
    ]) {
      expect(useDemoStore.getState().dmsSimulateNextStage().ok).toBe(true);
      expect(useDemoStore.getState().workspace.dms.status).toBe(expected);
    }
    expect(useDemoStore.getState().dmsSimulateNextStage().ok).toBe(false);
    expect(useDemoStore.getState().dmsCheckIn().ok).toBe(false);
    expect(useDemoStore.getState().dmsCancelEscalation().ok).toBe(true);
    expect(useDemoStore.getState().workspace.dms.status).toBe("ACTIVE");
    expect(useDemoStore.getState().dmsPause().ok).toBe(true);
    expect(useDemoStore.getState().dmsResume().ok).toBe(true);
    expect(useDemoStore.getState().dmsDisable().ok).toBe(true);
    expect(useDemoStore.getState().workspace.dms.status).toBe("INACTIVE");
  });

  it("only decides VERIFIED emergency requests and revokes active access", () => {
    const store = useDemoStore.getState();
    expect(store.decideEmergencyRequest("ea_req_0", "APPROVE").ok).toBe(false);
    expect(store.decideEmergencyRequest(ids.eaRequest, "APPROVE").ok).toBe(true);
    const active = useDemoStore
      .getState()
      .workspace.emergencyRequests.find((r) => r.id === ids.eaRequest);
    expect(active?.status).toBe("ACTIVE");
    expect(active?.expiresAt).toBeTruthy();
    expect(useDemoStore.getState().revokeEmergencyAccess(ids.eaRequest).ok).toBe(true);
    expect(useDemoStore.getState().revokeEmergencyAccess(ids.eaRequest).ok).toBe(false);
  });

  it("computes a bounded readiness score", () => {
    const score = readiness(useDemoStore.getState().workspace);
    expect(score.score).toBeGreaterThan(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(score.items.reduce((s, i) => s + i.weight, 0)).toBe(100);
  });
});
