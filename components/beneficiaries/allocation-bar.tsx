"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface AllocationSegment {
  id: string;
  label: string;
  value: number;
}

/**
 * Stacked allocation bar for one resource (Σ ≤ 100 %). Segments are separated
 * by a 2px surface gap and always accompanied by a text legend — identity is
 * never colour-alone. Segment fills cycle through the three validated viz steps
 * in fixed order.
 */
export function AllocationBar({
  segments,
  className,
  showLegend = true,
}: {
  segments: AllocationSegment[];
  className?: string;
  showLegend?: boolean;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const remaining = Math.max(0, 100 - total);
  const fills = ["bg-viz-1", "bg-viz-2", "bg-viz-3", "bg-brand-purple/70", "bg-brand-cyan/70"];
  return (
    <div className={cn("space-y-2", className)}>
      <div
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${total}% allocated${remaining ? `, ${remaining}% unallocated` : ""}`}
      >
        {segments.map((segment, index) => (
          <Tooltip key={segment.id}>
            <TooltipTrigger
              render={
                <span
                  className={cn("h-full rounded-sm", fills[index % fills.length])}
                  style={{ width: `${segment.value}%` }}
                />
              }
            />
            <TooltipContent>
              {segment.label} · {segment.value}%
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      {showLegend && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {segments.map((segment, index) => (
            <li key={segment.id} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-sm", fills[index % fills.length])} />
              {segment.label} <span className="tabular-nums">{segment.value}%</span>
            </li>
          ))}
          {remaining > 0 && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-muted-foreground/30" />
              Unallocated <span className="tabular-nums">{remaining}%</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
