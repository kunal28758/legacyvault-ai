import { withApi } from "@/lib/api/with-api";
import * as adminService from "@/lib/services/admin.service";
import {
  adminUserListQuerySchema,
  type AdminUserListQuery,
} from "@/lib/validators/admin.validators";

/** Platform user list and search (FR-P002). Counts and states only. */
export const GET = withApi<undefined, AdminUserListQuery>(
  {
    auth: "admin",
    rateLimit: "default",
    schema: { query: adminUserListQuerySchema },
    auditAction: "admin.users_listed",
    auditResourceType: "users",
  },
  async ({ user, query }) => adminService.listUsers(user, query),
);
