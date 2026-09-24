import { withApi } from "@/lib/api/with-api";
import * as adminService from "@/lib/services/admin.service";
import {
  adminActionBodySchema,
  adminUserIdParamSchema,
  type AdminActionBody,
} from "@/lib/validators/admin.validators";

type IdParams = { id: string };

/** Lifts a Clerk lockout after failed sign-ins (FR-P007). */
export const POST = withApi<AdminActionBody, undefined, IdParams>(
  {
    auth: "admin",
    rateLimit: "sensitive",
    schema: { params: adminUserIdParamSchema, body: adminActionBodySchema },
    auditAction: "admin.user_unlocked",
    auditResourceType: "users",
  },
  async ({ user, params, correlationId }) =>
    adminService.unlockUser(user, params.id, correlationId),
);
