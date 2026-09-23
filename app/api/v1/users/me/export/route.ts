import { withApi } from "@/lib/api/with-api";
import * as accountService from "@/lib/services/account.service";

/**
 * Exports everything the account holds (api-contracts.md § Users).
 *
 * This is the one read that returns the decrypted sensitive fields in bulk, so
 * it is re-verified, rate-limited as a sensitive operation and audited with
 * counts only — never with the values.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "strict",
  },
  async ({ user, correlationId }) => accountService.exportData(user, correlationId),
);
