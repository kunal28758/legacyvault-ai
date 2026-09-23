import { withApi } from "@/lib/api/with-api";
import * as emergencyPublic from "@/lib/services/emergency-public.service";
import { eaRequestIdParamSchema } from "@/lib/validators/emergency-access.validators";

type IdParams = { id: string };

/** The state of a request, and nothing else about it. */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "public",
    rateLimit: "tokenAccess",
    schema: { params: eaRequestIdParamSchema },
  },
  async ({ params }) => emergencyPublic.requestStatus(params.id),
);
