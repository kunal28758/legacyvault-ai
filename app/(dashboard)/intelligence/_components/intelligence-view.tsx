"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Link2, ScanSearch, ShieldCheck, Sparkles } from "lucide-react";

import { LinkDocumentDialog } from "@/components/assets/link-document-dialog";
import { FindingItem, SystemDetectedBadge } from "@/components/legacy/finding-list";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFindingDismissal, useLegacyState } from "@/hooks/use-legacy-snapshot";
import { ASSET_KIND_META } from "@/lib/assets/meta";
import {
  FINDING_TYPE_LABELS,
  FINDING_TYPES,
  RULE_IDS,
  RULES,
  STALE_AFTER_DAYS,
  type Finding,
  type FindingType,
  type RuleId,
} from "@/lib/client/intelligence";
import { completeness } from "@/lib/client/legacy-graph";
import { isHeld } from "@/lib/types/asset-profile";
import { cn } from "@/lib/utils";

const PAGE = 8;

/**
 * Legacy Intelligence: every finding the deterministic rules raise from the
 * owner's own records, grouped by kind. Each one names its rule and records;
 * fixing the records resolves it. Heuristic findings can be dismissed.
 */
export function IntelligenceView() {
  const searchParams = useSearchParams();
  const { state, isPending, isError, refetch } = useLegacyState();
  const dismissal = useFindingDismissal();
  const requestedType = searchParams.get("type");
  const requestedRule = searchParams.get("rule");
  const [type, setType] = useState<FindingType | "all">(
    FINDING_TYPES.includes(requestedType as FindingType) ? (requestedType as FindingType) : "all",
  );
  const [rule, setRule] = useState<RuleId | null>(
    requestedRule && Object.hasOwn(RULES, requestedRule) ? (requestedRule as RuleId) : null,
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showDismissed, setShowDismissed] = useState(false);
  const [linkFor, setLinkFor] = useState<Finding | null>(null);

  const header = (
    <PageHeader
      eyebrow="Intelligence"
      title="Legacy Intelligence"
      description="What is missing, expiring, out of date or inconsistent — detected from your own records by deterministic rules. Not AI, and not legal advice."
      actions={
        <Button variant="outline" nativeButton={false} render={<Link href="/ai?mode=analyze" />}>
          <Sparkles data-icon="inline-start" className="text-brand-purple" />
          Ask Copilot to explain
        </Button>
      }
    />
  );

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Could not check your legacy"
          description="Your data is safe — this view could not reach it. Try again in a moment."
          onRetry={refetch}
        />
      </div>
    );
  }
  if (isPending || !state) {
    return (
      <div className="space-y-6">
        {header}
        <div role="status" aria-label="Checking your legacy" className="space-y-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-[70px] rounded-xl" />
            ))}
          </div>
          <CardSkeleton rows={5} />
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  const { open, dismissed } = state.intelligence;
  const matches = (finding: Finding) =>
    (type === "all" || finding.type === type) && (!rule || finding.ruleId === rule);
  const visible = open.filter(matches);
  const hiddenDismissed = dismissed.filter(matches);
  const heldAssets = state.records.assets.filter(({ asset }) => isHeld(asset.profile));
  const complete = completeness(state.records);
  const partial = [
    !complete.assets && "your 100 most recent assets of each type",
    !complete.documents && "your 100 most recent documents",
    !complete.beneficiaries && "your 50 most recent beneficiaries",
  ].filter(Boolean);

  const linkControl = (finding: Finding) =>
    finding.ruleId === "DOC-ASSET-001" ? (
      <Button size="sm" variant="outline" onClick={() => setLinkFor(finding)}>
        <Link2 data-icon="inline-start" />
        Link to asset
      </Button>
    ) : undefined;
  const linkDocument = linkFor?.sourceRecords.find((record) => record.kind === "document");

  return (
    <div className="space-y-6">
      {header}

      <div
        role="group"
        aria-label="Filter findings by kind"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      >
        {(["all", ...FINDING_TYPES] as const).map((key) => {
          const count =
            key === "all" ? open.length : open.filter((finding) => finding.type === key).length;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={type === key}
              onClick={() => setType(key)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                type === key
                  ? "border-primary/40 bg-primary/10"
                  : "border-border bg-surface/40 hover:border-primary/30",
              )}
            >
              <span className="font-heading text-xl font-semibold tabular-nums">{count}</span>
              <span className="text-xs text-muted-foreground">
                {key === "all" ? "All open findings" : FINDING_TYPE_LABELS[key]}
              </span>
            </button>
          );
        })}
      </div>

      {rule && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Showing <span className="font-mono text-xs">{rule}</span> — {RULES[rule].name}.
          <button
            type="button"
            className="rounded text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setRule(null)}
          >
            Show every rule
          </button>
        </p>
      )}

      {partial.length > 0 && (
        <p
          role="note"
          className="rounded-xl border border-border bg-surface/40 p-3 text-sm text-muted-foreground"
        >
          These findings cover {partial.join(", ")}. Checks that need every record — deleted
          references and supporting-document coverage — are skipped until everything fits on one
          page, so nothing is reported missing just because it was not loaded.
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={open.length ? "Nothing in this view" : "No findings"}
          description={
            open.length
              ? "Every open finding is in another category. Choose “All open findings” to see them."
              : "Your vault, Will, beneficiaries and release settings are consistent with each other. New findings appear as your records change."
          }
        />
      ) : (
        <div className="space-y-6">
          {FINDING_TYPES.map((kind) => {
            const group = visible.filter((finding) => finding.type === kind);
            if (!group.length) return null;
            const showAll = expanded[kind];
            return (
              <section key={kind} aria-labelledby={`findings-${kind}`} className="space-y-2.5">
                <h2
                  id={`findings-${kind}`}
                  className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
                >
                  {FINDING_TYPE_LABELS[kind]}
                  <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                    {group.length}
                  </span>
                </h2>
                <ul className="space-y-2" aria-label={FINDING_TYPE_LABELS[kind]}>
                  {(showAll ? group : group.slice(0, PAGE)).map((finding) => (
                    <FindingItem
                      key={finding.id}
                      finding={finding}
                      busy={dismissal.isPending}
                      onDismiss={() => void dismissal.toggle(finding.id, true)}
                      extra={linkControl(finding)}
                    />
                  ))}
                </ul>
                {group.length > PAGE && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={Boolean(showAll)}
                    onClick={() => setExpanded((value) => ({ ...value, [kind]: !showAll }))}
                  >
                    {showAll ? "Show fewer" : `Show ${group.length - PAGE} more`}
                  </Button>
                )}
              </section>
            );
          })}
        </div>
      )}

      {hiddenDismissed.length > 0 && (
        <section className="space-y-2.5">
          <button
            type="button"
            aria-expanded={showDismissed}
            onClick={() => setShowDismissed((value) => !value)}
            className="flex items-center gap-2 rounded-md text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Dismissed · {hiddenDismissed.length}
            <ChevronDown
              className={cn("size-3.5 transition-transform", showDismissed && "rotate-180")}
              aria-hidden
            />
          </button>
          {showDismissed && (
            <ul className="space-y-2" aria-label="Dismissed findings">
              {hiddenDismissed.map((finding) => (
                <FindingItem
                  key={finding.id}
                  finding={finding}
                  busy={dismissal.isPending}
                  onRestore={() => void dismissal.toggle(finding.id, false)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <details className="group rounded-xl border border-border bg-surface/40 p-4 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ScanSearch className="size-4 text-primary" aria-hidden />
          How Legacy Intelligence works
          <ChevronDown
            className="ml-auto size-4 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="mt-3 space-y-3 text-muted-foreground">
          <p>
            <SystemDetectedBadge className="mr-1.5 align-middle" />
            findings come from fixed rules over records you can see in LegacyVault. They are
            recalculated every time, so fixing a record resolves its finding. Records are considered
            stale after {STALE_AFTER_DAYS} days without a change or review. Findings describe your
            records — they are not legal advice; consider confirming important matters with a
            qualified professional.
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Rules">
            {RULE_IDS.map((id) => (
              <li key={id} className="flex gap-2">
                <span className="w-28 shrink-0 font-mono text-xs text-foreground">{id}</span>
                <span className="text-xs">{RULES[id].name}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <LinkDocumentDialog
        open={Boolean(linkFor)}
        onOpenChange={(next) => !next && setLinkFor(null)}
        target={
          linkDocument
            ? {
                mode: "document",
                document: { id: linkDocument.id, name: linkDocument.label },
                choices: heldAssets.map(({ asset }) => ({
                  id: asset.id,
                  kind: asset.kind,
                  label: asset.name,
                  hint: `${ASSET_KIND_META[asset.kind].label} asset`,
                })),
              }
            : null
        }
      />
    </div>
  );
}
