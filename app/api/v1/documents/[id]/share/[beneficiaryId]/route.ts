import { withApi } from "@/lib/api/with-api";
import * as documentService from "@/lib/services/document.service";
import { documentShareParamSchema } from "@/lib/validators/document.validators";

type ShareParams = { id: string; beneficiaryId: string };

export const DELETE = withApi<undefined, undefined, ShareParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentShareParamSchema },
    auditAction: "document.unshared",
    auditResourceType: "document",
  },
  async ({ user, params, correlationId }) =>
    documentService.unshareDocument(user, params.id, params.beneficiaryId, correlationId),
);
