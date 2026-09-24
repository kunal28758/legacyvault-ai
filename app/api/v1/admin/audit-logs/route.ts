import { withApi } from "@/lib/api/with-api";
import * as adminService from "@/lib/services/admin.service";
import { adminAuditQuerySchema, type AdminAuditQuery } from "@/lib/validators/admin.validators";

/**
 * The platform-wide audit trail (FR-P005).
 *
 * `audit_log` is append-only and its metadata was redacted when written, so
 * this returns rows as stored. Reading it is a privileged act and is audited.
 */
export const GET = withApi<undefined, AdminAuditQuery>(
  {
    auth: "admin",
    rateLimit: "default",
    schema: { query: adminAuditQuerySchema },
    auditAction: "admin.audit_viewed",
    auditResourceType: "audit_log",
  },
  async ({ user, query }) => adminService.listAudit(user, query),
);
