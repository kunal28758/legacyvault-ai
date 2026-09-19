"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, MoreHorizontal, Pencil, Plus, Search, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { AllocationBar } from "@/components/data-display/allocation-bar";
import { AssetCard, assetSubtitle, hasSensitiveFields } from "@/components/data-display/asset-card";
import { AssignDialog } from "@/components/forms/assign-dialog";
import { AssetFormSheet } from "@/components/forms/asset-form";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { GridSkeleton } from "@/components/shared/loading-skeleton";
import { MaskedField } from "@/components/shared/masked-field";
import { PageHeader } from "@/components/shared/page-header";
import { StaggerGrid, StaggerItem } from "@/components/shared/page-transition";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDemoWorkspace, useNow } from "@/hooks/use-demo-workspace";
import {
  ASSET_KIND_META,
  assetTotal,
  assetsOfKind,
  assignmentsForResource,
} from "@/lib/demo/selectors";
import { useDemoStore } from "@/lib/demo/store";
import type { AssetKind, DemoAsset } from "@/lib/demo/types";
import { formatCompactCurrency, formatCurrency, formatRelative, titleCase } from "@/lib/format";
import {
  DIGITAL_CATEGORIES,
  FINANCIAL_CATEGORIES,
  PHYSICAL_CATEGORIES,
} from "@/lib/validators/asset.validators";

const COPY: Record<AssetKind, { title: string; description: string; icon: typeof Wallet }> = {
  FINANCIAL_ASSET: {
    title: "Financial assets",
    description:
      "Bank accounts, deposits, funds, insurance and retirement accounts. Account and policy numbers are encrypted and revealed only after re-verification.",
    icon: Wallet,
  },
  PHYSICAL_ASSET: {
    title: "Physical assets",
    description:
      "Property, vehicles, jewellery and other valuables — with ownership details and supporting documents from the vault.",
    icon: Wallet,
  },
  DIGITAL_ASSET: {
    title: "Digital assets",
    description:
      "Online accounts, domains, wallets and subscriptions. Credentials and recovery information are never displayed by default.",
    icon: Wallet,
  },
};

