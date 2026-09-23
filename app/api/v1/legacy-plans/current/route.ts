import { withApi } from "@/lib/api/with-api";
import * as planService from "@/lib/services/legacy-plan.service";

/**
 * The caller's open draft, created on first use.
 *
 * The wizard needs exactly one call on mount; resolving "find or create" on the
 * server keeps the two-tab race off the client, where a 409 `DRAFT_EXISTS`
 * would be unactionable.
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: "default",
    auditAction: "plan.draft_opened",
    auditResourceType: "legacy_plan",
  },
  async ({ user, correlationId }) => planService.getOrCreateDraft(user, correlationId),
);
