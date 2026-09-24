import type { ReactNode } from "react";

/** A single-purpose shell for first run: no navigation, nothing to lose focus to. */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-1 flex-col bg-gradient-surface">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-10 sm:py-16">
        {children}
      </main>
    </div>
  );
}