/** Shared list view for the three asset classes (tasks T083 / T086 / T088 — UI). */
export function AssetListView({ kind }: { kind: AssetKind }) {
  const { workspace: ws, ready } = useDemoWorkspace();
  const removeAsset = useDemoStore((s) => s.removeAsset);
  const unassign = useDemoStore((s) => s.unassign);
  const now = useNow();
  const router = useRouter();
  const searchParams = useSearchParams();
  const meta = ASSET_KIND_META[kind];
  const copy = COPY[kind];

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const openNew = searchParams.get("new") === "1";
  const [formOpen, setFormOpen] = useState(openNew);
  const [editing, setEditing] = useState<DemoAsset | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DemoAsset | null>(null);

  useEffect(() => {
    if (openNew) router.replace(meta.href);
  }, [openNew, router, meta.href]);

  const assets = assetsOfKind(ws, kind);
  const categories =
    kind === "FINANCIAL_ASSET"
      ? FINANCIAL_CATEGORIES
      : kind === "PHYSICAL_ASSET"
        ? PHYSICAL_CATEGORIES
        : DIGITAL_CATEGORIES;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter(
      (a) =>
        (category === "all" || a.category === category) &&
        (!q || a.name.toLowerCase().includes(q) || assetSubtitle(a).toLowerCase().includes(q)),
    );
  }, [assets, query, category]);

  const allocationFor = (asset: DemoAsset) =>
    assignmentsForResource(ws, kind, asset.id)
      .filter((a) => a.allocationPercentage)
      .map((a) => ({
        id: a.id,
        label: ws.beneficiaries.find((b) => b.id === a.beneficiaryId)?.name ?? "Beneficiary",
        value: a.allocationPercentage ?? 0,
      }));

  const detail = detailId ? (assets.find((a) => a.id === detailId) ?? null) : null;
  const unassignedCount = assets.filter(
    (a) => assignmentsForResource(ws, kind, a.id).length === 0,
  ).length;
  const encryptedCount = assets.filter(hasSensitiveFields).length;

  const menuFor = (asset: DemoAsset) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${asset.name}`} />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => setDetailId(asset.id)}>
          <Search /> View details
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setEditing(asset);
            setFormOpen(true);
          }}
        >
          <Pencil /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setAssignFor(asset.id)}>
          <KeyRound /> Assign beneficiary
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => setRemoveTarget(asset)}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assets"
        title={copy.title}
        description={copy.description}
        actions={
          <Button
            className="shadow-glow-blue"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus data-icon="inline-start" />
            Add asset
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Recorded"
          value={ready ? assets.length : "—"}
          icon={copy.icon}
          accent="blue"
        />
        <StatCard
          label="Estimated total"
          value={ready ? formatCompactCurrency(assetTotal(assets)) : "—"}
          hint="Sum of estimated values"
          accent="purple"
        />
        <StatCard
          label="Unassigned"
          value={ready ? unassignedCount : "—"}
          hint={encryptedCount ? `${encryptedCount} with encrypted fields` : "All values plain"}
          accent={unassignedCount ? "warning" : "success"}
        />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets"
            className="pl-8"
            aria-label="Search assets"
          />
        </div>
        <Tabs value={category} onValueChange={(v) => setCategory(String(v))} className="max-w-full">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="all">All</TabsTrigger>
            {categories.map((c) => (
              <TabsTrigger key={c.value} value={c.value}>
                {c.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {!ready ? (
        <GridSkeleton />
      ) : rows.length === 0 ? (
        assets.length === 0 ? (
          <EmptyState
            icon={copy.icon}
            title={`No ${copy.title.toLowerCase()} yet`}
            description="Record what you own so it can be assigned to the right people and included in your plan."
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus data-icon="inline-start" />
                Add your first asset
              </Button>
            }
          />
        ) : (
          <EmptyState
            compact
            icon={Search}
            title="No matches"
            description="Try a different search or category."
          />
        )
      ) : (
        <StaggerGrid className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((asset) => (
            <StaggerItem key={asset.id}>
              <AssetCard
                asset={asset}
                allocation={allocationFor(asset)}
                onOpen={() => setDetailId(asset.id)}
                menu={menuFor(asset)}
              />
            </StaggerItem>
          ))}
        </StaggerGrid>
      )}

      <AssetFormSheet kind={kind} open={formOpen} onOpenChange={setFormOpen} asset={editing} />
      <AssignDialog
        open={Boolean(assignFor)}
        onOpenChange={(open) => !open && setAssignFor(null)}
        resource={assignFor ? { type: kind, id: assignFor } : null}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Delete ${removeTarget?.name ?? "asset"}?`}
        description="The asset is soft-deleted in one transaction together with its beneficiary assignments and document attachments. The audit record is kept."
        confirmLabel="Delete asset"
        variant="destructive"
        requiresReverification={Boolean(
          removeTarget && assignmentsForResource(ws, kind, removeTarget.id).length,
        )}
        onConfirm={() => {
          if (!removeTarget) return;
          const result = removeAsset(removeTarget.id);
          if (result.ok) {
            toast.success(`${removeTarget.name} deleted`);
            if (detailId === removeTarget.id) setDetailId(null);
          } else toast.error(result.message);
        }}
      />

      <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader className="pr-10">
                <SheetTitle>{detail.name}</SheetTitle>
                <SheetDescription>{assetSubtitle(detail)}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(detail);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil data-icon="inline-start" />
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAssignFor(detail.id)}>
                    <KeyRound data-icon="inline-start" />
                    Assign beneficiary
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setRemoveTarget(detail)}
                  >
                    <Trash2 data-icon="inline-start" />
                    Delete
                  </Button>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Estimated value</dt>
                    <dd className="font-medium">
                      {formatCurrency(detail.estimatedValue, detail.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Category</dt>
                    <dd className="font-medium">{titleCase(detail.category)}</dd>
                  </div>
                  {detail.kind === "FINANCIAL_ASSET" && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Institution</dt>
                      <dd className="font-medium">{detail.institution ?? "—"}</dd>
                    </div>
                  )}
                  {detail.kind === "PHYSICAL_ASSET" && (
                    <>
                      <div>
                        <dt className="text-xs text-muted-foreground">Location</dt>
                        <dd className="font-medium">{detail.location ?? "—"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-muted-foreground">Ownership</dt>
                        <dd className="font-medium">{detail.ownershipDetails ?? "—"}</dd>
                      </div>
                    </>
                  )}
                  {detail.kind === "DIGITAL_ASSET" && (
                    <>
                      <div>
                        <dt className="text-xs text-muted-foreground">Platform</dt>
                        <dd className="font-medium">{detail.platform ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Username</dt>
                        <dd className="font-medium">{detail.username ?? "—"}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Updated</dt>
                    <dd className="font-medium">{formatRelative(detail.updatedAt, now)}</dd>
                  </div>
                </dl>

                {detail.kind === "FINANCIAL_ASSET" && (
                  <div className="space-y-2">
                    <MaskedField
                      label="Account number"
                      hint={detail.accountNumberHint}
                      present={Boolean(detail.accountNumberHint)}
                    />
                    <MaskedField
                      label="Policy number"
                      hint={detail.policyNumberHint}
                      present={Boolean(detail.policyNumberHint)}
                    />
                  </div>
                )}
                {detail.kind === "DIGITAL_ASSET" && (
                  <div className="space-y-2">
                    <MaskedField label="Credentials" present={detail.hasCredentials} />
                    <MaskedField label="Recovery information" present={detail.hasRecoveryInfo} />
                  </div>
                )}
                {detail.kind === "PHYSICAL_ASSET" && detail.description && (
                  <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    {detail.description}
                  </p>
                )}
                {detail.notes && <p className="text-sm text-muted-foreground">{detail.notes}</p>}

                <div className="space-y-3">
                  <p className="text-sm font-medium">Beneficiaries</p>
                  {assignmentsForResource(ws, kind, detail.id).length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                      Nobody is assigned to this asset yet.
                    </p>
                  ) : (
                    <>
                      <AllocationBar segments={allocationFor(detail)} />
                      <ul className="space-y-2">
                        {assignmentsForResource(ws, kind, detail.id).map((a) => (
                          <li
                            key={a.id}
                            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                          >
                            <span>
                              {ws.beneficiaries.find((b) => b.id === a.beneficiaryId)?.name ??
                                "Beneficiary"}
                              <span className="text-muted-foreground">
                                {" "}
                                ·{" "}
                                {a.allocationPercentage !== null
                                  ? `${a.allocationPercentage}%`
                                  : "no percentage"}
                              </span>
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                unassign(a.id);
                                toast.success("Assignment removed");
                              }}
                            >
                              Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
