"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowDown, ArrowRight, FileLock2, Fingerprint, Lock, Sparkles } from "lucide-react";

import { VaultVisual } from "@/components/landing/vault-visual";
import { buttonVariants } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/** Two lines; the second carries the brand gradient. */
const HEADLINE = [
  ["Secure", "your", "legacy."],
  ["Built", "for", "tomorrow."],
];

/** Decorative particles: fixed positions so server and client render the same. */
const PARTICLES = [
  { left: "8%", top: "22%", size: 3, delay: "0s" },
  { left: "18%", top: "72%", size: 2, delay: "1.2s" },
  { left: "34%", top: "12%", size: 2, delay: "2.4s" },
  { left: "46%", top: "84%", size: 3, delay: "0.6s" },
  { left: "58%", top: "18%", size: 2, delay: "3s" },
  { left: "66%", top: "64%", size: 4, delay: "1.8s" },
  { left: "78%", top: "30%", size: 2, delay: "0.3s" },
  { left: "88%", top: "78%", size: 3, delay: "2.1s" },
  { left: "94%", top: "12%", size: 2, delay: "3.6s" },
];

/** Every claim here describes a control that exists in the product today. */
const TRUST = [
  { icon: Lock, label: "AES-256-GCM encrypted secrets" },
  { icon: FileLock2, label: "Private, type-checked document vault" },
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

  // Entrance choreography is pure CSS (styles/animations.css: hero-word,
  // hero-fade, hero-visual): it runs from the first paint, needs no JS library,
  // and `prefers-reduced-motion` turns it off entirely.
  let fadeIndex = 0;
  const fadeDelay = () => ({ animationDelay: `${0.45 + 0.08 * fadeIndex++}s` });
  let wordIndex = 0;

  return (
    <section ref={scope} className="relative isolate overflow-hidden">
      {/* Ambient depth: soft brand orbs and a faint grid, all decorative. */}
      <div
        aria-hidden
        className="orb -top-40 left-[4%] h-[30rem] w-[30rem] animate-float bg-brand-blue opacity-25"
      />
      <div
        aria-hidden
        className="orb top-24 right-[-10rem] h-[32rem] w-[32rem] bg-brand-blue-strong opacity-30"
      />
      <div aria-hidden className="orb bottom-0 left-[40%] h-64 w-64 bg-brand-purple opacity-15" />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {PARTICLES.map((particle) => (
          <span
            key={`${particle.left}-${particle.top}`}
            className="absolute animate-float rounded-full bg-primary/70 shadow-[0_0_8px_var(--brand-blue)]"
            style={{
              left: particle.left,
              top: particle.top,
              width: particle.size,
              height: particle.size,
              animationDelay: particle.delay,
            }}
          />
        ))}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--glass-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--glass-border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_60%_40%,black_20%,transparent_70%)] bg-[size:56px_56px] opacity-40"
      />

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-6 lg:pt-20 lg:pb-24">
        <motion.div style={{ y: copyY }} className="relative z-10 flex flex-col gap-6">
          <span
            className="inline-flex w-fit hero-fade items-center gap-2 rounded-full border border-brand-purple/30 bg-brand-purple/10 px-3 py-1 text-xs font-medium backdrop-blur-md"
            style={fadeDelay()}
          >
            <Sparkles className="size-3.5 text-brand-purple" aria-hidden />
            AI-Powered Digital Legacy Platform
          </span>
          <h1 className="text-[2.6rem] leading-[1.04] font-bold tracking-[-0.03em] sm:text-6xl lg:text-[4.25rem]">
            {HEADLINE.map((line, lineIndex) => (
              <span key={lineIndex} className="block">
                {line.map((word) => (
                  <span
                    key={word}
                    className="inline-block overflow-hidden pr-[0.22em] pb-[0.08em] align-bottom"
                  >
                    <span
                      className="inline-block hero-word"
                      style={{ animationDelay: `${0.1 + 0.09 * wordIndex++}s` }}
                    >
                      <span
                        className={cn(
                          "inline-block",
                          lineIndex === 1 && "animate-gradient-drift text-gradient-brand",
                        )}
                      >
                        {word}
                      </span>
                    </span>
                  </span>
                ))}
              </span>
            ))}
          </h1>
          <p
            className="max-w-xl hero-fade text-lg leading-8 text-muted-foreground"
            style={fadeDelay()}
          >
            One encrypted vault for your will, documents, assets and final wishes — organized with
            AI, protected by design, and handed over only to the people and on the conditions you
            choose.
          </p>
          <div className="flex hero-fade flex-col gap-3 sm:flex-row" style={fadeDelay()}>
            <Link
              href="/legacy-plan/wizard"
              className={cn(
                buttonVariants({ size: "lg" }),
                "group h-12 px-6 text-base shadow-glow-blue",
              )}
            >
              Get Started
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                aria-hidden
              />
            </Link>
            <Link
              href="#how-it-works"
              className={cn(
                buttonVariants({ size: "lg", variant: "secondary" }),
                "group h-12 px-6 text-base",
              )}
            >
              See how it works
              <ArrowDown
                className="size-4 transition-transform group-hover:translate-y-0.5 motion-reduce:transform-none"
                aria-hidden
              />
            </Link>
          </div>
          <ul
            className="flex hero-fade flex-wrap gap-x-5 gap-y-2.5 pt-1"
            style={fadeDelay()}
            aria-label="Security"
          >
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="flex size-7 items-center justify-center rounded-lg border border-success/25 bg-success/10">
                  <Icon className="size-3.5 text-success" aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>
          <p
            className="flex hero-fade items-start gap-2 text-xs leading-5 text-muted-foreground"
            style={fadeDelay()}
          >
            <FileLock2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Informational guidance only — LegacyVault AI does not provide legal advice or guarantee
            the legal validity of generated documents.
          </p>
        </motion.div>

        <motion.div
          style={{ y: visualY, scale: visualScale }}
          className="relative z-0 mx-auto aspect-square w-full max-w-[26rem] sm:max-w-[32rem] lg:max-w-none"
        >
          {/* The entrance animates this inner layer; the outer one carries the scroll parallax. */}
          <div className="absolute inset-0 hero-visual" style={{ animationDelay: "0.2s" }}>
            <div
              aria-hidden
              className="absolute inset-[8%] animate-shield-glow rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--brand-blue)_32%,transparent)_0%,transparent_65%)] blur-2xl"
            />
            <VaultVisual className="absolute inset-0" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
