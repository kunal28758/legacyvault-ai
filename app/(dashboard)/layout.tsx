import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

import { AppShell, type ShellUser } from "@/components/layout/app-shell";
import { isClerkConfigured } from "@/lib/config/public-env";

/**
 * Protected application shell (task T048 — partial: Clerk protection + shell;
 * `ensureAppUser()` / onboarding redirect / idle-timeout provider arrive with
 * T036 / T200 / T220).
 *
 * Rendered dynamically on every request (`connection()`): this route group must
 * never be statically prerendered or served from a shared cache (ADR-001 cache
 * safety), and the per-request CSP nonce from proxy.ts must apply.
 *
 * Authentication is real: `proxy.ts` already enforces Clerk on this group and the
 * layout re-checks the session. Everything shown inside is the demo workspace
 * (`lib/demo`) until the Route Handlers and services exist.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await connection();

  if (!isClerkConfigured()) {
    // proxy.ts answers 503 before this point; this is a defensive fallback only.
    redirect("/sign-in");
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const clerkUser = await currentUser();
  const user: ShellUser = {
    name:
      clerkUser?.fullName ||
      clerkUser?.firstName ||
      clerkUser?.username ||
      clerkUser?.primaryEmailAddress?.emailAddress ||
      "Account",
    email: clerkUser?.primaryEmailAddress?.emailAddress ?? null,
    imageUrl: clerkUser?.hasImage ? clerkUser.imageUrl : null,
  };

  return (
    <AppShell user={user} clerkEnabled>
      {children}
    </AppShell>
  );
}
