import { useId } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface BrandLogoProps {
  href?: string;
  compact?: boolean;
  className?: string;
}

/**
 * The LegacyVault mark: a shield (protection) holding a keyhole (the vault).
 * Pure SVG so it stays crisp from a 16px favicon to the landing hero; the same
 * geometry ships as `app/icon.svg`.
 */
export function BrandMark({ className }: { className?: string }) {
  const id = useId();
  const fill = `${id}-fill`;
  const edge = `${id}-edge`;
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden focusable="false">
      <defs>
        <linearGradient id={fill} x1="6" y1="3" x2="26" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#38B6FF" />
          <stop offset="0.55" stopColor="#0EA5FF" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
        <linearGradient id={edge} x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.7" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.25 27.25 6.4v8.35c0 7.05-4.7 12.3-11.25 14.95C9.45 27.05 4.75 21.8 4.75 14.75V6.4L16 2.25Z"
        fill={`url(#${fill})`}
      />
      <path
        d="M16 2.25 27.25 6.4v8.35c0 7.05-4.7 12.3-11.25 14.95C9.45 27.05 4.75 21.8 4.75 14.75V6.4L16 2.25Z"
        fill="none"
        stroke={`url(#${edge})`}
        strokeWidth="0.9"
      />
      <path
        d="M16 9.6a3.65 3.65 0 0 1 1.95 6.74l.86 5.16a.7.7 0 0 1-.69.82h-4.24a.7.7 0 0 1-.69-.82l.86-5.16A3.65 3.65 0 0 1 16 9.6Z"
        fill="#04121F"
        fillOpacity="0.88"
      />
    </svg>
  );
}

/** LegacyVault AI wordmark. `compact` shows only the vault mark (collapsed sidebar). */
export function BrandLogo({ href = "/", compact = false, className }: BrandLogoProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group/logo flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      aria-label="LegacyVault AI home"
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0.5 rounded-full bg-primary/30 blur-md transition-opacity duration-300 group-hover/logo:opacity-100 sm:opacity-70"
        />
        <BrandMark className="relative size-9 drop-shadow-[0_2px_6px_rgba(14,165,255,0.35)]" />
      </span>
      {!compact && (
        <span className="flex items-baseline gap-1.5 leading-none">
          <span className="font-heading text-[17px] font-semibold tracking-tight">
            Legacy<span className="text-primary">Vault</span>
          </span>
          <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-primary">
            AI
          </span>
        </span>
      )}
    </Link>
  );
}
