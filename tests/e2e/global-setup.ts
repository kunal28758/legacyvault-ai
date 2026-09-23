import { clerkSetup } from "@clerk/testing/playwright";

import { loadLocalEnv } from "../helpers/load-env";
import { E2E_USER_EMAILS } from "./users";

/**
 * Obtains a Clerk testing token for authenticated E2E journeys (task T015) and
 * provisions the per-spec test users.
 *
 * The Playwright runner is its own process, so `.env.local` is loaded here as
 * well — otherwise the authenticated journeys silently skip on a machine that
 * is in fact fully configured.
 *
 * Requires the publishable/secret keys of a Clerk DEVELOPMENT instance
 * (docs/DEPLOYMENT.md § Clerk). The secret is used only as a bearer token to
 * Clerk's own API and is never logged.
 */
const CLERK_API = "https://api.clerk.com/v1";

async function ensureTestUser(email: string): Promise<void> {
  const headers = {
    Authorization: `Bearer ${process.env.CLERK_SECRET_KEY ?? ""}`,
    "Content-Type": "application/json",
  };

  try {
    const existing = await fetch(
      `${CLERK_API}/users?email_address=${encodeURIComponent(email)}&limit=1`,
      { headers },
    );
    if (existing.ok) {
      const users: unknown = await existing.json();
      if (Array.isArray(users) && users.length > 0) return;
    }

    const created = await fetch(`${CLERK_API}/users`, {
      method: "POST",
      headers,
      // No password: these accounts sign in with the email-code test strategy.
      body: JSON.stringify({ email_address: [email], skip_password_requirement: true }),
    });
    if (!created.ok) {
      console.warn(
        `[e2e] could not provision ${email} (HTTP ${created.status}) — that spec will fail to sign in.`,
      );
    }
  } catch {
    console.warn(`[e2e] Clerk API unreachable while provisioning ${email}.`);
  }
}

/**
 * Compiles the routes the authenticated journeys touch.
 *
 * `next dev` builds each route the first time it is requested. Without this,
 * the first run after a source change pays that cost inside the tests, with
 * several workers queued behind the same compilation — which shows up as
 * assertion timeouts that have nothing to do with the application. The
 * responses are expected to be 401s or redirects; only the compile matters.
 */
async function warmRoutes(): Promise<void> {
  const base =
    process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PLAYWRIGHT_PORT ?? 3000}`;
  const paths = [
    "/",
    "/beneficiaries",
    "/legacy-plan",
    "/legacy-plan/wizard",
    "/assets/financial",
    "/assets/physical",
    "/api/v1/health",
    "/api/v1/beneficiaries",
    "/api/v1/legacy-plans",
    "/api/v1/legacy-plans/current",
    "/api/v1/assets/financial",
    "/api/v1/assets/physical",
    "/api/v1/assets/digital",
  ];

  await Promise.all(
    paths.map(async (path) => {
      try {
        await fetch(`${base}${path}`, { signal: AbortSignal.timeout(60_000) });
      } catch {
        // A cold route that refuses to answer is the tests' problem to report.
      }
    }),
  );
}

export default async function globalSetup() {
  loadLocalEnv();

  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    console.warn("[e2e] Clerk keys not configured — authenticated journeys are skipped.");
    return;
  }
  await clerkSetup();

  // Each authenticated spec runs as its own user so they do not share the
  // application's per-user rate-limit bucket.
  for (const email of E2E_USER_EMAILS) await ensureTestUser(email);

  await warmRoutes();
}
