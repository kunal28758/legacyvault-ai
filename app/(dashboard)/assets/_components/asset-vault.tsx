"use client";

import { useDeferredValue, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Coins,
  FileText,
  Gem,
  Globe,
  Plus,
  ScanSearch,
  Search,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { PriorityBadge } from "@/components/legacy/action-list";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard, StatCardSkeleton } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAssets } from "@/hooks/use-assets";
import { useLegacyState } from "@/hooks/use-legacy-snapshot";
import { ASSET_KIND_META, assetSubtitle, categoryLabel } from "@/lib/assets/meta";
import { findingsFor, RULES, type Finding, type RuleId } from "@/lib/client/intelligence";
import { assetHref, assetKey } from "@/lib/client/legacy-graph";
import { formatCompactCurrency, formatCurrency, pluralize } from "@/lib/format";
import type { AssetKind, AssetWithAssignments } from "@/lib/types/asset";
import { ASSET_STATUS_LABELS, ASSET_STATUSES, isHeld } from "@/lib/types/asset-profile";
import { cn } from "@/lib/utils";

/** The form (and its validators) loads only when the owner adds an asset. */
const AssetFormSheet = dynamic(
  () => import("@/components/assets/asset-form").then((module) => module.AssetFormSheet),
  { ssr: false },
);

const KINDS: AssetKind[] = ["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"];
const ICONS: Record<AssetKind, LucideIcon> = {
  FINANCIAL_ASSET: Coins,
  PHYSICAL_ASSET: Gem,
  DIGITAL_ASSET: Globe,
};
const ACCENTS: Record<AssetKind, string> = {
  FINANCIAL_ASSET: "bg-viz-1/20 text-viz-1",
  PHYSICAL_ASSET: "bg-viz-2/20 text-viz-2",
  DIGITAL_ASSET: "bg-viz-3/20 text-viz-3",
};
const SLUG_KIND: Record<string, AssetKind> = {
  financial: "FINANCIAL_ASSET",
  physical: "PHYSICAL_ASSET",
  digital: "DIGITAL_ASSET",
};
/** URL params are untrusted: only a class slug the vault knows selects one. */
const kindFromSlug = (slug: string | null) =>
  slug && Object.hasOwn(SLUG_KIND, slug) ? SLUG_KIND[slug] : null;
const isRule = (value: string): value is RuleId => Object.hasOwn(RULES, value);

/** Attention filters: every option maps to findings the engine actually raised. */
const ATTENTION: { value: string; label: string }[] = [
  { value: "all", label: "All assets" },
  { value: "attention", label: "Needs attention" },
  { value: "ASSET-BEN-001", label: "No beneficiary" },
  { value: "ASSET-DOC-001", label: "No supporting document" },
  { value: "ASSET-INSTR-001", label: "No instructions" },
  { value: "ASSET-STALE-001", label: "Not reviewed in a year" },
  { value: "conflicts", label: "Potential conflicts" },
  { value: "RULE-004", label: "Potential duplicates" },
];

const SORTS = [
  { value: "name", label: "Name" },
  { value: "value", label: "Estimated value" },
  { value: "updated", label: "Recently updated" },
  { value: "review", label: "Next review or expiry" },
] as const;
type SortKey = (typeof SORTS)[number]["value"];

interface Row {
  item: AssetWithAssignments;
  /** null until Legacy Intelligence has every source loaded. */
  findings: Finding[] | null;
  /** null while unknown: still loading, or more documents than one page. */
  documents: number | null;
}

/** Sums per currency — values in different currencies are never added together. */
function totalsByCurrency(rows: Row[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const { item } of rows) {
    if (item.asset.estimatedValue == null) continue;
    totals.set(
      item.asset.currency,
      (totals.get(item.asset.currency) ?? 0) + item.asset.estimatedValue,
    );
  }
  return [...totals].sort((a, b) => b[1] - a[1]);
}

const SEVERITY_ORDER = ["CRITICAL", "IMPORTANT", "UPCOMING", "RECOMMENDED"] as const;
const worst = (findings: Finding[]) =>
  SEVERITY_ORDER.find((severity) => findings.some((finding) => finding.severity === severity));

/**
 * Asset Vault: everything the owner holds across the three asset classes, with
 * the relationships and findings the intelligence engine derives for each.
 * Every number comes from the owner's own records; nothing is created for them.
 *
 * Renders progressively: the assets (and their values) show as soon as the
 * three asset lists load; findings, document links and the attention stats
 * fill in once every source Legacy Intelligence reads has loaded. The asset
 * queries are the ones useLegacyState already makes (same keys, no new requests).
 */
