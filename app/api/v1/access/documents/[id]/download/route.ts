import { withApi } from "@/lib/api/with-api";
import * as portal from "@/lib/services/access-portal.service";
import { accessIdParamSchema } from "@/lib/validators/access-portal.validators";

type IdParams = { id: string };

/**
 * A signed download URL, valid for minutes.
 *
 * The bytes are never proxied through the application and the URL is never
 * cached: each request mints its own and the read is audited.
 */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "access-cookie",
    rateLimit: "tokenAccess",
    schema: { params: accessIdParamSchema },
    auditAction: "access.document_downloaded",
    auditResourceType: "document",
  },
  async ({ grant, params, correlationId }) =>
    portal.documentDownload(grant, params.id, correlationId),
);
