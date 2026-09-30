import { withApi } from "@/lib/api/with-api";
import * as documentAiService from "@/lib/services/ai/document-ai.service";
import {
  documentCompareBodySchema,
  type DocumentCompareBody,
} from "@/lib/validators/ai.validators";

/**
 * Compares two of the caller's documents. Both are ownership-checked before
 * either is read; each side of every difference is grounded against its own
 * document. The comparison is returned, not stored.
 */
export const maxDuration = 180;

export const POST = withApi<DocumentCompareBody>(
  {
    auth: "user",
    rateLimit: "ai",
    schema: { body: documentCompareBodySchema },
    auditAction: "ai.documents_compared",
    auditResourceType: "document",
  },
  async ({ user, body, correlationId, request }) =>
    documentAiService.compareDocuments(user, body.documentIds, correlationId, request.signal),
);