export function AssetVault() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Declared before useLegacyState so the asset lists are requested first.
  const financial = useAssets("FINANCIAL_ASSET");
  const physical = useAssets("PHYSICAL_ASSET");
  const digital = useAssets("DIGITAL_ASSET");
  const legacy = useLegacyState();
  const { state } = legacy;
  const assetsFailed = [financial, physical, digital].some((list) => list.isError && !list.data);

  const requestedRule = searchParams.get("rule");
  const [kind, setKind] = useState<AssetKind | "all">(
    () => kindFromSlug(searchParams.get("kind")) ?? "all",
  );
  const [attention, setAttention] = useState(() => {
    const requested = requestedRule ?? searchParams.get("filter") ?? "all";
    return ATTENTION.some((option) => option.value === requested) || isRule(requested)
      ? requested
      : "all";
  });
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  // The sheet stays mounted after first use so it can animate closed.
  const [formKind, setFormKind] = useState<AssetKind | null>(() =>
    kindFromSlug(searchParams.get("new")),
  );
  const [formOpen, setFormOpen] = useState(() => Boolean(kindFromSlug(searchParams.get("new"))));
  const setAdding = (option: AssetKind) => {
    setFormKind(option);
    setFormOpen(true);
  };
  const search = useDeferredValue(query.trim().toLowerCase());

  const rows = useMemo<Row[] | null>(() => {
    if (state) {
      const { graph, open, coverage } = state.intelligence;
      return state.records.assets.map((item) => {
        const documents = graph.in(assetKey(item.asset.id), "documents").length;
        return {
          item,
          findings: findingsFor(open, "asset", item.asset.id),
          // Zero links is only certain when every document was loaded.
          documents: documents || coverage.documentsComplete ? documents : null,
        };
      });
    }
    if (!financial.data || !physical.data || !digital.data) return null;
    return [...financial.data.items, ...physical.data.items, ...digital.data.items].map((item) => ({
      item,
      findings: null,
      documents: null,
    }));
  }, [state, financial.data, physical.data, digital.data]);
  /** Findings are still being computed (as opposed to unavailable). */
  const checking = !state && !legacy.isError;

  const visible = useMemo(() => {
    const filtered = (rows ?? []).filter(({ item, findings }) => {
      const { asset } = item;
      if (kind !== "all" && asset.kind !== kind) return false;
      if (status !== "all" && (asset.profile?.status ?? "ACTIVE") !== status) return false;
      if (attention === "attention" && !findings?.length) return false;
      if (attention === "conflicts" && !findings?.some((f) => f.type === "CONFLICT")) return false;
      if (isRule(attention) && !findings?.some((f) => f.ruleId === attention)) return false;
      if (search) {
        const haystack = [
          asset.name,
          categoryLabel(asset.kind, asset.category),
          assetSubtitle(asset),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    const nextDate = (row: Row) => {
      const dates = [row.item.asset.profile?.reviewOn, row.item.asset.profile?.expiresOn].filter(
        Boolean,
      ) as string[];
      return dates.length ? dates.sort()[0] : "9999-12-31";
    };
    return filtered.sort((a, b) => {
      if (sort === "value")
        return (b.item.asset.estimatedValue ?? -1) - (a.item.asset.estimatedValue ?? -1);
      if (sort === "updated")
        return Date.parse(b.item.asset.updatedAt) - Date.parse(a.item.asset.updatedAt);
      if (sort === "review") return nextDate(a).localeCompare(nextDate(b));
      return a.item.asset.name.localeCompare(b.item.asset.name);
    });
  }, [rows, kind, status, attention, search, sort]);

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button className="shadow-glow-blue" />}>
        <Plus data-icon="inline-start" />
        Add asset
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {KINDS.map((option) => {
          const Icon = ICONS[option];
          return (
            <DropdownMenuItem key={option} onClick={() => setAdding(option)}>
              <Icon /> {ASSET_KIND_META[option].label} asset
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const header = (
    <PageHeader
      eyebrow="Vault"
      title="Asset Vault"
      description="What you own, the documents that support it, and who should receive it — checked by Legacy Intelligence against the rest of your legacy."
      actions={addMenu}
    />
  );
  const form = formKind && (
    <AssetFormSheet
      kind={formKind}
      open={formOpen}
      onOpenChange={(open) => {
        if (open) return;
        setFormOpen(false);
        if (searchParams.get("new")) router.replace("/assets");
      }}
      asset={null}
    />
  );

  if (assetsFailed) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Could not load your Asset Vault"
          description="Your data is safe — this view could not reach it. Try again in a moment."
          onRetry={legacy.refetch}
        />
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="space-y-6">
        {header}
        <div role="status" aria-label="Loading assets" className="space-y-6">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <StatCardSkeleton key={index} />
            ))}
          </div>
          <CardSkeleton rows={5} />
          <span className="sr-only">Loading…</span>
        </div>
        {form}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Wallet}
          title="Your Asset Vault is empty"
          description="Record what you own — accounts, property, valuables and online accounts — so LegacyVault can connect each asset to its documents and the people who should receive it. Nothing is added for you."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {KINDS.map((option) => {
                const Icon = ICONS[option];
                return (
                  <Button key={option} variant="outline" onClick={() => setAdding(option)}>
                    <Icon data-icon="inline-start" />
                    Add {ASSET_KIND_META[option].label.toLowerCase()} asset
                  </Button>
                );
              })}
            </div>
          }
        />
        {form}
      </div>
    );
  }

  const held = rows.filter(({ item }) => isHeld(item.asset.profile));
  const totals = totalsByCurrency(held);
  const needing = held.filter(({ findings }) => findings?.length);
  const unassigned = held.filter(({ findings }) =>
    findings?.some((f) => f.ruleId === "ASSET-BEN-001"),
  );
  const conflicts = (state?.intelligence.open ?? []).filter(
    (finding) =>
      finding.type === "CONFLICT" &&
      finding.sourceRecords.some((record) => record.kind === "asset"),
  );
  // Attention filters need findings; until then the table waits rather than
  // showing a misleading "no assets match".
  const awaitingFindings = !state && attention !== "all";
  const filtering = kind !== "all" || status !== "all" || attention !== "all" || Boolean(search);

  const columns: DataTableColumn<Row>[] = [
    {
      id: "asset",
      header: "Asset",
      cell: ({ item }) => <AssetName item={item} />,
    },
    {
      id: "status",
      header: "Status",
      hideBelowLg: true,
      cell: ({ item }) => <AssetStatusBadge item={item} />,
    },
    {
      id: "value",
      header: "Estimated value",
      align: "right",
      cell: ({ item }) => (
        <span className="tabular-nums">
          {item.asset.estimatedValue != null
            ? formatCurrency(item.asset.estimatedValue, item.asset.currency)
            : "—"}
        </span>
      ),
    },
    {
      id: "beneficiaries",
      header: "Beneficiaries",
      cell: ({ item }) => <BeneficiaryCell item={item} />,
    },
    {
      id: "documents",
      header: "Documents",
      hideBelowLg: true,
      cell: ({ documents }) =>
        documents === null ? (
          checking ? (
            <Skeleton className="h-4 w-20" />
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )
        ) : (
          <span className={cn("text-sm", documents === 0 && "text-muted-foreground")}>
            {documents ? pluralize(documents, "document") : "None linked"}
          </span>
        ),
    },
    {
      id: "attention",
      header: "Intelligence",
      cell: ({ findings }) => <AttentionCell findings={findings} checking={checking} />,
    },
  ];

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Estimated value"
          value={totals.length ? formatCompactCurrency(totals[0][1], totals[0][0]) : "—"}
          hint={
            totals.length > 1
              ? `Also ${totals
                  .slice(1)
                  .map(([currency, value]) => formatCurrency(value, currency))
                  .join(" · ")} — currencies are not converted`
              : totals.length
                ? "Assets you still hold"
                : "No values recorded yet"
          }
          icon={Wallet}
          accent="blue"
        />
        <StatCard
          label="Assets recorded"
          value={rows.length}
          hint={KINDS.map(
            (option) =>
              `${rows.filter(({ item }) => item.asset.kind === option).length} ${ASSET_KIND_META[option].label.toLowerCase()}`,
          ).join(" · ")}
          icon={Coins}
          accent="blue"
        />
        {state ? (
          <>
            <StatCard
              label="Need attention"
              value={needing.length}
              hint={
                unassigned.length
                  ? `${pluralize(unassigned.length, "asset")} without a beneficiary`
                  : "Every held asset has a beneficiary"
              }
              icon={unassigned.length ? Users : CheckCircle2}
              accent={needing.length ? "warning" : "success"}
            />
            <StatCard
              label="Potential conflicts"
              value={conflicts.length}
              hint={conflicts.length ? "Review recommended" : "No conflicts detected"}
              icon={conflicts.length ? AlertTriangle : ScanSearch}
              accent={conflicts.length ? "warning" : "success"}
              href={conflicts.length ? "/intelligence?type=CONFLICT" : undefined}
            />
          </>
        ) : checking ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <p className="col-span-2 self-center text-sm text-muted-foreground">
            Legacy Intelligence could not check your assets right now.{" "}
            <button
              type="button"
              className="rounded text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={legacy.refetch}
            >
              Try again
            </button>
          </p>
        )}
      </div>

      <div className="space-y-3">
        <Tabs value={kind} onValueChange={(value) => setKind(value as AssetKind | "all")}>
          <TabsList aria-label="Asset class" className="h-auto flex-wrap">
            <TabsTrigger value="all">All · {rows.length}</TabsTrigger>
            {KINDS.map((option) => (
              <TabsTrigger key={option} value={option}>
                {ASSET_KIND_META[option].label} ·{" "}
                {rows.filter(({ item }) => item.asset.kind === option).length}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, category, institution or platform"
              aria-label="Search assets"
              className="pl-8"
            />
          </div>
          <FilterSelect
            label="Filter by attention"
            value={attention}
            onChange={setAttention}
            options={ATTENTION}
          />
          <FilterSelect
            label="Filter by status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Any status" },
              ...ASSET_STATUSES.map((value) => ({ value, label: ASSET_STATUS_LABELS[value] })),
            ]}
          />
          <FilterSelect
            label="Sort assets"
            value={sort}
            onChange={(value) => setSort(value as SortKey)}
            options={SORTS.map((option) => ({
              value: option.value,
              label: `Sort: ${option.label}`,
            }))}
          />
        </div>
        {isRule(attention) && (
          <p className="text-xs text-muted-foreground">
            Showing assets flagged by <span className="font-mono">{attention}</span> —{" "}
            {RULES[attention as RuleId].name.toLowerCase()}.{" "}
            <button
              type="button"
              className="rounded text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setAttention("all")}
            >
              Show all assets
            </button>
          </p>
        )}
      </div>

      {awaitingFindings && checking ? (
        <CardSkeleton rows={5} />
      ) : (
        <DataTable
          caption="Assets"
          columns={columns}
          rows={visible}
          rowKey={({ item }) => item.asset.id}
          renderMobileCard={(row) => <MobileAssetCard row={row} checking={checking} />}
          empty={
            <EmptyState
              compact
              icon={Search}
              title={filtering ? "No assets match" : "Nothing to show"}
              description="Try another search, class or filter."
              action={
                filtering ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setKind("all");
                      setStatus("all");
                      setAttention("all");
                      setQuery("");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <p className="text-xs text-muted-foreground">
        Estimated values are what you entered. LegacyVault organizes your information; it does not
        value assets or give legal advice.
      </p>
      {form}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(String(next ?? options[0].value))}
      items={options}
    >
      <SelectTrigger aria-label={label} className="w-full lg:w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AssetName({ item }: { item: AssetWithAssignments }) {
  const Icon = ICONS[item.asset.kind];
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          ACCENTS[item.asset.kind],
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <Link
          href={assetHref(item.asset.kind, item.asset.id)}
          className="block truncate font-medium outline-none hover:text-primary focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.asset.name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">{assetSubtitle(item.asset)}</p>
      </div>
    </div>
  );
}

function AssetStatusBadge({ item }: { item: AssetWithAssignments }) {
  const status = item.asset.profile?.status ?? "ACTIVE";
  return (
    <StatusBadge tone={status === "ACTIVE" ? "success" : "neutral"}>
      {ASSET_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

function BeneficiaryCell({ item }: { item: AssetWithAssignments }) {
  if (item.assignments.length === 0) {
    return isHeld(item.asset.profile) ? (
      <span className="inline-flex items-center gap-1 text-sm text-warning">
        <AlertTriangle className="size-3.5" aria-hidden /> None
      </span>
    ) : (
      <span className="text-sm text-muted-foreground">None</span>
    );
  }
  return (
    <span className="text-sm">
      {pluralize(item.assignments.length, "person", "people")}
      <span className="text-muted-foreground"> · {item.allocatedPercentage}%</span>
    </span>
  );
}

function AttentionCell({ findings, checking }: { findings: Finding[] | null; checking: boolean }) {
  if (!findings) {
    return checking ? (
      <Skeleton className="h-4 w-24" />
    ) : (
      <span className="text-xs text-muted-foreground">Not checked</span>
    );
  }
  const severity = worst(findings);
  if (!severity) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <CheckCircle2 className="size-3.5" aria-hidden /> No findings
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <PriorityBadge tone={severity} />
      <span className="text-xs text-muted-foreground">{pluralize(findings.length, "finding")}</span>
    </span>
  );
}

function MobileAssetCard({ row, checking }: { row: Row; checking: boolean }) {
  const { item, documents, findings } = row;
  return (
    <div className="space-y-3 rounded-xl p-4 glass">
      <AssetName item={item} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">
          {item.asset.estimatedValue != null
            ? formatCurrency(item.asset.estimatedValue, item.asset.currency)
            : "No value set"}
        </span>
        <AssetStatusBadge item={item} />
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" aria-hidden />
          <BeneficiaryCell item={item} />
        </span>
        <span className="inline-flex items-center gap-1">
          <FileText className="size-3" aria-hidden />
          {documents === null
            ? "Documents —"
            : documents
              ? pluralize(documents, "document")
              : "No documents"}
        </span>
      </div>
      <AttentionCell findings={findings} checking={checking} />
    </div>
  );
}
