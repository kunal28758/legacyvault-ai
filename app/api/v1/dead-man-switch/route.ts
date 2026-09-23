import { withApi } from "@/lib/api/with-api";
import * as dmsService from "@/lib/services/dms.service";
import { dmsConfigureBodySchema, type DmsConfigureBody } from "@/lib/validators/dms.validators";

/**
 * Dead Man's Switch (api-contracts.md § Dead Man's Switch).
 *
 * `GET` returns the switch with its contacts and recent events, or null when
 * one has never been configured. `POST` configures or reconfigures it through
 * `dms_configure()`, which validates the ranges, the contacts and the release
 * scope inside the transaction.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: "default",
    auditAction: "dms.read",
    auditResourceType: "dead_man_switch",
  },
  async ({ user }) => dmsService.getSwitch(user),
);

export const POST = withApi<DmsConfigureBody>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: dmsConfigureBodySchema },
    auditAction: "dms.configured",
    auditResourceType: "dead_man_switch",
  },
  async ({ user, body, correlationId }) => dmsService.configure(user, body, correlationId),
);
