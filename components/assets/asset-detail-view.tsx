"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  FileText,
  History,
  KeyRound,
  Landmark,
  Link2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { AssignAssetDialog } from "@/components/assets/assign-asset-dialog";
import { LinkDocumentDialog } from "@/components/assets/link-document-dialog";
import { AllocationBar } from "@/components/beneficiaries/allocation-bar";
import { FindingItem } from "@/components/legacy/finding-list";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { MaskedField } from "@/components/shared/masked-field";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivity } from "@/hooks/use-activity";
import {
  useAsset,
  useDeleteAsset,
  useRevealSensitiveFields,
  useUnassignBeneficiary,
  useUpdateAsset,
} from "@/hooks/use-assets";
import { useUnlinkDocument } from "@/hooks/use-documents";
import { useFindingDismissal, useLegacyState } from "@/hooks/use-legacy-snapshot";
import { useNow } from "@/hooks/use-now";
import { useReverifiedAction } from "@/hooks/use-reverified-action";
import { ASSET_KIND_META, assetSubtitle, categoryLabel } from "@/lib/assets/meta";
import { ApiError } from "@/lib/client/api-client";
import { assetRelations, findingsFor } from "@/lib/client/intelligence";
import { formatCurrency, formatDate, formatRelative, pluralize } from "@/lib/format";
import type { AssetKind, AssetWithAssignments } from "@/lib/types/asset";
import { ASSET_STATUS_LABELS, isHeld } from "@/lib/types/asset-profile";
import { daysUntil, DOCUMENT_CATEGORY_LABELS } from "@/lib/types/document-profile";
import { cn } from "@/lib/utils";

/** The edit form (and its validators) loads only when the owner edits. */
const AssetFormSheet = dynamic(
  () => import("@/components/assets/asset-form").then((module) => module.AssetFormSheet),
  { ssr: false },
);

