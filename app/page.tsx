import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowRight,
  FileLock2,
  HeartHandshake,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Public landing page (task T002). Rendered dynamically so the per-request CSP
 * nonce from proxy.ts applies (Next.js CSP guide § Forcing dynamic rendering).
 * Content is deliberately product-identity only: no feature is implemented yet.
 */
const modules = [
  {
    icon: FileLock2,
    title: "Digital Will & Legacy Plan",
    description:
      "A guided, auto-saving plan that stays a draft until you explicitly confirm it — with versions you can always revisit.",
  },
  {
    icon: ShieldCheck,
    title: "Secure Document Vault",
    description:
      "Private, encrypted storage with malware scanning, folders, versions and server-enforced permissions.",
  },
  {
    icon: HeartHandshake,
    title: "Beneficiaries & Scoped Access",
    description:
      "Assign assets and documents per beneficiary. They receive time-limited, scoped access links — no account required.",
  },
  {
    icon: TimerReset,
    title: "Dead Man Switch",
    description:
      "Check-ins, staged escalation and a recovery path at every step before anything is released to trusted contacts.",
  },
  {
    icon: Video,
    title: "Video Legacy",
    description:
      "Upload personal messages and decide exactly when — and to whom — they are delivered.",
  },
  {
    icon: Sparkles,
    title: "AI Assistance, Clearly Labelled",
    description:
      "An assistant and will generator that flag uncertainty, never persist without your confirmation, and never replace legal counsel.",
  },
];

export default async function HomePage() {
  await connection();

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-gradient-surface">
      <div aria-hidden className="orb -top-32 left-1/4 h-[28rem] w-[28rem] bg-brand-purple" />
      <div aria-hidden className="orb top-40 -right-24 h-80 w-80 bg-brand-cyan" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="LegacyVault AI home">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-brand text-primary-foreground shadow-glow-blue">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight">LegacyVault AI</span>
        </Link>
        <nav className="flex items-center gap-2" aria-label="Account">
          <Link href="/sign-in" className={buttonVariants({ variant: "ghost" })}>
            Sign in
          </Link>
          <Link href="/sign-up" className={buttonVariants()}>
            Create account
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </nav>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col gap-20 px-6 pt-12 pb-24 sm:pt-20">
        <section className="stagger flex max-w-3xl flex-col gap-6">
          <Badge variant="secondary" className="w-fit gap-2 px-3 py-1 text-xs font-medium glass">
            <span className="inline-block size-1.5 rounded-full bg-success" aria-hidden />
            Security-first legal-tech platform
          </Badge>
          <h1 className="text-4xl leading-[1.05] font-semibold sm:text-6xl">
            Organize, protect and <span className="text-gradient-brand">hand over your legacy</span>{" "}
            — on your terms.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
            LegacyVault AI keeps your will, assets, documents and final wishes in one encrypted
            place, and delivers them to the people you trust only when the conditions you set are
            met. Every sensitive action is verified, authorized and audited.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-base shadow-glow-blue")}
            >
              Start your legacy plan
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="#modules"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
                "h-11 px-5 text-base",
              )}
            >
              See what is included
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Informational guidance only — LegacyVault AI does not provide legal advice or guarantee
            the legal validity of generated documents.
          </p>
        </section>

        <section id="modules" aria-labelledby="modules-heading" className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h2 id="modules-heading" className="text-2xl font-semibold sm:text-3xl">
              Everything a legacy needs, behind one secure door
            </h2>
            <p className="max-w-2xl text-muted-foreground">
              Fourteen modules planned for the baseline release, each built on the same rules:
              server-side authorization, encryption at rest, and a complete audit trail.
            </p>
          </div>
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map(({ icon: Icon, title, description }) => (
              <Card
                key={title}
                className="motion-safe-transition glass-highlight h-full glass hover:-translate-y-0.5 hover:shadow-glow-purple"
              >
                <CardHeader>
                  <span className="mb-2 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <CardTitle className="text-base">{title}</CardTitle>
                  <CardDescription className="leading-6">{description}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="principles-heading"
          className="glass-highlight rounded-2xl p-8 glass-strong sm:p-10"
        >
          <h2 id="principles-heading" className="text-xl font-semibold sm:text-2xl">
            Built on non-negotiable principles
          </h2>
          <dl className="mt-6 grid gap-6 sm:grid-cols-3">
            <div>
              <dt className="font-medium">Security first</dt>
              <dd className="mt-1 text-sm leading-6 text-muted-foreground">
                Least privilege, defense in depth, and step-up verification for every sensitive
                operation.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Privacy by default</dt>
              <dd className="mt-1 text-sm leading-6 text-muted-foreground">
                Your data is encrypted at rest and in transit and is never exposed to another user.
              </dd>
            </div>
            <div>
              <dt className="font-medium">You stay in control</dt>
              <dd className="mt-1 text-sm leading-6 text-muted-foreground">
                Nothing becomes authoritative — and no AI output is saved — without your explicit
                confirmation.
              </dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="relative z-10 mx-auto w-full max-w-6xl px-6 py-8 text-xs text-muted-foreground">
        © {new Date().getFullYear()} LegacyVault AI · Baseline in development · Not a substitute for
        professional legal counsel.
      </footer>
    </div>
  );
}
