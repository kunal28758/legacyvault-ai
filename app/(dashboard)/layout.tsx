import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

import { AppShell, type ShellUser } from "@/components/layout/app-shell";
import { getOptionalUser } from "@/lib/auth/require-user";
import { isClerkConfigured } from "@/lib/config/public-env";

/**
 * Protected application shell (task T048): Clerk protection, the first-run
 * gate and the shell. `getOptionalUser()` provisions the application row on
 * first use, which is also what tells us whether onboarding is still pending.
 *
 * Rendered dynamically on every request (`connection()`): this route group must
 * never be statically prerendered or served from a shared cache (ADR-001 cache
 * safety), and the per-request CSP nonce from proxy.ts must apply.
 *
 * Authentication is real: `proxy.ts` already enforces Clerk on this group and the
 * layout re-checks the session. Everything shown inside is served by the
 * versioned API from PostgreSQL.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await connection();

  if (!isClerkConfigured()) {
    // proxy.ts answers 503 before this point; this is a defensive fallback only.
    redirect("/sign-in");
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // First run happens outside this shell: there is nothing to navigate to yet.
  const appUser = await getOptionalUser();
  if (appUser && !appUser.onboardingCompletedAt) redirect("/onboarding");

  // Clerk has the avatar and the freshest display name, but it is a network
  // call: when it fails, the stored profile is enough to render the shell. A
  // provider blip must not take the whole dashboard down.
  const clerkUser = await currentUser().catch(() => null);
  const user: ShellUser = {
    name:
      clerkUser?.fullName ||
      clerkUser?.firstName ||
      clerkUser?.username ||
      clerkUser?.primaryEmailAddress?.emailAddress ||
      appUser?.name ||
      "Account",
    email: clerkUser?.primaryEmailAddress?.emailAddress ?? appUser?.email ?? null,
    imageUrl: clerkUser?.hasImage ? clerkUser.imageUrl : null,
  };

  return (
    <AppShell user={user} clerkEnabled>
      {children}
    </AppShell>
  );
}
