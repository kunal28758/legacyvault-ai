import { withApi } from "@/lib/api/with-api";
import * as documentService from "@/lib/services/document.service";
import { documentIdParamSchema } from "@/lib/validators/document.validators";

type IdParams = { id: string };

/** Same signing path as download, rendered inline instead of saved. */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema },
    auditAction: "document.accessed",
    auditResourceType: "document",
  },
  async ({ user, params, correlationId }) =>
    documentService.accessDocument(user, params.id, { disposition: "inline" }, correlationId),
);
