"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronDown, Circle, TrendingUp } from "lucide-react";

import { ProgressRing } from "@/components/shared/progress-card";
import { Button } from "@/components/ui/button";
import type { LegacyAction } from "@/lib/client/action-centre";
import type { ReadinessBreakdown } from "@/lib/client/readiness";
import { cn } from "@/lib/utils";

const toneFor = (score: number) => (score >= 80 ? "success" : score >= 50 ? "warning" : "danger");
const barFor = (score: number) =>
  score >= 80 ? "bg-success" : score >= 50 ? "bg-warning" : "bg-destructive";

/**
 * Legacy Readiness: overall score, the six categories, and exactly which
 * criteria are unmet. "Improve readiness" goes to the highest-priority open
 * action. Wording is about preparation — never legal completeness.
 */
export function ReadinessPanel({
  breakdown,
  nextAction,
  showMissing = true,
}: {
  breakdown: ReadinessBreakdown;
  nextAction: LegacyAction | undefined;
  showMissing?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <ProgressRing
          value={breakdown.score}
          size={112}
          stroke={9}
          tone={toneFor(breakdown.score)}
          caption="ready"
          label="Legacy readiness score"
        />
        <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
          <p className="text-sm leading-6 text-muted-foreground">
            {breakdown.score >= 80
              ? "Well prepared. Keep it current as life changes."
              : breakdown.score >= 50
                ? "Good progress — a few important gaps remain."
                : "Early days — the steps below make the biggest difference."}
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            Measures preparation inside LegacyVault. It is not a legal assessment.
          </p>
          {nextAction && (
            <Button size="sm" nativeButton={false} render={<Link href={nextAction.href} />}>
              <TrendingUp data-icon="inline-start" />
              Improve readiness
            </Button>
          )}
        </div>
      </div>

      <ul className="space-y-1.5" aria-label="Readiness by category">
        {breakdown.categories.map((category) => (
          <li key={category.id}>
            <details className="group rounded-lg border border-transparent open:border-border open:bg-surface/40">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-1.5 outline-none hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <span className="w-28 shrink-0 truncate text-xs font-medium sm:w-32">
                  {category.label}
                </span>
                <span
                  className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <span
                    className={cn(
                      "absolute inset-0 origin-left rounded-full transition-transform duration-700 ease-out",
                      barFor(category.score),
                    )}
                    style={{ transform: `scaleX(${category.score / 100})` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums">
                  {category.score}%<span className="sr-only"> ready</span>
                </span>
                <ChevronDown
                  className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <ul className="space-y-1 px-2 pt-1 pb-2">
                {category.criteria.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-xs">
                    {item.met ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
                    ) : (
                      <Circle className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
                    )}
                    <span className={cn("min-w-0 flex-1", item.met && "text-muted-foreground")}>
                      {item.label}
                      <span className="sr-only">{item.met ? " — met" : " — not yet"}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {item.earned}/{item.points}
                    </span>
                    {!item.met && (
                      <Link
                        href={item.href}
                        className="shrink-0 rounded px-1 font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        Fix<span className="sr-only">: {item.label}</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>

      {showMissing && breakdown.missing.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            What’s missing
          </p>
          <ul className="space-y-1.5">
            {breakdown.missing.slice(0, 4).map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {item.category} · +{Math.max(1, Math.round(item.impact))}
                  </span>
                  <ArrowRight
                    className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
