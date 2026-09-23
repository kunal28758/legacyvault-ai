import { withApi } from "@/lib/api/with-api";
import * as portal from "@/lib/services/access-portal.service";
import { accessSectionParamSchema } from "@/lib/validators/access-portal.validators";

type SectionParams = { section: string };

/** One section of the owner's latest finalized plan version (FR-I012, FR-J001). */
export const GET = withApi<undefined, undefined, SectionParams>(
  {
    auth: "access-cookie",
    rateLimit: "tokenAccess",
    schema: { params: accessSectionParamSchema },
  },
  async ({ grant, params, correlationId }) =>
    portal.planSection(grant, params.section, correlationId),
);
