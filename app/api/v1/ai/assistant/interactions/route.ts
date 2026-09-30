import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import * as assistantService from "@/lib/services/ai/assistant.service";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
type Query = z.infer<typeof querySchema>;

/**
 * The caller's sanitized AI usage records (api-contracts.md § AI). Never
 * conversation content — none is stored.
 */
export const GET = withApi<undefined, Query>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { query: querySchema },
    auditAction: "ai.interactions_listed",
    auditResourceType: "ai_interaction",
  },
  async ({ user, query }) => assistantService.listInteractions(user, query.limit),
);
