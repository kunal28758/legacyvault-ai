import type { ReactNode } from "react";

/**
 * Public recipient shell.
 *
 * Deliberately bare: the people who land here are not LegacyVault users, are
 * often not expecting the visit, and have exactly one thing to do. No product
 * navigation, no sign-in prompts, nothing to sell.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-1 flex-col bg-gradient-surface">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:py-16">
        {children}
      </main>
      <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground">
        Shared through LegacyVault. This page is read-only and the link expires.
      </footer>
    </div>
  );
}
