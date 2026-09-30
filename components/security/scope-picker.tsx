"use client";

import { FileText, Gem, ScrollText, Video } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAssets } from "@/hooks/use-assets";
import { useDocuments } from "@/hooks/use-documents";
import { useVideos } from "@/hooks/use-videos";
import { PLAN_SECTION_TITLES } from "@/lib/legacy-plan/completeness";
import { PLAN_SECTION_KEYS, type PlanSectionKey } from "@/lib/types/legacy-plan";
import type { AssetKind } from "@/lib/types/asset";
import type { AccessScopeInput } from "@/lib/validators/dms.validators";

/**
 * Chooses what a release or an emergency grant actually contains.
 *
 * A scope is never "everything": the database refuses an empty one and refuses
 * anything the caller does not own, so this picker offers exactly the caller's
 * own resources and nothing else. Videos are filtered by delivery condition,
 * because `lv_video_allowed()` decides which kind of grant may ever play them
 * and a video that could never be delivered has no business in the list.
 */
export type ScopeGrant = "DMS_RELEASE" | "EMERGENCY_ACCESS";

const ASSET_KINDS: AssetKind[] = ["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"];

export interface ScopeCatalog {
  documents: { id: string; name: string }[];
  assets: { id: string; kind: AssetKind; name: string }[];
  videos: { id: string; title: string; deliveryCondition: string }[];
  isPending: boolean;
}

/** The caller's own resources, fetched only when something will be done with them. */
export function useScopeCatalog(enabled: boolean): ScopeCatalog {
  const documents = useDocuments({ limit: 100 }, { enabled });
  const financial = useAssets("FINANCIAL_ASSET", {}, { enabled });
  const physical = useAssets("PHYSICAL_ASSET", {}, { enabled });
  const digital = useAssets("DIGITAL_ASSET", {}, { enabled });
  const videos = useVideos({}, { enabled });

  return {
    documents: (documents.data?.items ?? []).map((item) => ({ id: item.id, name: item.name })),
    assets: [financial, physical, digital].flatMap((query) =>
      (query.data?.items ?? []).map((item) => ({
        id: item.asset.id,
        kind: item.asset.kind,
        name: item.asset.name,
      })),
    ),
    videos: (videos.data?.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      deliveryCondition: item.deliveryCondition,
    })),
    isPending: [documents, financial, physical, digital, videos].some((query) => query.isPending),
  };
}

/** How many resources a scope names, which is what the database counts too. */
export function scopeSize(scope: AccessScopeInput): number {
  return (
    scope.documents.length + scope.assets.length + scope.videos.length + scope.planSections.length
  );
}

/**
 * Human names for the ids stored in a scope. An id with no match is a resource
 * that has since been deleted — it is shown as missing rather than as a UUID.
 */
export function describeScope(
  scope: AccessScopeInput,
  catalog: ScopeCatalog,
): { documents: string[]; assets: string[]; videos: string[]; planSections: string[] } {
  const documents = new Map(catalog.documents.map((item) => [item.id, item.name]));
  const assets = new Map(catalog.assets.map((item) => [item.id, item.name]));
  const videos = new Map(catalog.videos.map((item) => [item.id, item.title]));
  const missing = "No longer available";

  return {
    documents: scope.documents.map((id) => documents.get(id) ?? missing),
    assets: scope.assets.map((asset) => assets.get(asset.id) ?? missing),
    videos: scope.videos.map((id) => videos.get(id) ?? missing),
    planSections: scope.planSections.map(
      (key) => PLAN_SECTION_TITLES[key as PlanSectionKey] ?? key,
    ),
  };
}

interface ScopePickerProps {
  grant: ScopeGrant;
  value: AccessScopeInput;
  onChange: (next: AccessScopeInput) => void;
  catalog: ScopeCatalog;
}

export function ScopePicker({ grant, value, onChange, catalog }: ScopePickerProps) {
  const playable = catalog.videos.filter(
    (video) =>
      video.deliveryCondition === "IMMEDIATE" ||
      (grant === "DMS_RELEASE"
        ? video.deliveryCondition === "DEAD_MAN_SWITCH"
        : video.deliveryCondition === "EMERGENCY_ACCESS"),
  );

  const toggleId = (key: "documents" | "videos", id: string, checked: boolean) =>
    onChange({
      ...value,
      [key]: checked ? [...value[key], id] : value[key].filter((item) => item !== id),
    });

  const toggleAsset = (id: string, kind: AssetKind, checked: boolean) =>
    onChange({
      ...value,
      assets: checked
        ? [...value.assets, { type: kind, id }]
        : value.assets.filter((asset) => asset.id !== id),
    });

  const toggleSection = (key: PlanSectionKey, checked: boolean) =>
    onChange({
      ...value,
      planSections: checked
        ? [...value.planSections, key]
        : value.planSections.filter((section) => section !== key),
    });

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">What is released</legend>
      <p className="text-xs text-muted-foreground">
        Choose at least one item. Only what you tick here is ever handed over — never your whole
        vault.
      </p>

      <Group icon={ScrollText} title="Plan sections">
        {PLAN_SECTION_KEYS.map((key) => (
          <Row
            key={key}
            checked={value.planSections.includes(key)}
            onCheckedChange={(checked) => toggleSection(key, checked)}
            label={PLAN_SECTION_TITLES[key]}
          />
        ))}
      </Group>

      <Group icon={FileText} title="Documents" empty="No documents in the vault yet.">
        {catalog.documents.map((document) => (
          <Row
            key={document.id}
            checked={value.documents.includes(document.id)}
            onCheckedChange={(checked) => toggleId("documents", document.id, checked)}
            label={document.name}
          />
        ))}
      </Group>

      <Group icon={Gem} title="Assets" empty="No assets recorded yet.">
        {ASSET_KINDS.flatMap((kind) =>
          catalog.assets
            .filter((asset) => asset.kind === kind)
            .map((asset) => (
              <Row
                key={asset.id}
                checked={value.assets.some((item) => item.id === asset.id)}
                onCheckedChange={(checked) => toggleAsset(asset.id, kind, checked)}
                label={asset.name}
                hint={ASSET_LABELS[kind]}
              />
            )),
        )}
      </Group>

      <Group
        icon={Video}
        title="Videos"
        empty={
          catalog.videos.length
            ? "No video can be delivered by this kind of access."
            : "No video messages recorded yet."
        }
      >
        {playable.map((video) => (
          <Row
            key={video.id}
            checked={value.videos.includes(video.id)}
            onCheckedChange={(checked) => toggleId("videos", video.id, checked)}
            label={video.title}
          />
        ))}
      </Group>
    </fieldset>
  );
}

const ASSET_LABELS: Record<AssetKind, string> = {
  FINANCIAL_ASSET: "Financial",
  PHYSICAL_ASSET: "Physical",
  DIGITAL_ASSET: "Digital",
};

function Group({
  icon: Icon,
  title,
  empty,
  children,
}: {
  icon: typeof FileText;
  title: string;
  empty?: string;
  children: React.ReactNode[];
}) {
  return (
    <div className="rounded-lg border border-border">
      <p className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium">
        <Icon className="size-3.5 text-brand-cyan" aria-hidden />
        {title}
      </p>
      {children.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-44 space-y-1 overflow-y-auto p-2">{children}</ul>
      )}
    </div>
  );
}

function Row({
  checked,
  onCheckedChange,
  label,
  hint,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <li>
      <Label className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-muted/50">
        <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(Boolean(value))} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </Label>
    </li>
  );
}
