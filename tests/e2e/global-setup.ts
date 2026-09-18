import { clerkSetup } from "@clerk/testing/playwright";

/**
 * Obtains a Clerk testing token for authenticated E2E journeys (task T015).
 * Requires CLERK_PUBLISHABLE_KEY/CLERK_SECRET_KEY of a Clerk DEVELOPMENT instance
 * (docs/DEPLOYMENT.md § Clerk). Skipped automatically until they exist so the
 * public smoke journey still runs.
 */
export default async function globalSetup() {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    console.warn("[e2e] Clerk keys not configured — authenticated journeys are skipped.");
    return;
  }
  await clerkSetup();
}
