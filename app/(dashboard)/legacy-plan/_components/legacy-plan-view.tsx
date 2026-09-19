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
import { PageHeader, SectionHeading } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { ProgressRing } from "@/components/shared/progress-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDemoWorkspace } from "@/hooks/use-demo-workspace";
import { PLAN_STEPS, getPlanCompleteness } from "@/lib/demo/selectors";
import { useDemoStore } from "@/lib/demo/store";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useNow } from "@/hooks/use-demo-workspace";

export function LegacyPlanView() {
  const { workspace: ws, ready } = useDemoWorkspace();
  const createNewDraft = useDemoStore((s) => s.createNewDraft);
  const now = useNow();
  if (!ready) return <PageSkeleton stats={0} />;

  const plan = ws.plan;
  const completeness = getPlanCompleteness(ws);

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
            <Button
              className="shadow-glow-blue"
              nativeButton={false}
              render={<Link href="/legacy-plan/wizard" />}
            >
              Create your will
              <ArrowRight data-icon="inline-end" />
            </Button>
          }
        />
      </div>
    );
  }

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
              className="shadow-glow-blue"
              onClick={() => {
                const result = createNewDraft();
                if (result.ok) toast.success(`Draft v${plan.version + 1} created`);
                else toast.error(result.message);
              }}
            >
              <Pencil data-icon="inline-start" />
              Create new draft
            </Button>
          ) : (
            <Button
              className="shadow-glow-blue"
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
                  {PLAN_STEPS.find((s) => s.step === plan.currentStep)?.title ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Finalized versions</dt>
                <dd className="font-medium">{ws.planVersions.length}</dd>
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
                const step = PLAN_STEPS.find((s) => s.key === section.key)?.step ?? 1;
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
        {ws.planVersions.length === 0 ? (
          <EmptyState
            compact
            icon={History}
            title="No finalized versions yet"
            description="Versions appear here once you finalize the plan in the review step."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ws.planVersions.map((version) => (
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
                          .map((k) => PLAN_STEPS.find((s) => s.key === k)?.title)
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
