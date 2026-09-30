import { withApi } from "@/lib/api/with-api";
import { isClerkConfigured } from "@/lib/config/public-env";
import { getSystemStatus } from "@/lib/observability/system-status";

/**
 * Live system status for the "System online" indicator.
 *
 * Public, so the landing page can show it — but anonymous callers get only
 * the overall state and when it was checked. A signed-in session sees the
 * per-service breakdown. Results are real probes, cached for 30 seconds.
 */
export const dynamic = "force-dynamic";

async function hasSession(): Promise<boolean> {
  if (!isClerkConfigured()) return false;
  try {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    return Boolean(userId);
  } catch {
    // An unreachable identity provider must not take the status page down.
    return false;
  }
}

export const GET = withApi({ auth: "public" }, async () =>
  getSystemStatus((await hasSession()) ? "user" : "public"),
);
