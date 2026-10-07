import { withApi } from "@/lib/api/with-api";
import * as accessService from "@/lib/services/access.service";

/**
 * Every access link of the owner's that is still live (Security Centre).
 *
 * Read through the owner's own client, so RLS limits it to their links, and
 * selected by column, so neither the token hash nor a verification code hash
 * can be part of it. Revocation stays on the per-beneficiary endpoint.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: "default",
    auditAction: "access.links_listed",
    auditResourceType: "access_token",
  },
  async ({ user }) => accessService.listLiveLinks(user),
);
