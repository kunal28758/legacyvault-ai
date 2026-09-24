import { withApi } from "@/lib/api/with-api";
import * as adminService from "@/lib/services/admin.service";

/**
 * What needs an operator's attention (ADR-006, ADR-014 § 6): dead-lettered
 * jobs and system grants whose link was minted but never delivered.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: "default",
    auditAction: "admin.operations_viewed",
    auditResourceType: "job",
  },
  async ({ user }) => adminService.operations(user),
);
