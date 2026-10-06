"use client";

import Link from "next/link";
import { ArrowRight, Coins, Gem, Globe, Lock, Plus, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { StaggerGrid, StaggerItem } from "@/components/shared/page-transition";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAssets } from "@/hooks/use-assets";
import { ASSET_KIND_META, assetTotal, hasSensitiveFields } from "@/lib/assets/meta";
import type { AssetKind, AssetWithAssignments } from "@/lib/types/asset";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const icons: Record<AssetKind, typeof Coins> = {
  FINANCIAL_ASSET: Coins,
  PHYSICAL_ASSET: Gem,
  DIGITAL_ASSET: Globe,
};
const fills: Record<AssetKind, string> = {
  FINANCIAL_ASSET: "bg-viz-1",
  PHYSICAL_ASSET: "bg-viz-2",
  DIGITAL_ASSET: "bg-viz-3",
};

const KINDS: AssetKind[] = ["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"];

/** Assets overview (task T089) — aggregates the three real asset lists. */
export function AssetsOverview() {
  const financial = useAssets("FINANCIAL_ASSET");
  const physical = useAssets("PHYSICAL_ASSET");
  const digital = useAssets("DIGITAL_ASSET");

  const byKind: Record<AssetKind, AssetWithAssignments[]> = {
    FINANCIAL_ASSET: financial.data?.items ?? [],
    PHYSICAL_ASSET: physical.data?.items ?? [],
    DIGITAL_ASSET: digital.data?.items ?? [],
  };
  const ready = !financial.isPending && !physical.isPending && !digital.isPending;
  if (!ready) return <PageSkeleton stats={3} />;

  const items = KINDS.flatMap((kind) => byKind[kind]);
  const assets = items.map((item) => item.asset);
  const total = assetTotal(assets);
  const unassigned = items.filter((item) => item.assignments.length === 0).map((i) => i.asset);
  const encrypted = assets.filter(hasSensitiveFields).length;
  const distribution = KINDS.map((kind) => {
    const list = byKind[kind].map((item) => item.asset);
    const value = assetTotal(list);
    return {
      kind,
      count: list.length,
      value,
      share: total ? Math.round((value / total) * 100) : 0,
    };
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Assets"
        title="Assets"
        description="Everything you own in one inventory — assigned to beneficiaries and referenced by your legacy plan."
        actions={
          <Button nativeButton={false} render={<Link href="/assets/financial?new=1" />}>
            <Plus data-icon="inline-start" />
            Add asset
          </Button>
        }
      />

      <StaggerGrid className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Estimated total"
            value={formatCompactCurrency(total)}
            hint={formatCurrency(total)}
            accent="blue"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Assets recorded"
            value={assets.length}
            hint={`${distribution.map((d) => `${d.count} ${ASSET_KIND_META[d.kind].label.toLowerCase()}`).join(" · ")}`}
            accent="blue"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Unassigned"
            value={unassigned.length}
            hint={
              unassigned.length ? "Assign a beneficiary to each" : "Every asset has a beneficiary"
            }
            icon={Users}
            accent={unassigned.length ? "warning" : "success"}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Encrypted fields"
            value={encrypted}
            hint="Revealed only after re-verification"
            icon={Lock}
            accent="cyan"
          />
        </StaggerItem>
      </StaggerGrid>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="glass-highlight glass lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Value by asset class</CardTitle>
            <p className="text-sm text-muted-foreground">
              Share of your estimated total. Each class is labelled directly.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div
              className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={distribution
                .map((d) => `${ASSET_KIND_META[d.kind].label} ${d.share}%`)
                .join(", ")}
            >
              {distribution.map((d) => (
                <span
                  key={d.kind}
                  className={cn("h-full rounded-sm", fills[d.kind])}
                  style={{ width: `${d.share}%` }}
                />
              ))}
            </div>
            <ul className="grid gap-3 sm:grid-cols-3">
              {distribution.map((d) => {
                const Icon = icons[d.kind];
                return (
                  <li key={d.kind}>
                    <Link
                      href={ASSET_KIND_META[d.kind].href}
                      className="group flex items-start gap-3 rounded-xl border border-border p-3 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        aria-hidden
                        className={cn("mt-1 size-2.5 shrink-0 rounded-sm", fills[d.kind])}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <Icon className="size-4 text-muted-foreground" aria-hidden />
                          {ASSET_KIND_META[d.kind].label}
                        </span>
                        <span className="block text-lg font-semibold tabular-nums">
                          {formatCompactCurrency(d.value)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {d.share}% · {d.count} item{d.count === 1 ? "" : "s"}
                        </span>
                      </span>
                      <ArrowRight
                        className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Needs a beneficiary</CardTitle>
            <p className="text-sm text-muted-foreground">
              {unassigned.length
                ? "These assets are not part of anyone’s inheritance yet."
                : "Every asset is assigned."}
            </p>
          </CardHeader>
          <CardContent>
            {unassigned.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                All set — nothing is unassigned.
              </p>
            ) : (
              <ul className="space-y-2">
                {unassigned.slice(0, 6).map((asset) => {
                  const Icon = icons[asset.kind];
                  return (
                    <li key={asset.id}>
                      <Link
                        href={`${ASSET_KIND_META[asset.kind].href}`}
                        className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Icon className="size-4 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatCompactCurrency(asset.estimatedValue, asset.currency)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