function Section({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  icon: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <Card className={cn("glass", className)} aria-labelledby={id} role="region">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
        </h2>
        {action}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value || "—"}</dd>
    </div>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

const today = () => new Date().toLocaleDateString("en-CA");

function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * One asset in full: the record itself (fetched by id, so another owner's id
 * is simply "not found"), its relationships from the Legacy Relationship
 * Graph, the findings that involve it, and its own audit history.
 */
export function AssetDetailView({ kind, id }: { kind: AssetKind; id: string }) {
  const router = useRouter();
  const now = useNow();
  const asset = useAsset(kind, id);
  const legacy = useLegacyState();
  const activity = useActivity(10, 1, id);
  const update = useUpdateAsset(kind);
  const remove = useDeleteAsset(kind);
  const unassign = useUnassignBeneficiary(kind);
  const unlink = useUnlinkDocument();
  const reveal = useRevealSensitiveFields(kind);
  const reverified = useReverifiedAction();
  const dismissal = useFindingDismissal();

  const [editing, setEditing] = useState(false);
  const [editorLoaded, setEditorLoaded] = useState(false);
  const edit = () => {
    setEditorLoaded(true);
    setEditing(true);
  };
  const [assigning, setAssigning] = useState(false);
  const [linking, setLinking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const back = (
    <Link
      href="/assets"
      className="inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden /> Asset Vault
    </Link>
  );

  if (asset.isPending) return <PageSkeleton stats={0} />;
  if (asset.isError || !asset.data) {
    const missing = asset.error instanceof ApiError && [403, 404, 422].includes(asset.error.status);
    return (
      <div className="space-y-6">
        {back}
        {missing ? (
          // Not found and not yours look identical, so the page never confirms
          // that someone else's asset id exists.
          <PageHeader
            eyebrow="Asset Vault"
            title="Asset not found"
            description="It may have been deleted, or it is not part of your vault."
            actions={
              <Button nativeButton={false} render={<Link href="/assets" />}>
                Open Asset Vault
              </Button>
            }
          />
        ) : (
          <ErrorState
            title="Could not load this asset"
            description={messageFor(asset.error, "Please try again in a moment.")}
            onRetry={() => void asset.refetch()}
          />
        )}
      </div>
    );
  }

  const detail: AssetWithAssignments = asset.data;
  const record = detail.asset;
  const profile = record.profile ?? {};
  const held = isHeld(profile);
  const state = legacy.state;
  const relations = state ? assetRelations(state.intelligence.graph, record.id) : null;
  const findings = state ? findingsFor(state.intelligence.findings, "asset", record.id) : [];
  const openFindings = findings.filter((finding) => finding.status === "open");
  const linkedIds = new Set(relations?.documents.map((entry) => entry.node.id));
  const documents = state
    ? state.records.documents.filter((document) => linkedIds.has(document.id))
    : [];
  const attachmentFor = (documentId: string) =>
    relations?.documents.find((entry) => entry.node.id === documentId)?.attachmentId;
  const nomineeLinked = relations?.nominee;

  const revealField = (field: string) => async () => {
    const values = await reverified(() => reveal(record.id));
    return (values as Record<string, string | null | undefined>)[field] ?? null;
  };

  const markReviewed = async () => {
    try {
      await update.mutateAsync({
        id: record.id,
        values: { profile: { ...profile, lastReviewedOn: today() } },
      });
      toast.success("Marked as reviewed", { description: "Recorded in your audit trail." });
    } catch (error) {
      toast.error(messageFor(error, "Could not save the review."));
    }
  };

  const segments = detail.assignments
    .filter((assignment) => assignment.allocationPercentage)
    .map((assignment) => ({
      id: assignment.id,
      label: assignment.beneficiaryName,
      value: assignment.allocationPercentage ?? 0,
    }));

  const relationshipChips: { icon: LucideIcon; label: string; tone?: "warn" }[] = relations
    ? [
        {
          icon: FileText,
          label: relations.documents.length
            ? `Supported by ${pluralize(relations.documents.length, "document")}`
            : state?.intelligence.coverage.documentsComplete
              ? "No supporting documents"
              : "No supporting document among your 100 most recent",
          tone:
            relations.documents.length || !held || !state?.intelligence.coverage.documentsComplete
              ? undefined
              : "warn",
        },
        {
          icon: Users,
          label: detail.assignments.length
            ? `Assigned to ${pluralize(detail.assignments.length, "beneficiary", "beneficiaries")}`
            : "No beneficiary",
          tone: detail.assignments.length || !held ? undefined : "warn",
        },
        {
          icon: ScrollText,
          label: relations.inWill ? "Referenced in your Will" : "Not referenced in your Will",
        },
        ...relations.protectedBy.map((node) => ({
          icon: ShieldCheck,
          label: `Released by ${node.label}`,
        })),
      ]
    : [];

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        eyebrow={`${ASSET_KIND_META[kind].label} asset`}
        title={record.name}
        description={assetSubtitle(record)}
        actions={
          <>
            <Button variant="outline" onClick={edit}>
              <Pencil data-icon="inline-start" />
              Edit
            </Button>
            <Button onClick={() => setAssigning(true)}>
              <KeyRound data-icon="inline-start" />
              Assign beneficiary
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label="More asset actions" />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => void markReviewed()}>
                  <CalendarCheck /> Mark as reviewed
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLinking(true)} disabled={!state}>
                  <Link2 /> Link documents
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                  <Trash2 /> Delete asset
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <ul aria-label="Relationships" className="flex flex-wrap gap-1.5 text-xs">
          <li>
            <StatusBadge tone={held ? "success" : "neutral"}>
              {ASSET_STATUS_LABELS[profile.status ?? "ACTIVE"]}
            </StatusBadge>
          </li>
          {!relations && (
            <li className="text-muted-foreground" role="status">
              Checking relationships…
            </li>
          )}
          {relationshipChips.map((chip) => (
            <li
              key={chip.label}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5",
                chip.tone === "warn"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              <chip.icon className="size-3" aria-hidden />
              {chip.label}
            </li>
          ))}
        </ul>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Overview" icon={Wallet}>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Class" value={ASSET_KIND_META[kind].label} />
              <Field label="Category" value={categoryLabel(kind, record.category)} />
              <Field label="Status" value={ASSET_STATUS_LABELS[profile.status ?? "ACTIVE"]} />
              <Field label="Recorded" value={formatDate(record.createdAt)} />
              <Field label="Last updated" value={formatRelative(record.updatedAt, now)} />
              <Field
                label="Last reviewed"
                value={profile.lastReviewedOn ? formatDate(profile.lastReviewedOn) : "Never"}
              />
            </dl>
            {record.kind === "PHYSICAL_ASSET" && record.description && (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-muted-foreground">
                {record.description}
              </p>
            )}
            {record.notes && <p className="text-muted-foreground">{record.notes}</p>}
          </Section>

          <Section title="Ownership" icon={Landmark}>
            <dl className="grid grid-cols-2 gap-3">
              {record.kind === "FINANCIAL_ASSET" && (
                <Field label="Institution" value={record.institution} />
              )}
              {record.kind === "PHYSICAL_ASSET" && (
                <>
                  <Field label="Location" value={record.location} />
                  <Field label="Ownership" value={record.ownershipDetails} />
                </>
              )}
              {record.kind === "DIGITAL_ASSET" && (
                <>
                  <Field label="Platform" value={record.platform} />
                  <Field label="Username" value={record.username} />
                </>
              )}
            </dl>
            {record.kind === "FINANCIAL_ASSET" && (
              <div className="space-y-2">
                <MaskedField
                  label="Account number"
                  present={record.hasAccountNumber}
                  onReveal={revealField("accountNumber")}
                />
                <MaskedField
                  label="Policy number"
                  present={record.hasPolicyNumber}
                  onReveal={revealField("policyNumber")}
                />
              </div>
            )}
            {record.kind === "DIGITAL_ASSET" && (
              <div className="space-y-2">
                <MaskedField
                  label="Credentials"
                  present={record.hasCredentials}
                  onReveal={revealField("credentials")}
                />
                <MaskedField
                  label="Recovery information"
                  present={record.hasRecoveryInfo}
                  onReveal={revealField("recoveryInfo")}
                />
              </div>
            )}
          </Section>

          <Section
            title="Beneficiaries"
            icon={Users}
            action={
              <span className="text-xs text-muted-foreground">
                {detail.allocatedPercentage}% allocated · {detail.remainingPercentage}% free
              </span>
            }
          >
            {detail.assignments.length === 0 ? (
              <EmptyState
                compact
                icon={Users}
                title="Nobody is assigned yet"
                description="Assign who should receive this asset."
                action={
                  <Button size="sm" onClick={() => setAssigning(true)}>
                    Assign beneficiary
                  </Button>
                }
              />
            ) : (
              <>
                {segments.length > 0 && <AllocationBar segments={segments} />}
                <ul className="space-y-2" aria-label="Assigned beneficiaries">
                  {detail.assignments.map((assignment) => (
                    <li
                      key={assignment.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <span className="min-w-0 truncate">
                        {assignment.beneficiaryName}
                        <span className="text-muted-foreground">
                          {" · "}
                          {assignment.allocationPercentage !== null
                            ? `${assignment.allocationPercentage}%`
                            : "no percentage"}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={unassign.isPending}
                        aria-label={`Remove ${assignment.beneficiaryName} from ${record.name}`}
                        onClick={async () => {
                          try {
                            await unassign.mutateAsync({
                              id: record.id,
                              assignmentId: assignment.id,
                            });
                            toast.success("Assignment removed");
                          } catch (error) {
                            toast.error(messageFor(error, "Could not remove this assignment."));
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
          </Section>

          <Section
            title="Supporting documents"
            icon={FileText}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLinking(true)}
                disabled={!state}
              >
                <Link2 data-icon="inline-start" />
                Link documents
              </Button>
            }
          >
            {!state ? (
              <Pending label="Loading supporting documents" />
            ) : documents.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-muted-foreground">
                No document is linked yet. Link the deed, statement or policy that proves this
                asset.
              </p>
            ) : (
              <ul className="space-y-2" aria-label="Linked documents">
                {documents.map((document) => {
                  const expiresOn = document.profile?.expiresOn;
                  const expired = expiresOn ? daysUntil(expiresOn, now) < 0 : false;
                  return (
                    <li
                      key={document.id}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <Link
                          href={`/documents?q=${encodeURIComponent(document.name)}`}
                          className="block truncate font-medium outline-none hover:text-primary focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {document.name}
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground">
                          {document.profile?.category
                            ? DOCUMENT_CATEGORY_LABELS[document.profile.category]
                            : "Uncategorized"}
                          {expiresOn && (
                            <span className={cn(expired && "font-medium text-destructive")}>
                              {" · "}
                              {expired ? "Expired" : "Expires"} {formatDate(expiresOn)}
                            </span>
                          )}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={unlink.isPending}
                        aria-label={`Unlink ${document.name}`}
                        onClick={async () => {
                          const attachmentId = attachmentFor(document.id);
                          if (!attachmentId) return;
                          try {
                            await unlink.mutateAsync({ documentId: document.id, attachmentId });
                            toast.success(`${document.name} unlinked`);
                          } catch (error) {
                            toast.error(messageFor(error, "Could not unlink this document."));
                          }
                        }}
                      >
                        Unlink
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title="Instructions"
            icon={NotebookPen}
            action={
              <Button size="sm" variant="ghost" onClick={edit}>
                <Pencil data-icon="inline-start" />
                {profile.instructions ? "Edit" : "Add"}
              </Button>
            }
          >
            {profile.instructions ? (
              <p className="leading-6 whitespace-pre-line">{profile.instructions}</p>
            ) : (
              <p className="text-muted-foreground">
                No instructions yet. Say what should happen to this asset and where its access
                details are kept — never the password or key itself.
              </p>
            )}
          </Section>

          <Section title="Activity" icon={History}>
            {activity.isPending ? (
              <Pending label="Loading activity" />
            ) : activity.isError ? (
              <p className="text-muted-foreground">Activity could not be loaded right now.</p>
            ) : (
              <ActivityFeed items={activity.data?.items ?? []} emptyTitle="No activity recorded" />
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Intelligence" icon={ScanSearch}>
            {!state ? (
              <Pending label="Checking this asset" />
            ) : findings.length === 0 ? (
              <p className="flex items-start gap-2 text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                No findings. This asset is consistent with your documents, beneficiaries and Will.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {openFindings.length
                    ? `${pluralize(openFindings.length, "potential issue")} detected from your records. Review recommended — this is not legal advice.`
                    : "Every finding here was dismissed."}
                </p>
                <ul className="space-y-2" aria-label="Findings for this asset">
                  {findings.map((finding) => (
                    <FindingItem
                      key={finding.id}
                      finding={finding}
                      busy={dismissal.isPending}
                      onDismiss={() => void dismissal.toggle(finding.id, true)}
                      onRestore={() => void dismissal.toggle(finding.id, false)}
                    />
                  ))}
                </ul>
              </>
            )}
          </Section>

          <Section title="Value" icon={Wallet}>
            <p className="font-heading text-2xl font-semibold tabular-nums">
              {record.estimatedValue != null
                ? formatCurrency(record.estimatedValue, record.currency)
                : "No value set"}
            </p>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Currency" value={record.currency} />
              <Field
                label="Acquired"
                value={profile.acquiredOn ? formatDate(profile.acquiredOn) : null}
              />
            </dl>
            <p className="text-xs text-muted-foreground">Your own estimate — not a valuation.</p>
          </Section>

          <Section title="Nominee" icon={UserRound}>
            {profile.nominee ? (
              <dl className="grid grid-cols-2 gap-3">
                <Field label="Name" value={profile.nominee.name} />
                <Field label="Relationship" value={profile.nominee.relationship} />
                <div className="col-span-2 text-xs text-muted-foreground">
                  {nomineeLinked
                    ? `Linked to your beneficiary ${nomineeLinked.label}.`
                    : profile.nominee.beneficiaryId
                      ? "Linked beneficiary record is no longer available."
                      : "Not linked to a beneficiary record."}
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground">
                No nominee recorded. If the institution holds a nominee for this asset, add it so
                your family knows.
              </p>
            )}
          </Section>

          <Section
            title="Review & expiry"
            icon={CalendarCheck}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => void markReviewed()}
                disabled={update.isPending}
              >
                Mark reviewed
              </Button>
            }
          >
            <dl className="grid grid-cols-2 gap-3">
              <Field
                label="Review on"
                value={profile.reviewOn ? formatDate(profile.reviewOn) : null}
              />
              <Field
                label="Expires / renews"
                value={profile.expiresOn ? formatDate(profile.expiresOn) : null}
              />
              <Field
                label="Last reviewed"
                value={profile.lastReviewedOn ? formatDate(profile.lastReviewedOn) : "Never"}
              />
            </dl>
          </Section>
        </div>
      </div>

      {editorLoaded && (
        <AssetFormSheet kind={kind} open={editing} onOpenChange={setEditing} asset={record} />
      )}
      <AssignAssetDialog
        open={assigning}
        onOpenChange={setAssigning}
        kind={kind}
        assetId={assigning ? record.id : null}
        assetName={record.name}
        assignments={detail.assignments}
        remainingPercentage={detail.remainingPercentage}
      />
      <LinkDocumentDialog
        open={linking}
        onOpenChange={setLinking}
        target={
          state
            ? {
                mode: "asset",
                asset: { id: record.id, kind, name: record.name },
                choices: state.records.documents.map((document) => ({
                  id: document.id,
                  label: document.name,
                  hint: document.profile?.category
                    ? DOCUMENT_CATEGORY_LABELS[document.profile.category]
                    : "Uncategorized",
                  linked: linkedIds.has(document.id),
                })),
              }
            : null
        }
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${record.name}?`}
        description="The asset is soft-deleted in one transaction together with its beneficiary assignments and document links. The documents themselves stay in your vault, and the audit record is kept."
        confirmLabel="Delete asset"
        variant="destructive"
        onConfirm={async () => {
          try {
            await remove.mutateAsync(record.id);
            toast.success(`${record.name} deleted`);
            router.push("/assets");
          } catch (error) {
            toast.error(messageFor(error, "Could not delete this asset."));
          }
        }}
      />
    </div>
  );
}
