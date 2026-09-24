import { withApi } from "@/lib/api/with-api";
import * as accountService from "@/lib/services/account.service";

/**
 * Exports everything the account holds (api-contracts.md § Users).
 *
 * This is the one read that returns the decrypted sensitive fields in bulk, so
 * it is re-verified, rate-limited as a sensitive operation and audited with
 * counts only — never with the values.
 */
/**
 * A full export reads every table the account owns and decrypts its sensitive fields.
 *
 * The platform default is far shorter than this work can take, and a
 * truncated run is worse than a slow one.
 */
export const maxDuration = 120;

export const GET = withApi(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "strict",
  },
  async ({ user, correlationId }) => accountService.exportData(user, correlationId),
);
