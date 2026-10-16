import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, FileLock2, Fingerprint, Lock, Sparkles } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import heroImage from "@/public/images/legacy-hero.webp";

/** Every claim here describes a control that exists in the product today. */
const TRUST = [
  { icon: Lock, label: "AES-256-GCM encrypted secrets" },
  { icon: FileLock2, label: "Private, type-checked document vault" },
  { icon: Fingerprint, label: "Re-verified, audited access" },
];

/**
 * Landing hero. A server component: the copy and a static, optimised image
 * (public/images/legacy-hero.webp, an original illustration) paint without
 * any client JavaScript. The headline and image are visible from the first
 * frame — only the supporting lines fade in, and `prefers-reduced-motion`
 * turns that off (styles/animations.css).
 */
export function Hero() {
  let fadeIndex = 0;
  const fadeDelay = () => ({ animationDelay: `${0.1 + 0.08 * fadeIndex++}s` });

  return (
    <section className="relative isolate overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16 lg:pt-20 lg:pb-24">
        <div className="flex flex-col gap-6">
          <span
            className="inline-flex w-fit hero-fade items-center gap-2 rounded-full border border-brand-purple/30 bg-brand-purple/10 px-3 py-1 text-xs font-medium"
            style={fadeDelay()}
          >
            <Sparkles className="size-3.5 text-brand-purple" aria-hidden />
            AI-assisted digital legacy planning
          </span>
          <h1 className="text-[2.5rem] leading-[1.06] font-semibold tracking-[-0.03em] sm:text-6xl lg:text-[3.6rem]">
            Secure your legacy.{" "}
            <span className="block text-muted-foreground">Pass it on with care.</span>
          </h1>
          <p
            className="max-w-xl hero-fade text-lg leading-8 text-muted-foreground"
            style={fadeDelay()}
          >
            One private vault for your will, documents, assets and final wishes — organized with AI
            assistance, protected by encryption, and released only to the people you choose, when
            the conditions you set are met.
          </p>
          <div className="flex hero-fade flex-col gap-3 sm:flex-row" style={fadeDelay()}>
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ size: "lg" }), "group h-12 px-6 text-base")}
            >
              Start your legacy plan
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                aria-hidden
              />
            </Link>
            <Link
              href="#how-it-works"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
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
        </div>

        <figure className="relative mx-auto w-full max-w-md sm:max-w-lg lg:max-w-none">
          <Image
            src={heroImage}
            alt="Illustration: a signed legacy plan with a green verified seal, a family photograph and a brass key resting on a navy portfolio."
            loading="eager"
            fetchPriority="high"
            placeholder="blur"
            sizes="(min-width: 1024px) 30rem, (min-width: 640px) 32rem, calc(100vw - 2rem)"
            className="h-auto w-full rounded-[1.75rem] border border-border shadow-elevated"
          />
        </figure>
      </div>
    </section>
  );
}
