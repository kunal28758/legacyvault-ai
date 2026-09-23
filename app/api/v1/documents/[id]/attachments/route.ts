import { withApi } from "@/lib/api/with-api";
import * as documentService from "@/lib/services/document.service";
import {
  documentAttachBodySchema,
  documentIdParamSchema,
  type DocumentAttachBody,
} from "@/lib/validators/document.validators";

type IdParams = { id: string };

export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema },
    auditAction: "document.attachments_listed",
    auditResourceType: "document",
  },
  async ({ user, params }) => {
    const detail = await documentService.getDocument(user, params.id);
    return { items: detail.attachments };
  },
);

/** `attach_document()` — both the document and the target must be the caller's. */
export const POST = withApi<DocumentAttachBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema, body: documentAttachBodySchema },
    auditAction: "document.attached",
    auditResourceType: "document",
  },
  async ({ user, params, body, correlationId }) =>
    documentService.attachDocument(user, params.id, body, correlationId),
);
