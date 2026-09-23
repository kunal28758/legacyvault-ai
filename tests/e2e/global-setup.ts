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
}
