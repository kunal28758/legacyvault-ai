"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  KeyRound,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { AllocationBar } from "@/components/beneficiaries/allocation-bar";
import { BeneficiaryCard, RoleChips } from "@/components/beneficiaries/beneficiary-card";
import { AccessLinksPanel } from "@/components/beneficiaries/access-links-panel";
import { BeneficiaryFormSheet } from "@/components/beneficiaries/beneficiary-form";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge, toneForBeneficiaryStatus } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  useBeneficiaries,
  useBeneficiary,
  useInviteBeneficiary,
  useRemoveBeneficiary,
  useSetBeneficiaryStatus,
  useUnassignBeneficiary,
} from "@/hooks/use-beneficiaries";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/client/api-client";
import type { BeneficiaryWithRoles } from "@/lib/types/beneficiary";
import { formatRelative, initials } from "@/lib/format";

type Filter = "all" | "ACTIVE" | "PENDING" | "INACTIVE";

const RESOURCE_LABELS: Record<string, string> = {
  FINANCIAL_ASSET: "Financial asset",
  PHYSICAL_ASSET: "Physical asset",
  DIGITAL_ASSET: "Digital asset",
  DOCUMENT: "Document",
  VIDEO_MESSAGE: "Video message",
};

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Beneficiaries (tasks T075/T076).
 *
 * Reads and writes go through `/api/v1/beneficiaries`: the server owns
 * authorization, validation and the audit trail, and the guarded functions own
 * the cascades. Nothing on this page is demo state.
 */
