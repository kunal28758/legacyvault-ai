import { withApi } from "@/lib/api/with-api";
import * as documentAiService from "@/lib/services/ai/document-ai.service";

/**
 * Whether AI features can run here, and which provider answers. The panels
 * use it to explain an unconfigured environment instead of failing on click.
 * No key, model secret or quota is ever part of the answer.
 */
export const GET = withApi(
  { auth: "user", rateLimit: "default", auditAction: "ai.status_read", auditResourceType: "ai" },
  async () => documentAiService.getAvailability(),
);
