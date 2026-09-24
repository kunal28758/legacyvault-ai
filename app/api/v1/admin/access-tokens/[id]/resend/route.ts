import { withApi } from "@/lib/api/with-api";
import * as adminService from "@/lib/services/admin.service";
import {
  adminActionBodySchema,
  adminTokenIdParamSchema,
  type AdminActionBody,
} from "@/lib/validators/admin.validators";

type IdParams = { id: string };

/**
 * Recovery for a dead-lettered system delivery (ADR-014 § 6).
 *
 * The old secret cannot be resent — it was never stored — so this queues a run
 * that revokes the undelivered link and mints exactly one replacement.
 */
export const POST = withApi<AdminActionBody, undefined, IdParams>(
  {
    auth: "admin",
    rateLimit: "sensitive",
    reverification: "strict",
    schema: { params: adminTokenIdParamSchema, body: adminActionBodySchema },
    auditAction: "admin.access_token_resent",
    auditResourceType: "access_token",
  },
  async ({ user, params, correlationId }) =>
    adminService.resendAccessToken(user, params.id, correlationId),
);
