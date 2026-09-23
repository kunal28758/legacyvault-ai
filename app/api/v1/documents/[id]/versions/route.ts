import { withApi } from "@/lib/api/with-api";
import * as documentService from "@/lib/services/document.service";
import { documentIdParamSchema } from "@/lib/validators/document.validators";

type IdParams = { id: string };

export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema },
    auditAction: "document.versions_listed",
    auditResourceType: "document",
  },
  async ({ user, params }) => {
    const detail = await documentService.getDocument(user, params.id);
    return { items: detail.versions };
  },
);
