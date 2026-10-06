import Link from "next/link";
import { ArrowLeft, Lock, ShieldCheck, Sparkles } from "lucide-react";

import { BrandLogo } from "@/components/shared/brand-logo";

/** Shared auth page layout (task T045): brand panel + centered glass card. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-gradient-surface lg:flex-row">
      <div
        aria-hidden
        className="orb -top-32 -left-24 h-[28rem] w-[28rem] bg-brand-blue opacity-30"
      />
      <div
        aria-hidden
        className="orb right-[-6rem] bottom-0 h-80 w-80 bg-brand-blue-strong opacity-30"
      />

      <aside className="relative z-10 flex flex-col justify-between gap-10 px-6 py-8 lg:w-[44%] lg:px-14 lg:py-12">
        <div className="flex items-center justify-between">
          <BrandLogo />
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground lg:hidden"
          >
            <ArrowLeft className="size-4" aria-hidden /> Home
          </Link>
        </div>
        <div className="hidden space-y-8 lg:block">
          <div className="space-y-4">
            <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight">
              Secure your legacy. <span className="text-gradient-brand">Built for tomorrow.</span>
            </h1>
            <p className="max-w-md text-muted-foreground">
              One encrypted place for your will, assets, documents and final wishes — handed over
              only on the conditions you set.
            </p>
          </div>
          <ul className="space-y-3 text-sm">
            {[
              { icon: Lock, text: "Sensitive fields encrypted with AES-256-GCM before storage" },
              {
                icon: ShieldCheck,
                text: "Multi-factor sign-in and re-verification for sensitive actions",
              },
              {
                icon: Sparkles,
                text: "AI assistance that never saves anything without your confirmation",
              },
            ].map(({ icon: Icon, text }) => (
              <li
                key={text}
                className="flex items-start gap-3 rounded-xl border border-glass-border bg-background/40 px-4 py-3"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <Link
          href="/"
          className="hidden items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground lg:flex"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to home
        </Link>
      </aside>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-12 lg:px-10">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
