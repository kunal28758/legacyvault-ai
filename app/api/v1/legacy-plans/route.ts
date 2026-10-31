import { withApi } from "@/lib/api/with-api";
import * as planService from "@/lib/services/legacy-plan.service";

/**
 * Legacy plans (api-contracts.md § Legacy Plans).
 *
 * `GET` returns the overview the plan page renders: the current plan, every
 * plan the caller owns and the finalized version history. `POST` opens a draft
 * through `create_legacy_plan()`, which answers 409 `DRAFT_EXISTS` when one is
 * already open — a partial unique index enforces the same rule.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: "default",
    auditAction: "plan.listed",
    auditResourceType: "legacy_plan",
  },
  async ({ user }) => planService.getOverview(user),
);

export const POST = withApi(
  {
    auth: "user",
    maintenanceGate: "legacy-plan",
    rateLimit: "default",
    auditAction: "plan.created",
    auditResourceType: "legacy_plan",
  },
  async ({ user, correlationId }) => planService.createPlan(user, correlationId),
);
