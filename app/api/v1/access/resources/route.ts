import { withApi } from "@/lib/api/with-api";
import * as portal from "@/lib/services/access-portal.service";

/** Everything this link covers, and nothing else. */
export const GET = withApi(
  { auth: "access-cookie", rateLimit: "tokenAccess" },
  async ({ grant, correlationId }) => portal.listResources(grant, correlationId),
);
