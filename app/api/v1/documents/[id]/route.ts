import { withApi } from "@/lib/api/with-api";
import * as documentService from "@/lib/services/document.service";
import {
  documentDeleteBodySchema,
  documentIdParamSchema,
  documentUpdateBodySchema,
  type DocumentUpdateBody,
} from "@/lib/validators/document.validators";

type IdParams = { id: string };
type DeleteBody = { confirmed: true };

export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema },
    auditAction: "document.read",
    auditResourceType: "document",
  },
  async ({ user, params }) => documentService.getDocument(user, params.id),
);

/** Class A metadata only: rename, or move between folders. */
export const PATCH = withApi<DocumentUpdateBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema, body: documentUpdateBodySchema },
    auditAction: "document.updated",
    auditResourceType: "document",
  },
  async ({ user, params, body, correlationId }) =>
    documentService.updateDocument(user, params.id, body, correlationId),
);

/**
 * `delete_document()` — shares and attachments removed, row soft-deleted and an
 * object-removal job queued, all in one transaction.
 */
export const DELETE = withApi<DeleteBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema, body: documentDeleteBodySchema },
    auditAction: "document.deleted",
    auditResourceType: "document",
  },
  async ({ user, params, correlationId }) =>
    documentService.deleteDocument(user, params.id, correlationId),
);
