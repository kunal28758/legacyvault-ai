"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Bot, FileLock2, Fingerprint, Lock, ScanLine, Sparkles } from "lucide-react";
import gsap from "gsap";

import { VaultVisual } from "@/components/landing/vault-visual";
import { buttonVariants } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const HEADLINE = ["Secure", "Your", "Legacy", "Forever"];

/** Every claim here describes a control that exists in the product today. */
const TRUST = [
  { icon: Lock, label: "AES-256-GCM encrypted secrets" },
  { icon: ScanLine, label: "Malware-scanned private vault" },
  { icon: Fingerprint, label: "Re-verified, audited access" },
];

export function Hero() {
  const reduced = useReducedMotion();
  const scope = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: scope, offset: ["start start", "end start"] });
  // The shield drifts up and recedes slightly as the page scrolls past it.
  const visualY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 120]);
  const visualScale = useTransform(scrollYProgress, [0, 1], [1, reduced ? 1 : 0.92]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 40]);

  useEffect(() => {
    if (reduced || !scope.current) return;
    const ctx = gsap.context(() => {
      gsap.set("[data-hero-word]", { yPercent: 110, opacity: 0 });
      gsap.set("[data-hero-fade]", { y: 16, opacity: 0 });
      gsap.set("[data-hero-visual]", { opacity: 0, scale: 0.94 });
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.to("[data-hero-word]", { yPercent: 0, opacity: 1, duration: 0.9, stagger: 0.09 }, 0.1)
        .to("[data-hero-fade]", { y: 0, opacity: 1, duration: 0.7, stagger: 0.08 }, 0.45)
        .to("[data-hero-visual]", { opacity: 1, scale: 1, duration: 1.4, ease: "expo.out" }, 0.2);
    }, scope);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section ref={scope} className="relative isolate overflow-hidden">
      {/* Ambient depth: soft brand orbs and a faint grid, all decorative. */}
      <div aria-hidden className="orb -top-40 left-[6%] h-[30rem] w-[30rem] bg-brand-purple" />
      <div aria-hidden className="orb top-24 right-[-10rem] h-[32rem] w-[32rem] bg-brand-blue" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--glass-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--glass-border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_60%_40%,black_20%,transparent_70%)] bg-[size:56px_56px] opacity-40"
      />

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-6 lg:pt-20 lg:pb-24">
        <motion.div style={{ y: copyY }} className="relative z-10 flex flex-col gap-6">
          <span
            className="inline-flex w-fit items-center gap-2 rounded-full border border-glass-border bg-background/40 px-3 py-1 text-xs font-medium backdrop-blur-md"
            data-hero-fade
          >
            <Sparkles className="size-3.5 text-brand-cyan" aria-hidden />
            AI-Powered Digital Legacy Platform
          </span>
          <h1 className="text-[2.75rem] leading-[1.02] font-semibold tracking-tight sm:text-6xl lg:text-7xl">
            {HEADLINE.map((word, index) => (
              <span
                key={word}
                className="inline-block overflow-hidden pr-[0.22em] pb-[0.08em] align-bottom"
              >
                <span
                  data-hero-word
                  className={cn(
                    "inline-block",
                    index >= 2 && "animate-gradient-drift text-gradient-brand",
                  )}
                >
                  {word}
                </span>
              </span>
            ))}
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground" data-hero-fade>
            Create, organize, protect, and securely transfer your digital and physical legacy to the
            people you authorize.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row" data-hero-fade>
            <Link
              href="/legacy-plan/wizard"
              className={cn(
                buttonVariants({ size: "lg" }),
                "group h-12 px-6 text-base shadow-glow-blue transition-transform hover:-translate-y-0.5 motion-reduce:transform-none",
              )}
            >
              Create Your Will
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                aria-hidden
              />
            </Link>
            <Link
              href="/ai"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
                "h-12 px-6 text-base glass transition-transform hover:-translate-y-0.5 motion-reduce:transform-none",
              )}
            >
              <Bot className="size-4" aria-hidden />
              Talk to AI Assistant
            </Link>
          </div>
          <ul
            className="flex flex-wrap gap-x-5 gap-y-2.5 pt-1"
            data-hero-fade
            aria-label="Security"
          >
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="flex size-7 items-center justify-center rounded-lg border border-glass-border bg-background/40">
                  <Icon className="size-3.5 text-brand-cyan" aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>
          <p
            className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"
            data-hero-fade
          >
            <FileLock2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Informational guidance only — LegacyVault AI does not provide legal advice or guarantee
            the legal validity of generated documents.
          </p>
        </motion.div>

        <motion.div
          style={{ y: visualY, scale: visualScale }}
          className="relative z-0 mx-auto aspect-square w-full max-w-[26rem] sm:max-w-[32rem] lg:max-w-none"
          data-hero-visual
        >
          <div
            aria-hidden
            className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--brand-purple)_35%,transparent)_0%,transparent_65%)] blur-2xl"
          />
          <VaultVisual className="absolute inset-0" />
        </motion.div>
      </div>
    </section>
  );
}
