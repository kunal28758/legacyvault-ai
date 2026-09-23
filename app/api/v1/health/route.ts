import { NextResponse } from "next/server";

import { withApi } from "@/lib/api/with-api";
import { getOptionalUser } from "@/lib/auth/require-user";
import { getEnvGroup } from "@/lib/config/env";
import { getHealth } from "@/lib/observability/health";

/**
 * Health check (task T030, ADR-010).
 *
 * Public callers get `{ status }` only — an anonymous probe must not be able to
 * enumerate which dependency is failing. Operators (cron bearer token or a
 * Super Admin session) get the component breakdown.
 */
export const dynamic = "force-dynamic";

async function isOperator(request: Request): Promise<boolean> {
  const provided = request.headers.get("authorization");
  if (provided) {
    try {
      if (provided === `Bearer ${getEnvGroup("cron").CRON_SECRET}`) return true;
    } catch {
      // CRON_SECRET not configured locally — fall through to the session check.
    }
  }
  const user = await getOptionalUser().catch(() => null);
  return user?.role === "SUPER_ADMIN";
}

export const GET = withApi({ auth: "public" }, async ({ request }) => {
  const health = await getHealth();
  if (await isOperator(request)) return health;
  return { status: health.status };
});

export const HEAD = async () => new NextResponse(null, { status: 200 });
