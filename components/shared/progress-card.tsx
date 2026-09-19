"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface ProgressCardProps {
  title: string;
  value: number;
  label?: React.ReactNode;
  description?: React.ReactNode;
  items?: { id: string; label: string; value: number; hint?: string }[];
  actions?: React.ReactNode;
  className?: string;
}

/** Card with a headline progress bar and optional per-item breakdown. */
export function ProgressCard({
  title,
  value,
  label,
  description,
  items,
  actions,
  className,
}: ProgressCardProps) {
  return (
    <Card className={cn("glass-highlight glass", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-semibold tabular-nums">{Math.round(value)}%</span>
            {label && <span className="text-sm text-muted-foreground">{label}</span>}
          </div>
          <Progress value={value} aria-label={`${title}: ${Math.round(value)}%`}>
            <ProgressTrack className="h-2">
              <ProgressIndicator className="rounded-full bg-gradient-brand" />
            </ProgressTrack>
          </Progress>
        </div>
        {items && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{item.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {item.hint ?? `${Math.round(item.value)}%`}
                  </span>
                </div>
                <Progress
                  value={item.value}
                  aria-label={`${item.label}: ${Math.round(item.value)}%`}
                >
                  <ProgressTrack className="h-1.5">
                    <ProgressIndicator className="rounded-full bg-primary/80" />
                  </ProgressTrack>
                </Progress>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** SVG ring meter — the number is the message; the ring is a secondary cue. */
export function ProgressRing({
  value,
  size = 128,
  stroke = 10,
  label,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);
  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <defs>
          <linearGradient id="lv-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--brand-blue)" />
            <stop offset="55%" stopColor="var(--brand-purple)" />
            <stop offset="100%" stopColor="var(--brand-cyan)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#lv-ring-gradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums">{Math.round(clamped)}</span>
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          / 100
        </span>
      </div>
    </div>
  );
}
