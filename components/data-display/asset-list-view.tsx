"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, MoreHorizontal, Pencil, Plus, Search, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { AllocationBar } from "@/components/data-display/allocation-bar";
import { AssetCard } from "@/components/data-display/asset-card";
import { AssignAssetDialog } from "@/components/forms/assign-asset-dialog";
import { AssetFormSheet } from "@/components/forms/asset-form";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
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
import {
  useAssets,
  useDeleteAsset,
  useRevealSensitiveFields,
  useUnassignBeneficiary,
} from "@/hooks/use-assets";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/api/client";
import { ASSET_KIND_META, assetSubtitle, assetTotal, hasSensitiveFields } from "@/lib/assets/meta";
import type { Asset, AssetKind, AssetWithAssignments } from "@/lib/types/asset";
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

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Shared list view for the three asset classes (tasks T083 / T086 / T088).
 *
 * Everything here is persisted through `/api/v1/assets/:type`: creation runs in
 * `create_asset()`, deletion in `delete_asset()`, assignment in
 * `assign_beneficiary()`. Sensitive values are only ever fetched by the reveal
 * dialog, which is gated on Clerk re-verification server-side.
 */
export function AssetListView({ kind }: { kind: AssetKind }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = useNow();
  const meta = ASSET_KIND_META[kind];
  const copy = COPY[kind];

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [formOpen, setFormOpen] = useState(() => searchParams.get("new") === "1");
  const [editing, setEditing] = useState<Asset | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Asset | null>(null);

  const search = useDeferredValue(query.trim());
  const list = useAssets(kind, {
    ...(category === "all" ? {} : { category }),
    ...(search ? { q: search } : {}),
  });
  // Only fetch the unfiltered inventory when a filter would otherwise hide part
  // of it; without one the list query already covers the whole class.
  const filtering = category !== "all" || Boolean(search);
  const everything = useAssets(kind, {}, { enabled: filtering });
  const inventory = filtering ? everything : list;

  const remove = useDeleteAsset(kind);
  const unassign = useUnassignBeneficiary(kind);
  const reveal = useRevealSensitiveFields(kind);

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const all = useMemo(() => inventory.data?.items ?? [], [inventory.data]);
  const ready = !inventory.isPending;

  const categories =
    kind === "FINANCIAL_ASSET"
      ? FINANCIAL_CATEGORIES
      : kind === "PHYSICAL_ASSET"
        ? PHYSICAL_CATEGORIES
        : DIGITAL_CATEGORIES;

  const assets = all.map((item) => item.asset);
  const unassignedCount = all.filter((item) => item.assignments.length === 0).length;
  const encryptedCount = assets.filter(hasSensitiveFields).length;

  const detail = detailId ? (rows.find((item) => item.asset.id === detailId) ?? null) : null;
  const assignTarget = assignFor
    ? (rows.find((item) => item.asset.id === assignFor) ?? null)
    : null;

  const segmentsFor = (item: AssetWithAssignments) =>
    item.assignments
      .filter((assignment) => assignment.allocationPercentage)
      .map((assignment) => ({
        id: assignment.id,
        label: assignment.beneficiaryName,
        value: assignment.allocationPercentage ?? 0,
      }));

  const openForm = (asset: Asset | null) => {
    setEditing(asset);
    setFormOpen(true);
    if (searchParams.get("new") === "1") router.replace(meta.href);
  };

  const revealField = (assetId: string, field: string) => async () => {
    const values = await reveal.mutateAsync(assetId);
    return (values as Record<string, string | null | undefined>)[field] ?? null;
  };

  const menuFor = (asset: Asset) => (
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
        <DropdownMenuItem onClick={() => openForm(asset)}>
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
          <Button className="shadow-glow-blue" onClick={() => openForm(null)}>
            <Plus data-icon="inline-start" />
            Add asset
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Recorded"
          value={ready ? (inventory.data?.total ?? assets.length) : "—"}
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assets"
            className="pl-8"
            aria-label="Search assets"
          />
        </div>
        <Tabs
          value={category}
          onValueChange={(value) => setCategory(String(value))}
          className="max-w-full"
        >
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="all">All</TabsTrigger>
            {categories.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {list.isError ? (
        <ErrorState
          title="Could not load these assets"
          description={messageFor(list.error, "Please try again in a moment.")}
          correlationId={list.error instanceof ApiError ? list.error.correlationId : undefined}
          onRetry={() => void list.refetch()}
        />
      ) : list.isPending ? (
        <GridSkeleton />
      ) : rows.length === 0 ? (
        search || category !== "all" ? (
          <EmptyState
            compact
            icon={Search}
            title="No matches"
            description="Try a different search or category."
          />
        ) : (
          <EmptyState
            icon={copy.icon}
            title={`No ${copy.title.toLowerCase()} yet`}
            description="Record what you own so it can be assigned to the right people and included in your plan."
            action={
              <Button onClick={() => openForm(null)}>
                <Plus data-icon="inline-start" />
                Add your first asset
              </Button>
            }
          />
        )
      ) : (
        <StaggerGrid className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((item) => (
            <StaggerItem key={item.asset.id}>
              <AssetCard
                asset={item.asset}
                allocation={segmentsFor(item)}
                onOpen={() => setDetailId(item.asset.id)}
                menu={menuFor(item.asset)}
              />
            </StaggerItem>
          ))}
        </StaggerGrid>
      )}

      <AssetFormSheet kind={kind} open={formOpen} onOpenChange={setFormOpen} asset={editing} />

      <AssignAssetDialog
        open={Boolean(assignFor)}
        onOpenChange={(open) => !open && setAssignFor(null)}
        kind={kind}
        assetId={assignFor}
        assetName={assignTarget?.asset.name}
        assignments={assignTarget?.assignments ?? []}
        remainingPercentage={assignTarget?.remainingPercentage ?? 100}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Delete ${removeTarget?.name ?? "asset"}?`}
        description="The asset is soft-deleted in one transaction together with its beneficiary assignments and document attachments. The audit record is kept."
        confirmLabel="Delete asset"
        variant="destructive"
        onConfirm={async () => {
          if (!removeTarget) return;
          try {
            await remove.mutateAsync(removeTarget.id);
            toast.success(`${removeTarget.name} deleted`);
            if (detailId === removeTarget.id) setDetailId(null);
          } catch (error) {
            toast.error(messageFor(error, "Could not delete this asset."));
          }
        }}
      />

      <Sheet open={Boolean(detailId)} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader className="pr-10">
                <SheetTitle>{detail.asset.name}</SheetTitle>
                <SheetDescription>{assetSubtitle(detail.asset)}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openForm(detail.asset)}>
                    <Pencil data-icon="inline-start" />
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAssignFor(detail.asset.id)}>
                    <KeyRound data-icon="inline-start" />
                    Assign beneficiary
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setRemoveTarget(detail.asset)}
                  >
                    <Trash2 data-icon="inline-start" />
                    Delete
                  </Button>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Estimated value</dt>
                    <dd className="font-medium">
                      {formatCurrency(detail.asset.estimatedValue, detail.asset.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Category</dt>
                    <dd className="font-medium">{titleCase(detail.asset.category)}</dd>
                  </div>
                  {detail.asset.kind === "FINANCIAL_ASSET" && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Institution</dt>
                      <dd className="font-medium">{detail.asset.institution ?? "—"}</dd>
                    </div>
                  )}
                  {detail.asset.kind === "PHYSICAL_ASSET" && (
                    <>
                      <div>
                        <dt className="text-xs text-muted-foreground">Location</dt>
                        <dd className="font-medium">{detail.asset.location ?? "—"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-muted-foreground">Ownership</dt>
                        <dd className="font-medium">{detail.asset.ownershipDetails ?? "—"}</dd>
                      </div>
                    </>
                  )}
                  {detail.asset.kind === "DIGITAL_ASSET" && (
                    <>
                      <div>
                        <dt className="text-xs text-muted-foreground">Platform</dt>
                        <dd className="font-medium">{detail.asset.platform ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Username</dt>
                        <dd className="font-medium">{detail.asset.username ?? "—"}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Updated</dt>
                    <dd className="font-medium">{formatRelative(detail.asset.updatedAt, now)}</dd>
                  </div>
                </dl>

                {detail.asset.kind === "FINANCIAL_ASSET" && (
                  <div className="space-y-2">
                    <MaskedField
                      label="Account number"
                      present={detail.asset.hasAccountNumber}
                      onReveal={revealField(detail.asset.id, "accountNumber")}
                    />
                    <MaskedField
                      label="Policy number"
                      present={detail.asset.hasPolicyNumber}
                      onReveal={revealField(detail.asset.id, "policyNumber")}
                    />
                  </div>
                )}
                {detail.asset.kind === "DIGITAL_ASSET" && (
                  <div className="space-y-2">
                    <MaskedField
                      label="Credentials"
                      present={detail.asset.hasCredentials}
                      onReveal={revealField(detail.asset.id, "credentials")}
                    />
                    <MaskedField
                      label="Recovery information"
                      present={detail.asset.hasRecoveryInfo}
                      onReveal={revealField(detail.asset.id, "recoveryInfo")}
                    />
                  </div>
                )}
                {detail.asset.kind === "PHYSICAL_ASSET" && detail.asset.description && (
                  <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    {detail.asset.description}
                  </p>
                )}
                {detail.asset.notes && (
                  <p className="text-sm text-muted-foreground">{detail.asset.notes}</p>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Beneficiaries</p>
                    <span className="text-xs text-muted-foreground">
                      {detail.allocatedPercentage}% allocated · {detail.remainingPercentage}% free
                    </span>
                  </div>
                  {detail.assignments.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                      Nobody is assigned to this asset yet.
                    </p>
                  ) : (
                    <>
                      <AllocationBar segments={segmentsFor(detail)} />
                      <ul className="space-y-2">
                        {detail.assignments.map((assignment) => (
                          <li
                            key={assignment.id}
                            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                          >
                            <span>
                              {assignment.beneficiaryName}
                              <span className="text-muted-foreground">
                                {" "}
                                ·{" "}
                                {assignment.allocationPercentage !== null
                                  ? `${assignment.allocationPercentage}%`
                                  : "no percentage"}
                              </span>
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={unassign.isPending}
                              onClick={async () => {
                                try {
                                  await unassign.mutateAsync({
                                    id: detail.asset.id,
                                    assignmentId: assignment.id,
                                  });
                                  toast.success("Assignment removed");
                                } catch (error) {
                                  toast.error(
                                    messageFor(error, "Could not remove this assignment."),
                                  );
                                }
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
