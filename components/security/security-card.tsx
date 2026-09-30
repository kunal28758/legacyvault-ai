import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SecurityCheck } from "@/lib/client/security-checks";
import { cn } from "@/lib/utils";

const statusMeta: Record<
  SecurityCheck["status"],
  { label: string; icon: LucideIcon; chip: string; text: string }
> = {
  good: {
    label: "Protected",
    icon: CheckCircle2,
    chip: "bg-success/15 text-success",
    text: "text-success",
  },
  attention: {
    label: "Needs attention",
    icon: AlertTriangle,
    chip: "bg-warning/15 text-warning",
    text: "text-warning",
  },
  risk: {
    label: "At risk",
    icon: ShieldAlert,
    chip: "bg-destructive/15 text-destructive",
    text: "text-destructive",
  },
};

/** One security control: status icon + label + detail + optional action. Never colour-only. */
export function SecurityCard({
  check,
  icon: Icon,
  className,
}: {
  check: SecurityCheck;
  icon: LucideIcon;
  className?: string;
}) {
  const meta = statusMeta[check.status];
  const StatusIcon = meta.icon;
  return (
    <Card className={cn("glass-highlight h-full glass", className)}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Icon className="size-5" aria-hidden />
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              meta.chip,
            )}
          >
            <StatusIcon className="size-3.5" aria-hidden />
            {meta.label}
          </span>
        </div>
        <div className="flex-1 space-y-1">
          <p className="font-medium">{check.title}</p>
          <p className="text-sm leading-6 text-muted-foreground">{check.detail}</p>
        </div>
        {check.href && (
          <Button
            variant={check.action ? "outline" : "ghost"}
            size="sm"
            className="w-fit"
            nativeButton={false}
            render={<Link href={check.href} />}
          >
            {check.action ?? "View"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