export function BeneficiariesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = useNow();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [formOpen, setFormOpen] = useState(() => searchParams.get("new") === "1");
  const [editing, setEditing] = useState<BeneficiaryWithRoles | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<BeneficiaryWithRoles | null>(null);

  // Deferred so typing does not fire a request per keystroke.
  const search = useDeferredValue(query.trim());
  const list = useBeneficiaries({
    ...(filter === "all" ? {} : { status: filter }),
    ...(search ? { q: search } : {}),
  });
  // The header stats describe the whole roster. With no filter applied the list
  // query already is the whole roster, so the companion query only runs when a
  // filter or search would otherwise hide part of it.
  const filtering = filter !== "all" || Boolean(search);
  const everyone = useBeneficiaries({}, { enabled: filtering });
  const roster = filtering ? everyone : list;

  const detail = useBeneficiary(detailId);
  const setStatus = useSetBeneficiaryStatus();
  const remove = useRemoveBeneficiary();
  const invite = useInviteBeneficiary();
  const unassign = useUnassignBeneficiary();

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const all = useMemo(() => roster.data?.items ?? [], [roster.data]);
  const ready = !roster.isPending;

  const stats = {
    total: roster.data?.total ?? all.length,
    active: all.filter((b) => b.status === "ACTIVE").length,
    pending: all.filter((b) => b.status === "PENDING").length,
    withAssignments: all.filter((b) => b.roles.assignmentCount > 0).length,
  };

  const openForm = (beneficiary: BeneficiaryWithRoles | null) => {
    setEditing(beneficiary);
    setFormOpen(true);
    if (searchParams.get("new") === "1") router.replace("/beneficiaries");
  };

  // The menu closes on click, so a toast carries the work in progress; it is
  // replaced by the outcome rather than stacked under it.
  const changeStatus = async (b: BeneficiaryWithRoles, status: "ACTIVE" | "INACTIVE") => {
    if (setStatus.isPending) return;
    const id = toast.loading(
      status === "ACTIVE" ? `Reactivating ${b.name}…` : `Deactivating ${b.name}…`,
    );
    try {
      await setStatus.mutateAsync({ id: b.id, status });
      toast.success(status === "ACTIVE" ? `${b.name} reactivated` : `${b.name} deactivated`, {
        id,
        description:
          status === "INACTIVE"
            ? "Access links revoked; no new assignments."
            : "They can be assigned resources again.",
      });
    } catch (error) {
      toast.error(messageFor(error, "Could not change the status."), { id });
    }
  };

  const sendInvitation = async (b: BeneficiaryWithRoles) => {
    if (invite.isPending) return;
    const id = toast.loading(`Sending the invitation to ${b.name}…`);
    try {
      const result = await invite.mutateAsync(b.id);
      toast.success(`Invitation recorded for ${b.name}`, {
        id,
        description: result.emailSent
          ? "The invitation email has been sent."
          : "The invitation email could not be sent. You can resend it later.",
      });
    } catch (error) {
      toast.error(messageFor(error, "Could not record the invitation."), { id });
    }
  };

  const rowActions = (b: BeneficiaryWithRoles) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${b.name}`} />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => setDetailId(b.id)}>
          <Users /> View details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openForm(b)}>
          <UserPlus /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void sendInvitation(b)}
          disabled={b.status === "INACTIVE" || invite.isPending}
        >
          <Mail /> {b.invitedAt ? "Resend invitation" : "Send invitation"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {b.status === "INACTIVE" ? (
          <DropdownMenuItem onClick={() => void changeStatus(b, "ACTIVE")}>
            <UserCheck /> Reactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => void changeStatus(b, "INACTIVE")}>
            <UserX /> Deactivate
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={() => setRemoveTarget(b)}>
          <Trash2 /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns: DataTableColumn<BeneficiaryWithRoles>[] = [
    {
      id: "name",
      header: "Beneficiary",
      cell: (b) => (
        <button
          type="button"
          onClick={() => setDetailId(b.id)}
          className="flex items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar>
            <AvatarFallback className="bg-gradient-brand text-primary-foreground">
              {initials(b.name)}
            </AvatarFallback>
          </Avatar>
          <span>
            <span className="block font-medium">{b.name}</span>
            <span className="block text-xs text-muted-foreground">{b.relationship}</span>
          </span>
        </button>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      hideBelowLg: true,
      cell: (b) => <span className="text-sm text-muted-foreground">{b.email}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (b) => {
        const s = toneForBeneficiaryStatus(b.status);
        return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
      },
    },
    {
      id: "roles",
      header: "Roles",
      hideBelowLg: true,
      cell: (b) => <RoleChips roles={b.roles} />,
    },
    {
      id: "assignments",
      header: "Assignments",
      cell: (b) => (
        <span className="text-sm">
          {b.roles.assignmentCount}
          {b.roles.averageAllocation > 0 && (
            <span className="text-xs text-muted-foreground">
              {" "}
              · avg {b.roles.averageAllocation}%
            </span>
          )}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (b) => rowActions(b),
    },
  ];

  const detailData = detail.data ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People"
        title="Beneficiaries"
        description="Everyone who inherits, receives documents or acts as a trusted or emergency contact. Recipients never need an account."
        actions={
          <Button className="shadow-glow-blue" onClick={() => openForm(null)}>
            <Plus data-icon="inline-start" />
            Add beneficiary
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total" value={ready ? stats.total : "—"} icon={Users} accent="blue" />
        <StatCard
          label="Active"
          value={ready ? stats.active : "—"}
          icon={UserCheck}
          accent="success"
          hint="Accepted their access link"
        />
        <StatCard
          label="Pending invite"
          value={ready ? stats.pending : "—"}
          icon={Mail}
          accent="warning"
          hint="Invitation not used yet"
        />
        <StatCard
          label="With assignments"
          value={ready ? stats.withAssignments : "—"}
          icon={KeyRound}
          accent="purple"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or relationship"
            className="pl-8"
            aria-label="Search beneficiaries"
          />
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="ACTIVE">Active</TabsTrigger>
            <TabsTrigger value="PENDING">Pending</TabsTrigger>
            <TabsTrigger value="INACTIVE">Inactive</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {list.isError ? (
        <ErrorState
          title="Could not load your beneficiaries"
          description={messageFor(list.error, "Please try again in a moment.")}
          correlationId={list.error instanceof ApiError ? list.error.correlationId : undefined}
          onRetry={() => void list.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(b) => b.id}
          loading={list.isPending}
          caption="Beneficiaries"
          renderMobileCard={(b) => (
            <BeneficiaryCard beneficiary={b} roles={b.roles} onOpen={() => setDetailId(b.id)} />
          )}
          empty={
            search || filter !== "all" ? (
              <EmptyState
                compact
                icon={Search}
                title="No matches"
                description="Try a different search or filter."
              />
            ) : (
              <EmptyState
                icon={Users}
                title="No beneficiaries yet"
                description="Add the people who should inherit, receive documents, or act as trusted contacts."
                action={
                  <Button onClick={() => openForm(null)}>
                    <Plus data-icon="inline-start" />
                    Add your first beneficiary
                  </Button>
                }
              />
            )
          }
        />
      )}

      <BeneficiaryFormSheet open={formOpen} onOpenChange={setFormOpen} beneficiary={editing} />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? "beneficiary"}?`}
        description="Their assignments are deleted, every access link is revoked and any trusted or emergency-contact role is cleared — in one transaction. Audit records are kept."
        confirmLabel="Remove beneficiary"
        variant="destructive"
        acknowledgement="I understand this removes all of their assignments and access."
        onConfirm={async () => {
          if (!removeTarget) return;
          try {
            await remove.mutateAsync(removeTarget.id);
            toast.success(`${removeTarget.name} removed`);
            if (detailId === removeTarget.id) setDetailId(null);
          } catch (error) {
            toast.error(messageFor(error, "Could not remove this beneficiary."));
          }
        }}
      />

      {/* Detail sheet */}
      <Sheet open={Boolean(detailId)} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-lg">
          {detail.isError && (
            <div className="p-4">
              <ErrorState
                title="Could not load this beneficiary"
                description={messageFor(detail.error, "Please try again in a moment.")}
                onRetry={() => void detail.refetch()}
              />
            </div>
          )}
          {detailData && (
            <>
              <SheetHeader className="pr-10">
                <div className="flex items-center gap-3">
                  <Avatar size="lg">
                    <AvatarFallback className="bg-gradient-brand text-primary-foreground">
                      {initials(detailData.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <SheetTitle>{detailData.name}</SheetTitle>
                    <SheetDescription>
                      {detailData.relationship} · {detailData.email}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={toneForBeneficiaryStatus(detailData.status).tone}>
                    {toneForBeneficiaryStatus(detailData.status).label}
                  </StatusBadge>
                  <RoleChips roles={detailData.roles} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Invited</dt>
                    <dd>
                      {detailData.invitedAt ? formatRelative(detailData.invitedAt, now) : "Not yet"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Activated</dt>
                    <dd>
                      {detailData.activatedAt
                        ? formatRelative(detailData.activatedAt, now)
                        : "Not yet"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Phone</dt>
                    <dd>{detailData.phone ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Added</dt>
                    <dd>{formatRelative(detailData.createdAt, now)}</dd>
                  </div>
                </dl>
                {detailData.notes && (
                  <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    {detailData.notes}
                  </p>
                )}

                <div className="space-y-3">
                  <p className="text-sm font-medium">Assignments</p>
                  {detailData.assignments.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      No assignments yet. Assign this person from an asset, document or video.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {detailData.assignments.map((a) => {
                        const peers = detailData.assignments.filter(
                          (p) =>
                            p.resourceType === a.resourceType &&
                            p.resourceId === a.resourceId &&
                            p.allocationPercentage !== null,
                        );
                        return (
                          <li key={a.id} className="space-y-2 rounded-lg border border-border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {a.resourceName ?? "No longer available"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {RESOURCE_LABELS[a.resourceType] ?? "Resource"} ·{" "}
                                  {a.allocationPercentage !== null
                                    ? `${a.allocationPercentage}% share`
                                    : "Shared"}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={unassign.isPending}
                                onClick={async () => {
                                  try {
                                    await unassign.mutateAsync({
                                      id: detailData.id,
                                      assignmentId: a.id,
                                    });
                                    toast.success("Assignment removed");
                                  } catch (error) {
                                    toast.error(
                                      messageFor(error, "Could not remove this assignment."),
                                    );
                                  }
                                }}
                              >
                                {unassign.isPending && unassign.variables?.assignmentId === a.id
                                  ? "Removing…"
                                  : "Remove"}
                              </Button>
                            </div>
                            {peers.length > 0 && (
                              <AllocationBar
                                showLegend={false}
                                segments={peers.map((p) => ({
                                  id: p.id,
                                  label:
                                    p.resourceName ?? RESOURCE_LABELS[p.resourceType] ?? "Resource",
                                  value: p.allocationPercentage ?? 0,
                                }))}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <AccessLinksPanel
                  beneficiaryId={detailData.id}
                  beneficiaryName={detailData.name}
                  assignments={detailData.assignments}
                  canIssue={detailData.status !== "INACTIVE"}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
