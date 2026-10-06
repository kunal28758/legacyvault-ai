"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  FileCheck2,
  History,
  Pencil,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader, SectionHeading } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { ProgressRing } from "@/components/shared/progress-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAssets } from "@/hooks/use-assets";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { useCreateNewDraft, useLegacyPlanOverview } from "@/hooks/use-legacy-plan";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/client/api-client";
import { computeCompleteness } from "@/lib/legacy-plan/completeness";
import { PLAN_STEPS, stepForSection } from "@/lib/legacy-plan/steps";
import { formatDateTime, formatRelative } from "@/lib/format";

/**
 * Legacy-plan overview (tasks T063/T070).
 *
 * Reads the real plan, its version history and the records the completeness
 * rules cross-check against. "Create new draft" goes through
 * `create_plan_draft()`, which refuses unless the source plan is finalized and
 * no draft is already open.
 */
export function LegacyPlanView() {
  const overview = useLegacyPlanOverview();
  const beneficiariesQuery = useBeneficiaries();
  const financial = useAssets("FINANCIAL_ASSET");
  const physical = useAssets("PHYSICAL_ASSET");
  const digital = useAssets("DIGITAL_ASSET");
  const newDraft = useCreateNewDraft();
  const now = useNow();

  if (overview.isError) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Legacy" title="Legacy plan" />
        <ErrorState
          title="Could not load your legacy plan"
          description={
            overview.error instanceof ApiError
              ? overview.error.message
              : "Please try again in a moment."
          }
          onRetry={() => void overview.refetch()}
        />
      </div>
    );
  }

  if (overview.isPending) return <PageSkeleton stats={0} />;

  const plan = overview.data.current;
  const versions = overview.data.versions;

  if (!plan) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Legacy"
          title="Legacy plan"
          description="Create a structured digital will in eleven guided steps."
        />
        <EmptyState
          icon={ScrollText}
          title="You haven’t started a legacy plan yet"
          description="The first draft takes about ten minutes. It auto-saves and stays a draft until you explicitly finalize it."
          action={
            <Button nativeButton={false} render={<Link href="/legacy-plan/wizard" />}>
              Create your will
              <ArrowRight data-icon="inline-end" />
            </Button>
          }
        />
      </div>
    );
  }

  const assets = [
    ...(financial.data?.items ?? []),
    ...(physical.data?.items ?? []),
    ...(digital.data?.items ?? []),
  ].map((item) => ({ id: item.asset.id, kind: item.asset.kind }));

  const completeness = computeCompleteness({
    stepsData: plan.stepsData,
    beneficiaries: beneficiariesQuery.data?.items ?? [],
    assets,
    documents: [],
  });

  const finalized = plan.status === "FINALIZED";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Legacy"
        title="Legacy plan"
        description={
          finalized
            ? "Your plan is finalized. Start a new draft when anything changes — every version is preserved."
            : "Your draft auto-saves as you go. Finalize when the review step shows what you expect."
        }
        actions={
          finalized ? (
            <Button
              disabled={newDraft.isPending}
              onClick={async () => {
                try {
                  await newDraft.mutateAsync(plan.id);
                  toast.success(`Draft v${plan.version + 1} created`);
                } catch (error) {
                  toast.error(
                    error instanceof ApiError ? error.message : "Could not start a new draft.",
                  );
                }
              }}
            >
              <Pencil data-icon="inline-start" />
              Create new draft
            </Button>
          ) : (
            <Button
              nativeButton={false}
              render={<Link href={`/legacy-plan/wizard?step=${plan.currentStep}`} />}
            >
              Continue will
              <ArrowRight data-icon="inline-end" />
            </Button>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass-highlight glass lg:col-span-1">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">
                {finalized ? `Version ${plan.version}` : `Draft v${plan.version}`}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {finalized
                  ? `Finalized ${formatDateTime(plan.finalizedAt)}`
                  : `Updated ${formatRelative(plan.updatedAt, now)}`}
              </p>
            </div>
            <StatusBadge tone={finalized ? "success" : "info"}>
              {finalized ? "Finalized" : "Draft"}
            </StatusBadge>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <ProgressRing
              value={completeness.percent}
              size={112}
              stroke={9}
              label="Plan completeness"
            />
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Sections complete</dt>
                <dd className="font-medium">{9 - completeness.incompleteSections.length} / 9</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Current step</dt>
                <dd className="font-medium">
                  {PLAN_STEPS.find((step) => step.step === plan.currentStep)?.title ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Finalized versions</dt>
                <dd className="font-medium">{versions.length}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Sections</CardTitle>
            <p className="text-sm text-muted-foreground">
              Jump to any section. Personal details are required to finalize.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {Object.values(completeness.sections).map((section) => {
                const step = stepForSection(section.key);
                return (
                  <li key={section.key}>
                    <Link
                      href={`/legacy-plan/wizard?step=${step}`}
                      className="group flex items-center gap-3 rounded-xl border border-border p-3 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {section.complete ? (
                        <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                      ) : (
                        <CircleDashed className="size-5 shrink-0 text-warning" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {step}. {section.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {section.summary}
                        </span>
                      </span>
                      <span className="sr-only">
                        {section.complete ? "complete" : "incomplete"}
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
      </div>

      <div className="space-y-4">
        <SectionHeading
          title="Version history"
          description="Every finalized version is preserved with its completeness snapshot (FR-C008)."
        />
        {versions.length === 0 ? (
          <EmptyState
            compact
            icon={History}
            title="No finalized versions yet"
            description="Versions appear here once you finalize the plan in the review step."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {versions.map((version) => (
              <li key={version.id}>
                <Card className="h-full glass">
                  <CardContent className="space-y-3 p-5">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-2 font-medium">
                        <FileCheck2 className="size-4 text-success" aria-hidden />
                        Version {version.versionNumber}
                      </p>
                      {version.acknowledgedIncomplete ? (
                        <StatusBadge tone="warning">Acknowledged incomplete</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">Complete</StatusBadge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Finalized {formatDateTime(version.finalizedAt)}
                    </p>
                    {version.incompleteSections.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Incomplete:{" "}
                        {version.incompleteSections
                          .map((key) => PLAN_STEPS.find((step) => step.key === key)?.title)
                          .join(", ")}
                      </p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href="/legacy-plan/wizard?step=11" />}
                    >
                      View snapshot
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
