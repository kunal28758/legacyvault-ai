import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import * as activityService from "@/lib/services/activity.service";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** One record's history (e.g. an asset's Activity section). Still the caller's rows only. */
  resourceId: z.uuid().optional(),
});

type Query = z.infer<typeof querySchema>;

/** The caller's own audit rows, for the Security Center. */
export const GET = withApi<undefined, Query>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { query: querySchema },
    auditAction: "user.activity_listed",
    auditResourceType: "audit_log",
  },
  async ({ user, query }) => activityService.listActivity(user, query),
);
