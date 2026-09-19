"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Lock, ShieldCheck, Sparkles } from "lucide-react";
import gsap from "gsap";

import { VaultVisual } from "@/components/three/vault-visual";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const HEADLINE = ["Secure", "Your", "Legacy", "Forever"];

export function Hero() {
  const reduced = useReducedMotion();
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced || !scope.current) return;
    const ctx = gsap.context(() => {
      gsap.set("[data-hero-word]", { yPercent: 110, opacity: 0 });
      gsap.set("[data-hero-fade]", { y: 16, opacity: 0 });
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.to("[data-hero-word]", { yPercent: 0, opacity: 1, duration: 0.9, stagger: 0.09 }, 0.1).to(
        "[data-hero-fade]",
        { y: 0, opacity: 1, duration: 0.7, stagger: 0.1 },
        0.5,
      );
    }, scope);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section ref={scope} className="relative overflow-hidden">
      <div aria-hidden className="orb -top-40 left-[10%] h-[30rem] w-[30rem] bg-brand-purple" />
      <div aria-hidden className="orb top-24 right-[-8rem] h-[26rem] w-[26rem] bg-brand-cyan" />
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 pt-14 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-24 lg:pb-28">
        <div className="relative z-10 flex flex-col gap-7">
          <Badge
            variant="secondary"
            className="w-fit gap-2 px-3 py-1 text-xs font-medium glass"
            data-hero-fade
          >
            <span className="inline-block size-1.5 rounded-full bg-success" aria-hidden />
            AI-powered digital legacy platform
          </Badge>
          <h1 className="text-5xl leading-[1.02] font-semibold tracking-tight sm:text-6xl lg:text-7xl">
            {HEADLINE.map((word, index) => (
              <span
                key={word}
                className="inline-block overflow-hidden pr-[0.22em] pb-[0.06em] align-bottom"
              >
                <span
                  data-hero-word
                  className={cn("inline-block", index >= 2 && "text-gradient-brand")}
                >
                  {word}
                </span>
              </span>
            ))}
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground" data-hero-fade>
            LegacyVault AI is the secure locker for your digital will, assets, documents and final
            wishes — released to the people you trust only when the conditions you set are met, with
            every sensitive action verified and audited.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row" data-hero-fade>
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ size: "lg" }), "h-12 px-6 text-base shadow-glow-blue")}
            >
              Create Your Legacy Plan
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <a
              href="#capabilities"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
                "h-12 px-6 text-base glass",
              )}
            >
              Explore LegacyVault
            </a>
          </div>
          <dl className="grid max-w-lg grid-cols-3 gap-4 pt-2" data-hero-fade>
            {[
              { icon: Lock, label: "AES-256 encryption", value: "At rest & in transit" },
              { icon: ShieldCheck, label: "Server-side authorization", value: "Every request" },
              { icon: Sparkles, label: "AI you confirm", value: "Never auto-saved" },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="space-y-1">
                <dt className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon className="size-3.5 text-brand-cyan" aria-hidden />
                  {label}
                </dt>
                <dd className="text-xs text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground" data-hero-fade>
            Informational guidance only — LegacyVault AI does not provide legal advice or guarantee
            the legal validity of generated documents.
          </p>
        </div>

        <div className="relative z-10 mx-auto w-full max-w-md lg:max-w-none" data-hero-fade>
          <div className="glass-highlight relative aspect-square overflow-hidden rounded-[2rem] glass">
            <div aria-hidden className="absolute inset-0 bg-gradient-surface opacity-80" />
            <VaultVisual className="absolute inset-0" />
            <div className="absolute inset-x-5 bottom-5 flex items-center justify-between rounded-2xl border border-glass-border bg-background/60 px-4 py-3 text-xs backdrop-blur-md">
              <div className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
                  <span className="relative inline-flex size-2 rounded-full bg-success" />
                </span>
                <span className="font-medium">Vault status: protected</span>
              </div>
              <span className="text-muted-foreground">Dead Man’s Switch · Active</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
