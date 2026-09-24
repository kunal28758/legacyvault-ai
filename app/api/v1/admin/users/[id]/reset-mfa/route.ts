import { withApi } from "@/lib/api/with-api";
import * as adminService from "@/lib/services/admin.service";
import {
  adminActionBodySchema,
  adminUserIdParamSchema,
  type AdminActionBody,
} from "@/lib/validators/admin.validators";

type IdParams = { id: string };

/**
 * Clears a user's second factors (FR-P007).
 *
 * This lowers someone else's account security, so it is re-verified, audited,
 * and the affected user is notified.
 */
export const POST = withApi<AdminActionBody, undefined, IdParams>(
  {
    auth: "admin",
    rateLimit: "sensitive",
    reverification: "strict",
    schema: { params: adminUserIdParamSchema, body: adminActionBodySchema },
    auditAction: "admin.mfa_reset",
    auditResourceType: "users",
  },
  async ({ user, params, correlationId }) => adminService.resetMfa(user, params.id, correlationId),
);
