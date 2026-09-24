import { withApi } from "@/lib/api/with-api";
import * as adminService from "@/lib/services/admin.service";
import {
  adminRoleBodySchema,
  adminUserIdParamSchema,
  type AdminRoleBody,
} from "@/lib/validators/admin.validators";

type IdParams = { id: string };

/**
 * Assigns or revokes Super Admin (FR-P004).
 *
 * Re-verified, because it changes who can do this. The service refuses a
 * self-change and refuses to remove the last operator.
 */
export const PATCH = withApi<AdminRoleBody, undefined, IdParams>(
  {
    auth: "admin",
    rateLimit: "sensitive",
    reverification: "strict",
    schema: { params: adminUserIdParamSchema, body: adminRoleBodySchema },
    auditAction: "admin.role_changed",
    auditResourceType: "users",
  },
  async ({ user, params, body, correlationId }) =>
    adminService.setRole(user, params.id, body.role, correlationId),
);
