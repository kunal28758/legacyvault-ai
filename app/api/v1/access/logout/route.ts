import { jsonSuccess, withApi } from "@/lib/api/with-api";
import { optionalAccessGrant } from "@/lib/auth/require-access-grant";
import * as portal from "@/lib/services/access-portal.service";
import { ACCESS_COOKIE_NAME, accessCookieOptions } from "@/lib/security/access-cookie";

/**
 * Ends the access session.
 *
 * Deliberately `public` rather than `access-cookie`: signing out must work even
 * when the cookie has already lapsed, and it must never answer 401.
 */
export const POST = withApi(
  { auth: "public", rateLimit: "tokenAccess" },
  async ({ correlationId }) => {
    await portal.logout(await optionalAccessGrant(), correlationId);
    const response = jsonSuccess({ ok: true }, { correlationId });
    response.cookies.set(ACCESS_COOKIE_NAME, "", accessCookieOptions(0));
    return response;
  },
);
