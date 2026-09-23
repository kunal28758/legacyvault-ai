import { withApi } from "@/lib/api/with-api";
import * as portal from "@/lib/services/access-portal.service";
import { accessIdParamSchema } from "@/lib/validators/access-portal.validators";

type IdParams = { id: string };

/** Document metadata — only for a document named by the grant's scope. */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "access-cookie",
    rateLimit: "tokenAccess",
    schema: { params: accessIdParamSchema },
  },
  async ({ grant, params, correlationId }) =>
    portal.documentDetail(grant, params.id, correlationId),
);
