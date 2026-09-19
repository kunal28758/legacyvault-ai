"use client";

import { useEffect, useMemo, useState } from "react";
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

import { AllocationBar } from "@/components/data-display/allocation-bar";
import { BeneficiaryCard, RoleChips } from "@/components/data-display/beneficiary-card";
import { AssignDialog } from "@/components/forms/assign-dialog";
import { BeneficiaryFormSheet } from "@/components/forms/beneficiary-form";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
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
import { useDemoWorkspace, useNow } from "@/hooks/use-demo-workspace";
import { beneficiaryRoles, resourceName } from "@/lib/demo/selectors";
import { useDemoStore } from "@/lib/demo/store";
import type { DemoBeneficiary } from "@/lib/demo/types";
import { formatRelative, initials } from "@/lib/format";

type Filter = "all" | "ACTIVE" | "PENDING" | "INACTIVE";

export function BeneficiariesView() {
  const { workspace: ws, ready } = useDemoWorkspace();
  const setStatus = useDemoStore((s) => s.setBeneficiaryStatus);
  const remove = useDemoStore((s) => s.removeBeneficiary);
  const resend = useDemoStore((s) => s.resendInvitation);
  const unassign = useDemoStore((s) => s.unassign);
  const now = useNow();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const openNew = searchParams.get("new") === "1";
  const [formOpen, setFormOpen] = useState(openNew);
  const [editing, setEditing] = useState<DemoBeneficiary | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DemoBeneficiary | null>(null);

  useEffect(() => {
    if (openNew) router.replace("/beneficiaries");
  }, [openNew, router]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ws.beneficiaries.filter(
      (b) =>
        (filter === "all" || b.status === filter) &&
        (!q ||
          b.name.toLowerCase().includes(q) ||
          b.email.toLowerCase().includes(q) ||
          b.relationship.toLowerCase().includes(q)),
    );
  }, [ws.beneficiaries, query, filter]);

  const detail = detailId ? (ws.beneficiaries.find((b) => b.id === detailId) ?? null) : null;

  const openMenuActions = (b: DemoBeneficiary) => (
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
        <DropdownMenuItem
          onClick={() => {
            setEditing(b);
            setFormOpen(true);
          }}
        >
          <UserPlus /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setAssignFor(b.id)} disabled={b.status === "INACTIVE"}>
          <KeyRound /> Assign to resource
        </DropdownMenuItem>
        {b.status === "PENDING" && (
          <DropdownMenuItem
            onClick={() => {
              resend(b.id);
              toast.success(`Invitation re-sent to ${b.name}`);
            }}
          >
            <Mail /> Resend invitation
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {b.status === "INACTIVE" ? (
          <DropdownMenuItem
            onClick={() => {
              setStatus(b.id, "ACTIVE");
              toast.success(`${b.name} reactivated`);
            }}
          >
            <UserCheck /> Reactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => {
              setStatus(b.id, "INACTIVE");
              toast.success(`${b.name} deactivated`, {
                description: "Access links revoked; no new assignments.",
              });
            }}
          >
            <UserX /> Deactivate
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={() => setRemoveTarget(b)}>
          <Trash2 /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns: DataTableColumn<DemoBeneficiary>[] = [
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
      cell: (b) => <RoleChips roles={beneficiaryRoles(ws, b)} />,
    },
    {
      id: "assignments",
      header: "Assignments",
      cell: (b) => {
        const roles = beneficiaryRoles(ws, b);
        return (
          <span className="text-sm">
            {roles.assignmentCount}
            {roles.averageAllocation > 0 && (
              <span className="text-xs text-muted-foreground">
                {" "}
                · avg {roles.averageAllocation}%
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (b) => openMenuActions(b),
    },
  ];

  const stats = {
    total: ws.beneficiaries.length,
    active: ws.beneficiaries.filter((b) => b.status === "ACTIVE").length,
    pending: ws.beneficiaries.filter((b) => b.status === "PENDING").length,
    withAssignments: ws.beneficiaries.filter((b) =>
      ws.assignments.some((a) => a.beneficiaryId === b.id),
    ).length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People"
        title="Beneficiaries"
        description="Everyone who inherits, receives documents or acts as a trusted or emergency contact. Recipients never need an account."
        actions={
          <Button
            className="shadow-glow-blue"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
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

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(b) => b.id}
        loading={!ready}
        caption="Beneficiaries"
        renderMobileCard={(b) => (
          <BeneficiaryCard
            beneficiary={b}
            roles={beneficiaryRoles(ws, b)}
            onOpen={() => setDetailId(b.id)}
          />
        )}
        empty={
          ws.beneficiaries.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No beneficiaries yet"
              description="Add the people who should inherit, receive documents, or act as trusted contacts."
              action={
                <Button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus data-icon="inline-start" />
                  Add your first beneficiary
                </Button>
              }
            />
          ) : (
            <EmptyState
              compact
              icon={Search}
              title="No matches"
              description="Try a different search or filter."
            />
          )
        }
      />

      <BeneficiaryFormSheet open={formOpen} onOpenChange={setFormOpen} beneficiary={editing} />
      <AssignDialog
        open={Boolean(assignFor)}
        onOpenChange={(open) => !open && setAssignFor(null)}
        beneficiaryId={assignFor}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? "beneficiary"}?`}
        description="Their assignments are deleted, every access link is revoked and any trusted or emergency-contact role is cleared — in one transaction. Audit records are kept."
        confirmLabel="Remove beneficiary"
        variant="destructive"
        acknowledgement="I understand this removes all of their assignments and access."
        onConfirm={() => {
          if (!removeTarget) return;
          const result = remove(removeTarget.id);
          if (result.ok) {
            toast.success(`${removeTarget.name} removed`);
            if (detailId === removeTarget.id) setDetailId(null);
          } else toast.error(result.message);
        }}
      />

      {/* Detail sheet */}
      <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader className="pr-10">
                <div className="flex items-center gap-3">
                  <Avatar size="lg">
                    <AvatarFallback className="bg-gradient-brand text-primary-foreground">
                      {initials(detail.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <SheetTitle>{detail.name}</SheetTitle>
                    <SheetDescription>
                      {detail.relationship} · {detail.email}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={toneForBeneficiaryStatus(detail.status).tone}>
                    {toneForBeneficiaryStatus(detail.status).label}
                  </StatusBadge>
                  <RoleChips roles={beneficiaryRoles(ws, detail)} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Invited</dt>
                    <dd>{formatRelative(detail.invitedAt, now)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Activated</dt>
                    <dd>
                      {detail.activatedAt ? formatRelative(detail.activatedAt, now) : "Not yet"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Phone</dt>
                    <dd>{detail.phone ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Added</dt>
                    <dd>{formatRelative(detail.createdAt, now)}</dd>
                  </div>
                </dl>
                {detail.notes && (
                  <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    {detail.notes}
                  </p>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Assignments</p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={detail.status === "INACTIVE"}
                      onClick={() => setAssignFor(detail.id)}
                    >
                      <Plus data-icon="inline-start" />
                      Assign
                    </Button>
                  </div>
                  {ws.assignments.filter((a) => a.beneficiaryId === detail.id).length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      No assignments yet.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {ws.assignments
                        .filter((a) => a.beneficiaryId === detail.id)
                        .map((a) => {
                          const peers = ws.assignments.filter(
                            (p) =>
                              p.resourceType === a.resourceType &&
                              p.resourceId === a.resourceId &&
                              p.allocationPercentage,
                          );
                          return (
                            <li
                              key={a.id}
                              className="space-y-2 rounded-lg border border-border p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {resourceName(ws, a.resourceType, a.resourceId)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {a.resourceType.replace("_", " ").toLowerCase()}
                                    {a.allocationPercentage !== null
                                      ? ` · ${a.allocationPercentage}% share`
                                      : " · shared"}
                                  </p>
                                </div>
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
                              </div>
                              {peers.length > 0 && (
                                <AllocationBar
                                  showLegend={false}
                                  segments={peers.map((p) => ({
                                    id: p.id,
                                    label:
                                      ws.beneficiaries.find((b) => b.id === p.beneficiaryId)
                                        ?.name ?? "Beneficiary",
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

                <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <KeyRound className="size-4 text-brand-cyan" aria-hidden /> Access links
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Direct-share links are scoped to this person’s assignments, expire within 30
                    days and are exchanged once for a secure session — the link itself is never
                    stored. Issuing links becomes available with the access API.
                  </p>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
