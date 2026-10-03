"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Coins,
  FileLock2,
  Fingerprint,
  HeartHandshake,
  KeyRound,
  Lock,
  ScrollText,
  Server,
  ShieldCheck,
  Siren,
  TimerReset,
  Users,
  Video,
} from "lucide-react";

import { Reveal } from "@/components/shared/page-transition";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/* ── Trust strip ───────────────────────────────────────────────────────────── */

export function TrustStrip() {
  const items = [
    { icon: Lock, label: "AES-256-GCM field encryption" },
    { icon: Fingerprint, label: "Step-up re-verification" },
    { icon: Server, label: "Private storage · signed URLs" },
    { icon: ShieldCheck, label: "Append-only audit trail" },
    { icon: KeyRound, label: "Scoped, expiring access links" },
  ];
  return (
    <section
      aria-label="Security principles"
      className="border-y border-glass-border bg-surface/40"
    >
      <ul className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-5 text-sm text-muted-foreground">
        {items.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2">
            <Icon className="size-4 text-brand-cyan" aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Capabilities ──────────────────────────────────────────────────────────── */

const capabilities = [
  {
    icon: ScrollText,
    title: "Digital Will & Legacy Plan",
    description:
      "An eleven-step guided plan that auto-saves, stays a draft until you confirm it, and keeps every finalized version.",
  },
  {
    icon: Users,
    title: "Beneficiaries & allocations",
    description:
      "Assign assets and documents per person with allocation limits enforced server-side. Recipients need no account.",
  },
  {
    icon: Coins,
    title: "Financial, physical & digital assets",
    description:
      "Bank accounts, property, wallets, domains and subscriptions — with account numbers and credentials encrypted.",
  },
  {
    icon: FileLock2,
    title: "Secure Document Vault",
    description:
      "Direct-to-private-storage uploads, size and file-type checks before anything is accepted, folders and version history.",
  },
  {
    icon: TimerReset,
    title: "Dead Man’s Switch",
    description:
      "Scheduled check-ins, staged escalation and a recovery path at every step before a scoped release happens.",
  },
  {
    icon: Siren,
    title: "Emergency Access",
    description:
      "Designated contacts verify by one-time code; you approve, deny or set a timeout rule. Access is time-limited.",
  },
  {
    icon: Video,
    title: "Video Legacy",
    description:
      "Personal messages delivered on the condition you choose — immediately, on release, or in an emergency.",
  },
  {
    icon: Bot,
    title: "AI assistance, clearly labelled",
    description:
      "Organize, review and draft with an assistant that flags uncertainty and never saves anything without you.",
  },
];

export function Capabilities() {
  return (
    <section id="capabilities" className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-20">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium tracking-[0.2em] text-brand-cyan uppercase">
          Key capabilities
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Everything a legacy needs, behind one secure door
        </h2>
        <p className="mt-4 text-muted-foreground">
          Every module is built on the same rules: server-side authorization, encryption at rest,
          explicit confirmation for anything authoritative, and a complete audit trail.
        </p>
      </Reveal>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {capabilities.map(({ icon: Icon, title, description }, index) => (
          <Reveal key={title} delay={index * 0.05}>
            <Card className="motion-safe-transition glass-highlight h-full glass hover:-translate-y-1 hover:shadow-glow-purple">
              <CardHeader>
                <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription className="leading-6">{description}</CardDescription>
              </CardHeader>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ── How it works ──────────────────────────────────────────────────────────── */

const steps = [
  {
    title: "Organize",
    description:
      "Record beneficiaries, assets and documents once. Sensitive fields are encrypted before they are stored.",
  },
  {
    title: "Plan",
    description:
      "Walk through the eleven-step legacy plan. Review completeness, acknowledge gaps and finalize on your terms.",
  },
  {
    title: "Protect",
    description:
      "Enable the Dead Man’s Switch and emergency access. Choose exactly which resources each contact may reach.",
  },
  {
    title: "Hand over",
    description:
      "When your conditions are met, scoped access links are delivered — time-limited, revocable and fully audited.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 border-y border-glass-border bg-surface/30 py-20"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.2em] text-brand-cyan uppercase">
            How LegacyVault works
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Four steps from scattered information to a protected legacy
          </h2>
        </Reveal>
        <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.08}>
              <li className="relative flex h-full flex-col gap-4 rounded-2xl border border-glass-border bg-background/40 p-6">
                <span className="flex size-10 items-center justify-center rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground shadow-glow-blue">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <ArrowRight
                    className="absolute top-8 -right-4 hidden size-5 text-muted-foreground/50 lg:block"
                    aria-hidden
                  />
                )}
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Feature showcase ──────────────────────────────────────────────────────── */

function WillPreview() {
  const sections = [
    { label: "Personal Details", done: true },
    { label: "Family Information", done: true },
    { label: "Beneficiaries", done: true },
    { label: "Financial Assets", done: true },
    { label: "Physical Assets", done: true },
    { label: "Digital Assets", done: false },
    { label: "Witness Details", done: false },
    { label: "Special Wishes", done: false },
    { label: "Document Attachments", done: false },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Legacy plan · draft v1</p>
          <p className="text-xs text-muted-foreground">Auto-saved 2 minutes ago</p>
        </div>
        <StatusBadge tone="info">Step 6 of 11</StatusBadge>
      </div>
      <Progress value={56} aria-label="Plan completion 56%">
        <ProgressTrack className="h-2">
          <ProgressIndicator className="rounded-full bg-gradient-brand" />
        </ProgressTrack>
      </Progress>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {sections.map((section) => (
          <li
            key={section.label}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
          >
            {section.done ? (
              <CheckCircle2 className="size-3.5 text-success" aria-hidden />
            ) : (
              <span
                className="size-3.5 rounded-full border border-muted-foreground/50"
                aria-hidden
              />
            )}
            <span className={cn(!section.done && "text-muted-foreground")}>{section.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SwitchPreview() {
  const stages = ["Active", "Check-in due", "Grace period", "Escalating", "Release ready"];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Dead Man’s Switch</p>
          <p className="text-xs text-muted-foreground">
            Next check-in in 3 days · 2 trusted contacts
          </p>
        </div>
        <StatusBadge tone="success" pulse>
          Active
        </StatusBadge>
      </div>
      <ol className="flex items-center gap-2">
        {stages.map((stage, index) => (
          <li key={stage} className="flex flex-1 flex-col items-center gap-2 text-center">
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full border text-xs font-semibold",
                index === 0
                  ? "border-success bg-success/15 text-success"
                  : "border-border text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span className="text-[11px] leading-tight text-muted-foreground">{stage}</span>
          </li>
        ))}
      </ol>
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
        You can recover at every stage — with re-verification — and nothing is released until the
        final step.
      </p>
    </div>
  );
}

function VaultPreview() {
  const files = [
    {
      name: "Will_Draft_v2.pdf",
      meta: "482 KB · 2 versions",
      tone: "success" as const,
      label: "Stored",
    },
    {
      name: "Palm_Residency_Sale_Deed.pdf",
      meta: "6.3 MB · shared with 1",
      tone: "success" as const,
      label: "Shared",
    },
    {
      name: "Identity_Documents.pdf",
      meta: "2.0 MB · just uploaded",
      tone: "info" as const,
      label: "Uploading",
    },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Secure Document Vault</p>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3.5 text-brand-cyan" aria-hidden /> Private bucket
        </span>
      </div>
      <ul className="space-y-2">
        {files.map((file) => (
          <li
            key={file.name}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <FileLock2 className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{file.meta}</p>
              </div>
            </div>
            <StatusBadge tone={file.tone} className="shrink-0">
              {file.label}
            </StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FeatureShowcase() {
  const [tab, setTab] = useState("will");
  const copy: Record<string, { title: string; body: string; bullets: string[] }> = {
    will: {
      title: "A guided will, not a giant form",
      body: "Eleven focused steps with auto-save, completion indicators and a review that lists exactly what is missing before you finalize.",
      bullets: [
        "Drafts stay drafts until you confirm",
        "Every finalized version is preserved",
        "Acknowledge gaps instead of being blocked",
      ],
    },
    switch: {
      title: "Release only when it should happen",
      body: "A data-driven schedule with staged escalation, a health check on the scheduler itself and recovery at every stage.",
      bullets: [
        "Scoped release to trusted contacts",
        "Reminder → grace → escalation → release",
        "Re-verified recovery, always audited",
      ],
    },
    vault: {
      title: "Documents nobody else can reach",
      body: "Files go straight to private storage, are checked for size and type before they join your vault, and are served only through short-lived signed links.",
      bullets: [
        "Type, size and magic-byte validation",
        "Version history and folders",
        "Per-document sharing with beneficiaries",
      ],
    },
  };
  return (
    <section id="showcase" className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-20">
      <Reveal className="max-w-2xl">
        <p className="text-xs font-medium tracking-[0.2em] text-brand-cyan uppercase">
          Feature showcase
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Designed to feel calm while doing serious work
        </h2>
      </Reveal>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="mt-10 gap-6">
        <TabsList className="h-auto flex-wrap p-1 glass">
          <TabsTrigger value="will" className="h-9 px-4">
            <ScrollText /> Digital Will
          </TabsTrigger>
          <TabsTrigger value="switch" className="h-9 px-4">
            <TimerReset /> Dead Man’s Switch
          </TabsTrigger>
          <TabsTrigger value="vault" className="h-9 px-4">
            <FileLock2 /> Document Vault
          </TabsTrigger>
        </TabsList>
        {(["will", "switch", "vault"] as const).map((key) => (
          <TabsContent key={key} value={key}>
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <div className="space-y-5">
                <h3 className="text-2xl font-semibold tracking-tight">{copy[key].title}</h3>
                <p className="text-muted-foreground">{copy[key].body}</p>
                <ul className="space-y-2">
                  {copy[key].bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      {bullet}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className={cn(buttonVariants({ variant: "outline" }), "glass")}
                >
                  Try it in your workspace
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
              <Card className="glass-highlight glass-strong">
                <CardContent className="p-6">
                  {key === "will" && <WillPreview />}
                  {key === "switch" && <SwitchPreview />}
                  {key === "vault" && <VaultPreview />}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

/* ── Security layers ───────────────────────────────────────────────────────── */

const layers = [
  {
    title: "Identity",
    detail: "Clerk sign-in, MFA and step-up re-verification for sensitive operations.",
  },
  {
    title: "Authorization",
    detail: "Ownership and role checks in the service layer on every request.",
  },
  {
    title: "Database",
    detail: "Row-level security, column allow-lists and guarded functions as a second barrier.",
  },
  {
    title: "Encryption",
    detail: "AES-256-GCM for sensitive fields; provider encryption for files and disks.",
  },
  {
    title: "Audit",
    detail: "Append-only log of who did what, when, to which resource — and the outcome.",
  },
];

export function SecurityLayers() {
  return (
    <section
      id="security"
      className="scroll-mt-24 border-y border-glass-border bg-surface/30 py-20"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <p className="text-xs font-medium tracking-[0.2em] text-brand-cyan uppercase">
            Security & trust
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Defense in depth — no single control is the only barrier
          </h2>
          <p className="mt-4 text-muted-foreground">
            Security and privacy come first in every trade-off. Your legacy data is never exposed to
            another user, sensitive values are encrypted before they are stored, and nothing
            authoritative changes without your explicit confirmation.
          </p>
          <ul className="mt-8 space-y-4">
            {layers.map((layer, index) => (
              <li key={layer.title} className="flex gap-4">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-brand-cyan/40 text-xs font-semibold text-brand-cyan">
                  {index + 1}
                </span>
                <div>
                  <p className="font-medium">{layer.title}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{layer.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.1} className="relative mx-auto aspect-square w-full max-w-md">
          <div aria-hidden className="absolute inset-0 rounded-full bg-brand-purple/10 blur-3xl" />
          <svg
            viewBox="0 0 400 400"
            className="relative size-full"
            role="img"
            aria-label="Five concentric layers of protection around your legacy data"
          >
            {[180, 150, 120, 90, 60].map((r, index) => (
              <g key={r}>
                <circle
                  cx="200"
                  cy="200"
                  r={r}
                  fill="none"
                  stroke={
                    index % 3 === 0
                      ? "var(--brand-blue)"
                      : index % 3 === 1
                        ? "var(--brand-purple)"
                        : "var(--brand-cyan)"
                  }
                  strokeOpacity={0.35 + index * 0.1}
                  strokeWidth={index === 4 ? 2 : 1.25}
                  strokeDasharray={index % 2 === 0 ? "6 8" : undefined}
                  className={cn(
                    index % 2 === 0
                      ? "origin-center animate-[spin_40s_linear_infinite]"
                      : "origin-center animate-[spin_60s_linear_infinite_reverse]",
                    "motion-reduce:animate-none",
                  )}
                />
                <text
                  x="200"
                  y={200 - r + 14}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--muted-foreground)"
                  className="font-medium"
                >
                  {layers[index].title}
                </text>
              </g>
            ))}
            <circle
              cx="200"
              cy="200"
              r="34"
              fill="var(--card)"
              stroke="var(--brand-cyan)"
              strokeWidth="1.5"
            />
            <g transform="translate(184 184)">
              <path
                d="M16 3 6 7v7c0 5.5 4.3 10.6 10 12 5.7-1.4 10-6.5 10-12V7l-10-4Z"
                fill="none"
                stroke="var(--foreground)"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="m12 16 3 3 5-6"
                fill="none"
                stroke="var(--brand-cyan)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </svg>
        </Reveal>
      </div>
    </section>
  );
}

/* ── CTA ───────────────────────────────────────────────────────────────────── */

export function CtaSection() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <Reveal>
        <div className="glass-highlight relative overflow-hidden rounded-3xl p-10 glass-strong sm:p-14">
          <div aria-hidden className="orb -top-24 -right-16 h-72 w-72 bg-brand-blue" />
          <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Start your legacy plan today
              </h2>
              <p className="mt-4 max-w-xl text-muted-foreground">
                The first draft takes about ten minutes. Everything stays private, encrypted and
                under your control — finalize only when you are ready.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/sign-up"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "h-12 px-6 text-base shadow-glow-blue",
                  )}
                >
                  Create Your Legacy Plan
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link
                  href="/sign-in"
                  className={cn(
                    buttonVariants({ size: "lg", variant: "outline" }),
                    "h-12 px-6 text-base",
                  )}
                >
                  Sign in
                </Link>
              </div>
            </div>
            <ul className="space-y-3 text-sm">
              {[
                "No credit card required to start a plan",
                "Beneficiaries never need an account",
                "Export or delete your data at any time",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 rounded-lg border border-glass-border bg-background/40 px-4 py-3"
                >
                  <HeartHandshake className="size-4 text-brand-purple" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
