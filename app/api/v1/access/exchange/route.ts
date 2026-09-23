import { NextResponse } from "next/server";

import { jsonSuccess, withApi } from "@/lib/api/with-api";
import * as portal from "@/lib/services/access-portal.service";
import { ACCESS_COOKIE_NAME, accessCookieOptions } from "@/lib/security/access-cookie";
import { exchangeBodySchema, type ExchangeBody } from "@/lib/validators/access-portal.validators";

/**
 * Exchanges an emailed token for the access cookie (ADR-014 § 3).
 *
 * Public by necessity and therefore rate-limited by IP. The plaintext arrives
 * in the body, is compared as a hash, and never appears in the response, the
 * path or a log line.
 */
export const POST = withApi<ExchangeBody>(
  {
    auth: "public",
    rateLimit: "accessExchange",
    schema: { body: exchangeBodySchema },
    auditAction: "access.exchanged",
    auditResourceType: "access_token",
  },
  async ({ body, correlationId }) => {
    const { cookie, grant } = await portal.exchange(body.token, correlationId);
    const response = jsonSuccess(grant, { correlationId });
    response.cookies.set(ACCESS_COOKIE_NAME, cookie.value, accessCookieOptions(cookie.maxAge));
    return response as NextResponse;
  },
);
