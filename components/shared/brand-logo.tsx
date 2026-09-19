import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

interface BrandLogoProps {
  href?: string;
  compact?: boolean;
  className?: string;
}

/** LegacyVault AI wordmark. `compact` shows only the vault glyph (collapsed sidebar). */
export function BrandLogo({ href = "/", compact = false, className }: BrandLogoProps) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      aria-label="LegacyVault AI home"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-primary-foreground shadow-glow-blue">
        <ShieldCheck className="size-5" aria-hidden />
      </span>
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-base font-semibold tracking-tight">LegacyVault</span>
          <span className="text-[10px] font-medium tracking-[0.2em] text-brand-cyan uppercase">
            AI
          </span>
        </span>
      )}
    </Link>
  );
}
