import { withApi } from "@/lib/api/with-api";
import * as documentAiService from "@/lib/services/ai/document-ai.service";
import {
  documentAnalyzeBodySchema,
  documentIdParamSchema,
  type DocumentAnalyzeBody,
} from "@/lib/validators/ai.validators";

type Params = { id: string };

/**
 * Document intelligence for one document (ADR-008 § 5, ADR-016).
 *
 * GET returns the stored results for the document's current version; POST
 * produces one (summary, extraction, explanation, text/OCR or translation),
 * returning a stored result unless `regenerate` is set. Ownership is checked
 * against the document row before anything is read from storage.
 */
export const maxDuration = 180;

export const GET = withApi<undefined, undefined, Params>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema },
    auditAction: "ai.document_analyses_listed",
    auditResourceType: "document",
  },
  async ({ user, params }) => documentAiService.listAnalyses(user, params.id),
);

export const POST = withApi<DocumentAnalyzeBody, undefined, Params>(
  {
    auth: "user",
    rateLimit: "ai",
    schema: { params: documentIdParamSchema, body: documentAnalyzeBodySchema },
    auditAction: "ai.document_analyzed",
    auditResourceType: "document",
  },
  async ({ user, params, body, correlationId, request }) =>
    documentAiService.analyzeDocument(user, params.id, body, correlationId, request.signal),
);
