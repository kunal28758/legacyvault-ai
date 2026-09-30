import { ndjsonStreamResponse } from "@/lib/api/ndjson-stream";
import { withApi } from "@/lib/api/with-api";
import * as documentAiService from "@/lib/services/ai/document-ai.service";
import {
  documentAskBodySchema,
  documentIdParamSchema,
  type DocumentAskBody,
} from "@/lib/validators/ai.validators";

type Params = { id: string };

/**
 * A grounded, streamed answer to a question about one document. When the
 * document does not say, the answer says so. Nothing is stored.
 */
export const maxDuration = 120;

export const POST = withApi<DocumentAskBody, undefined, Params>(
  {
    auth: "user",
    rateLimit: "ai",
    schema: { params: documentIdParamSchema, body: documentAskBodySchema },
    auditAction: "ai.document_question",
    auditResourceType: "document",
  },
  async ({ user, params, body, request }) => {
    const { stream, onComplete } = await documentAiService.askDocument(
      user,
      params.id,
      body,
      request.signal,
    );
    return ndjsonStreamResponse(stream, onComplete);
  },
);
