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
 */
export const maxDuration = 120;

export const POST = withApi<AssistantMessageBody>(
  {
    auth: "user",
    rateLimit: "ai",
    schema: { body: assistantMessageBodySchema },
    auditAction: "ai.assistant_message",
    auditResourceType: "ai",
  },
  async ({ user, body, request }) => {
    const { stream, onComplete } = await assistantService.streamAssistantReply(
      user,
      body,
      request.signal,
    );
    return ndjsonStreamResponse(stream, onComplete);
  },
);
