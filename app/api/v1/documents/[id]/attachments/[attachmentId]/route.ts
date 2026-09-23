import { withApi } from "@/lib/api/with-api";
import * as documentService from "@/lib/services/document.service";
import { documentAttachmentParamSchema } from "@/lib/validators/document.validators";

type AttachmentParams = { id: string; attachmentId: string };

export const DELETE = withApi<undefined, undefined, AttachmentParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentAttachmentParamSchema },
    auditAction: "document.detached",
    auditResourceType: "document",
  },
  async ({ user, params, correlationId }) =>
    documentService.detachDocument(user, params.id, params.attachmentId, correlationId),
);
