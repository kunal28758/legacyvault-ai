import { clerkSetup } from "@clerk/testing/playwright";

import { loadLocalEnv } from "../helpers/load-env";

/**
 * Obtains a Clerk testing token for authenticated E2E journeys (task T015).
 *
 * The Playwright runner is its own process, so `.env.local` is loaded here as
 * well — otherwise the authenticated journeys silently skip on a machine that
 * is in fact fully configured.
 *
 * Requires the publishable/secret keys of a Clerk DEVELOPMENT instance
 * (docs/DEPLOYMENT.md § Clerk).
 */
export default async function globalSetup() {
  loadLocalEnv();

  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    console.warn("[e2e] Clerk keys not configured — authenticated journeys are skipped.");
    return;
  }
  await clerkSetup();
}
