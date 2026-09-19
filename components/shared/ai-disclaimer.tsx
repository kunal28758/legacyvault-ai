import { Scale, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

/** Legal-tech disclaimer (constitution V, FR-L007 / FR-R009). Shown wherever AI output appears. */
export function AiDisclaimer({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-muted/40 text-muted-foreground",
        compact ? "px-3 py-2 text-[11px] leading-4" : "px-4 py-3 text-xs leading-5",
        className,
      )}
    >
      <Scale className={cn("mt-0.5 shrink-0", compact ? "size-3" : "size-3.5")} aria-hidden />
      <span>
        AI responses are informational assistance, not legal advice. LegacyVault AI does not
        guarantee the legal validity of any document or outcome — review important decisions with a
        qualified professional.
      </span>
    </p>
  );
}

/** Small "AI-generated" label placed next to generated content (FR-R009). */
export function AiGeneratedLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-brand-purple/30 bg-brand-purple/10 px-2 py-0.5 text-[11px] font-medium text-brand-purple",
        className,
      )}
    >
      <Sparkles className="size-3" aria-hidden />
      AI-generated
    </span>
  );
}
