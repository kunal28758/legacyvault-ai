import { ndjsonStreamResponse } from "@/lib/api/ndjson-stream";
import { withApi } from "@/lib/api/with-api";
import * as assistantService from "@/lib/services/ai/assistant.service";
import {
  assistantMessageBodySchema,
  type AssistantMessageBody,
} from "@/lib/validators/ai.validators";

/**
 * The assistant (api-contracts.md § AI, ADR-016 § 2).
 *
 * Streams the reply as NDJSON. `history` is the browser's session-scoped
 * record of prior turns; neither it nor the new message is stored. Closing the
 * tab (or pressing Stop) aborts the request, which cancels the model call.
 *
 * `attachmentIds` name vault documents the user attached; the service checks
 * ownership and type for each before anything is read. A scanned (image-only)
 * PDF may need OCR first, so the limit matches the document-analysis routes.
 */
export const maxDuration = 180;

export const POST = withApi<AssistantMessageBody>(
  {
    auth: "user",
    rateLimit: "ai",
    schema: { body: assistantMessageBodySchema },
    auditAction: "ai.assistant_message",
    auditResourceType: "ai",
  },
  async ({ user, body, request, correlationId }) => {
    const { stream, onComplete } = await assistantService.streamAssistantReply(
      user,
      body,
      correlationId,
      request.signal,
    );
    return ndjsonStreamResponse(stream, onComplete);
  },
);
