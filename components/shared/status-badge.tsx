import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Info,
  PauseCircle,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** `ai` marks AI-produced or AI-related state only (violet is reserved for it). */
export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "ai";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-muted/60 text-muted-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-primary/30 bg-primary/10 text-primary",
  ai: "border-brand-purple/30 bg-brand-purple/10 text-brand-purple",
};

const toneIcons: Record<StatusTone, LucideIcon> = {
  neutral: CircleDashed,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
  ai: Sparkles,
};

interface StatusBadgeProps {
  tone: StatusTone;
  children: React.ReactNode;
  icon?: LucideIcon | null;
  className?: string;
  pulse?: boolean;
}

/**
 * Status pill. Always pairs colour with an icon and a label so state is never
 * communicated by colour alone (constitution XIV).
 */
export function StatusBadge({ tone, children, icon, className, pulse }: StatusBadgeProps) {
  const Icon = icon === undefined ? toneIcons[tone] : icon;
  return (
    <Badge
      variant="outline"
      className={cn("h-6 gap-1.5 px-2.5 font-medium", toneClasses[tone], className)}
    >
      {pulse ? (
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-current" />
        </span>
      ) : (
        Icon && <Icon className="size-3.5" aria-hidden />
      )}
      {children}
    </Badge>
  );
}

export { PauseCircle };

/** Maps common domain statuses to a tone + label. */
export function toneForBeneficiaryStatus(status: "PENDING" | "ACTIVE" | "INACTIVE"): {
  tone: StatusTone;
  label: string;
} {
  switch (status) {
    case "ACTIVE":
      return { tone: "success", label: "Active" };
    case "PENDING":
      return { tone: "warning", label: "Pending invite" };
    case "INACTIVE":
      return { tone: "neutral", label: "Inactive" };
  }
}
