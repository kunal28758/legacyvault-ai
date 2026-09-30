"use client";

import {
  Building2,
  Coins,
  Gem,
  Globe,
  Lock,
  MoreHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

import { AllocationBar, type AllocationSegment } from "@/components/beneficiaries/allocation-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { assetSubtitle, hasSensitiveFields } from "@/lib/assets/meta";
import type { Asset } from "@/lib/types/asset";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const kindIcon: Record<Asset["kind"], LucideIcon> = {
  FINANCIAL_ASSET: Coins,
  PHYSICAL_ASSET: Gem,
  DIGITAL_ASSET: Globe,
};

const kindAccent: Record<Asset["kind"], string> = {
  FINANCIAL_ASSET: "bg-viz-1/20 text-viz-1",
  PHYSICAL_ASSET: "bg-viz-2/20 text-viz-2",
  DIGITAL_ASSET: "bg-viz-3/20 text-viz-3",
};

/** Re-exported so existing call sites keep one import site. */
export { assetSubtitle, hasSensitiveFields };

interface AssetCardProps {
  asset: Asset;
  allocation: AllocationSegment[];
  onOpen: () => void;
  menu?: React.ReactNode;
  className?: string;
}

/** Asset tile with category, value, allocation bar and sensitive-field indicator. */
export function AssetCard({ asset, allocation, onOpen, menu, className }: AssetCardProps) {
  const Icon = kindIcon[asset.kind];
  const total = allocation.reduce((s, a) => s + a.value, 0);
  return (
    <Card
      className={cn(
        "motion-safe-transition glass-highlight h-full glass hover:-translate-y-0.5",
        className,
      )}
    >
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              kindAccent[asset.kind],
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="truncate font-medium">{asset.name}</p>
            <p className="truncate text-xs text-muted-foreground">{assetSubtitle(asset)}</p>
          </button>
          {menu ?? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Open ${asset.name}`}
              onClick={onOpen}
            >
              <MoreHorizontal />
            </Button>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-lg font-semibold tabular-nums">
            {asset.estimatedValue != null
              ? formatCurrency(asset.estimatedValue, asset.currency)
              : "No value set"}
          </span>
          {hasSensitiveFields(asset) && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-brand-cyan">
              <Lock className="size-3" aria-hidden /> Encrypted fields
            </span>
          )}
        </div>
        <div className="mt-auto space-y-2">
          {allocation.length ? (
            <AllocationBar segments={allocation} showLegend={false} />
          ) : (
            <div className="h-2.5 w-full rounded-full bg-muted" aria-hidden />
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5" aria-hidden />
            {allocation.length
              ? `${allocation.length} beneficiar${allocation.length === 1 ? "y" : "ies"} · ${total}% allocated`
              : "No beneficiary assigned"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export { Building2 as InstitutionIcon };
