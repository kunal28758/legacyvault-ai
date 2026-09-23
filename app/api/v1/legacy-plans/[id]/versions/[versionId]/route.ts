import { withApi } from "@/lib/api/with-api";
import * as planService from "@/lib/services/legacy-plan.service";
import { planVersionParamSchema } from "@/lib/validators/legacy-plan.validators";

type VersionParams = { id: string; versionId: string };

/** One finalized snapshot, read-only by construction — versions have no write path. */
export const GET = withApi<undefined, undefined, VersionParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: planVersionParamSchema },
    auditAction: "plan.version_read",
    auditResourceType: "legacy_plan",
  },
  async ({ user, params }) => planService.getVersion(user, params.id, params.versionId),
);
