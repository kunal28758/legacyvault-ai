import { withApi } from "@/lib/api/with-api";
import * as adminService from "@/lib/services/admin.service";
import { adminUserIdParamSchema } from "@/lib/validators/admin.validators";

type IdParams = { id: string };

/**
 * One account, as an operator may see it (FR-P002, FR-P012).
 *
 * Counts, protection state and the user's own recent audit rows — never the
 * contents of their vault. The read is itself audited.
 */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "admin",
    rateLimit: "default",
    schema: { params: adminUserIdParamSchema },
    auditAction: "admin.user_viewed",
    auditResourceType: "users",
  },
  async ({ user, params }) => adminService.getUser(user, params.id),
);
