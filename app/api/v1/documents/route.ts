import { withApi } from "@/lib/api/with-api";
import * as documentService from "@/lib/services/document.service";
import {
  documentListQuerySchema,
  type DocumentListQuery,
} from "@/lib/validators/document.validators";

/** Vault documents (api-contracts.md § Documents). */
export const GET = withApi<undefined, DocumentListQuery>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { query: documentListQuerySchema },
    auditAction: "document.listed",
    auditResourceType: "document",
  },
  async ({ user, query }) => documentService.listDocuments(user, query),
);
