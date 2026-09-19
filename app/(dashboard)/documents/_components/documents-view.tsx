"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  History,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Pencil,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { DocumentIcon, VaultCard, documentKind } from "@/components/data-display/vault-card";
import { AssignDialog } from "@/components/forms/assign-dialog";
import { FormField } from "@/components/forms/form-field";
import { UploadDialog } from "@/components/forms/upload-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { GridSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StaggerGrid, StaggerItem } from "@/components/shared/page-transition";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge, toneForScanStatus } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDemoWorkspace, useNow } from "@/hooks/use-demo-workspace";
import { useDemoStore } from "@/lib/demo/store";
import type { DemoDocument } from "@/lib/demo/types";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Secure Document Vault (task T095 — UI; storage/API wiring pending T090/T093/T205). */
export function DocumentsView() {
  const { workspace: ws, ready } = useDemoWorkspace();
  const addFolder = useDemoStore((s) => s.addFolder);
  const renameDocument = useDemoStore((s) => s.renameDocument);
  const removeDocument = useDemoStore((s) => s.removeDocument);
  const unassign = useDemoStore((s) => s.unassign);
  const now = useNow();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [folderId, setFolderId] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const openUpload = searchParams.get("upload") === "1";
  const [uploadOpen, setUploadOpen] = useState(openUpload);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DemoDocument | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [removeTarget, setRemoveTarget] = useState<DemoDocument | null>(null);

  useEffect(() => {
    if (openUpload) router.replace("/documents");
  }, [openUpload, router]);

  const folderNameOf = (id: string | null) =>
    id ? (ws.folders.find((f) => f.id === id)?.name ?? "Folder") : "Root";
  const sharedCount = (doc: DemoDocument) =>
    ws.assignments.filter((a) => a.resourceType === "DOCUMENT" && a.resourceId === doc.id).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ws.documents.filter(
      (d) =>
        (folderId === "all" ||
          (folderId === "root" ? d.folderId === null : d.folderId === folderId)) &&
        (!q || d.name.toLowerCase().includes(q)),
    );
  }, [ws.documents, folderId, query]);

  const detail = detailId ? (ws.documents.find((d) => d.id === detailId) ?? null) : null;
  const totalBytes = ws.documents.reduce((s, d) => s + d.sizeBytes, 0);
  const clean = ws.documents.filter((d) => d.scanStatus === "CLEAN").length;
  const shared = ws.documents.filter((d) => sharedCount(d) > 0).length;

  const menuFor = (doc: DemoDocument) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${doc.name}`} />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => setDetailId(doc.id)}>
          <Eye /> Details & versions
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShareFor(doc.id)}>
          <Share2 /> Share with beneficiary
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setRenameTarget(doc);
            setRenameValue(doc.name);
          }}
        >
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => setRemoveTarget(doc)}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns: DataTableColumn<DemoDocument>[] = [
    {
      id: "name",
      header: "Document",
      cell: (doc) => {
        return (
          <button
            type="button"
            onClick={() => setDetailId(doc.id)}
            className="flex items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <DocumentIcon mimeType={doc.mimeType} className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{doc.name}</span>
              <span className="block text-xs text-muted-foreground">
                {documentKind(doc.mimeType)} · v{doc.versionCount}
              </span>
            </span>
          </button>
        );
      },
    },
    {
      id: "folder",
      header: "Folder",
      hideBelowLg: true,
      cell: (doc) => (
        <span className="text-sm text-muted-foreground">{folderNameOf(doc.folderId)}</span>
      ),
    },
    {
      id: "size",
      header: "Size",
      cell: (doc) => <span className="text-sm tabular-nums">{formatBytes(doc.sizeBytes)}</span>,
    },
    {
      id: "scan",
      header: "Scan",
      cell: (doc) => {
        const s = toneForScanStatus(doc.scanStatus);
        return (
          <StatusBadge tone={s.tone} pulse={doc.scanStatus === "PENDING"}>
            {s.label}
          </StatusBadge>
        );
      },
    },
    {
      id: "shared",
      header: "Shared",
      hideBelowLg: true,
      cell: (doc) => <span className="text-sm">{sharedCount(doc) || "—"}</span>,
    },
    {
      id: "updated",
      header: "Updated",
      hideBelowLg: true,
      cell: (doc) => (
        <span className="text-sm text-muted-foreground">{formatRelative(doc.updatedAt, now)}</span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (doc) => menuFor(doc),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vault"
        title="Document vault"
        description="Private storage for wills, deeds, policies and identity documents. Every file is validated and malware-scanned before it enters your vault."
        actions={
          <>
            <Button variant="outline" onClick={() => setFolderOpen(true)}>
              <FolderPlus data-icon="inline-start" />
              New folder
            </Button>
            <Button className="shadow-glow-blue" onClick={() => setUploadOpen(true)}>
              <Upload data-icon="inline-start" />
              Upload
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Documents"
          value={ready ? ws.documents.length : "—"}
          icon={FileText}
          accent="blue"
          hint={`${ws.folders.length} folders`}
        />
        <StatCard
          label="Storage used"
          value={ready ? formatBytes(totalBytes) : "—"}
          icon={HardDrive}
          accent="purple"
          hint="Provider-encrypted at rest"
        />
        <StatCard
          label="Scanned clean"
          value={ready ? `${clean}/${ws.documents.length}` : "—"}
          icon={ShieldCheck}
          accent={clean === ws.documents.length ? "success" : "warning"}
        />
        <StatCard
          label="Shared"
          value={ready ? shared : "—"}
          icon={Share2}
          accent="cyan"
          hint="Via scoped access links"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-1">
          <p className="px-2 pb-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Folders
          </p>
          {[
            { id: "all" as const, name: "All documents", count: ws.documents.length },
            {
              id: "root" as const,
              name: "Root",
              count: ws.documents.filter((d) => !d.folderId).length,
            },
            ...ws.folders.map((f) => ({
              id: f.id,
              name: f.name,
              count: ws.documents.filter((d) => d.folderId === f.id).length,
            })),
          ].map((folder) => {
            const active = folderId === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => setFolderId(folder.id)}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-sidebar-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                {active ? (
                  <FolderOpen className="size-4 text-brand-cyan" aria-hidden />
                ) : (
                  <Folder className="size-4" aria-hidden />
                )}
                <span className="flex-1 truncate text-left">{folder.name}</span>
                <span className="text-xs tabular-nums">{folder.count}</span>
              </button>
            );
          })}
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents"
                className="pl-8"
                aria-label="Search documents"
              />
            </div>
            <div
              className="flex items-center gap-1 rounded-lg bg-muted p-0.5"
              role="group"
              aria-label="View"
            >
              <Button
                variant={view === "grid" ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
              >
                <LayoutGrid />
              </Button>
              <Button
                variant={view === "list" ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="List view"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List />
              </Button>
            </div>
          </div>

          {!ready ? (
            <GridSkeleton />
          ) : rows.length === 0 ? (
            ws.documents.length === 0 ? (
              <EmptyState
                icon={Lock}
                title="Your vault is empty"
                description="Upload your will, property deeds, insurance policies and identity documents. They stay private and are shared only through scoped links."
                action={
                  <Button onClick={() => setUploadOpen(true)}>
                    <Upload data-icon="inline-start" />
                    Upload your first document
                  </Button>
                }
              />
            ) : (
              <EmptyState
                compact
                icon={Search}
                title="No documents here"
                description="Try another folder or search term."
              />
            )
          ) : view === "grid" ? (
            <StaggerGrid className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((doc) => (
                <StaggerItem key={doc.id}>
                  <VaultCard
                    document={doc}
                    folderName={folderNameOf(doc.folderId)}
                    sharedCount={sharedCount(doc)}
                    onOpen={() => setDetailId(doc.id)}
                    menu={menuFor(doc)}
                  />
                </StaggerItem>
              ))}
            </StaggerGrid>
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(d) => d.id}
              caption="Documents"
              renderMobileCard={(doc) => (
                <VaultCard
                  document={doc}
                  folderName={folderNameOf(doc.folderId)}
                  sharedCount={sharedCount(doc)}
                  onOpen={() => setDetailId(doc.id)}
                  menu={menuFor(doc)}
                />
              )}
            />
          )}
        </div>
      </div>

      <UploadDialog
        kind="document"
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        defaultFolderId={folderId === "all" || folderId === "root" ? null : folderId}
      />
      <AssignDialog
        open={Boolean(shareFor)}
        onOpenChange={(open) => !open && setShareFor(null)}
        resource={shareFor ? { type: "DOCUMENT", id: shareFor } : null}
      />

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="glass-strong">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Folders organise your vault; permissions are always per document.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Folder name" required>
            {(props) => (
              <Input
                {...props}
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="e.g. Tax records"
                autoFocus
              />
            )}
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const result = addFolder(folderName);
                if (!result.ok) return toast.error(result.message);
                toast.success("Folder created");
                setFolderName("");
                setFolderOpen(false);
              }}
            >
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="glass-strong">
          <DialogHeader>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>Metadata changes are recorded in your audit log.</DialogDescription>
          </DialogHeader>
          <FormField label="Name" required>
            {(props) => (
              <Input
                {...props}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
              />
            )}
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!renameTarget) return;
                const result = renameDocument(renameTarget.id, renameValue);
                if (!result.ok) return toast.error(result.message);
                toast.success("Document renamed");
                setRenameTarget(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Delete ${removeTarget?.name ?? "document"}?`}
        description="The document is soft-deleted, its storage object is queued for removal, shares and plan attachments are removed. The audit trail is retained (FR-H017)."
        confirmLabel="Delete document"
        variant="destructive"
        onConfirm={() => {
          if (!removeTarget) return;
          const result = removeDocument(removeTarget.id);
          if (result.ok) {
            toast.success("Document deleted");
            if (detailId === removeTarget.id) setDetailId(null);
          } else toast.error(result.message);
        }}
      />

      <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader className="pr-10">
                <SheetTitle className="break-all">{detail.name}</SheetTitle>
                <SheetDescription>
                  {documentKind(detail.mimeType)} · {formatBytes(detail.sizeBytes)} ·{" "}
                  {folderNameOf(detail.folderId)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={toneForScanStatus(detail.scanStatus).tone}
                    pulse={detail.scanStatus === "PENDING"}
                  >
                    {toneForScanStatus(detail.scanStatus).label}
                  </StatusBadge>
                  <StatusBadge tone="info" icon={Lock}>
                    Private bucket
                  </StatusBadge>
                  {detail.demoOnly && (
                    <StatusBadge tone="warning">Demo only — not uploaded</StatusBadge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Tooltip>
                    <TooltipTrigger render={<Button size="sm" variant="outline" disabled />}>
                      <Download data-icon="inline-start" />
                      Download
                    </TooltipTrigger>
                    <TooltipContent>
                      Signed 15-minute download links are minted by the storage API (not in the demo
                      workspace)
                    </TooltipContent>
                  </Tooltip>
                  <Button size="sm" variant="outline" onClick={() => setShareFor(detail.id)}>
                    <Share2 data-icon="inline-start" />
                    Share
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRenameTarget(detail);
                      setRenameValue(detail.name);
                    }}
                  >
                    <Pencil data-icon="inline-start" />
                    Rename
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
                    <dt className="text-xs text-muted-foreground">Uploaded</dt>
                    <dd>{formatDateTime(detail.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last modified</dt>
                    <dd>{formatDateTime(detail.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Encryption</dt>
                    <dd>Provider AES-256 at rest</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Access</dt>
                    <dd>Owner + {sharedCount(detail)} shared</dd>
                  </div>
                </dl>

                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <History className="size-4 text-muted-foreground" aria-hidden /> Version history
                  </p>
                  <ol className="space-y-1.5">
                    {Array.from({ length: detail.versionCount }).map((_, i) => {
                      const version = detail.versionCount - i;
                      return (
                        <li
                          key={version}
                          className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                        >
                          <span>
                            Version {version}
                            {version === detail.versionCount && (
                              <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                                Current
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(
                              version === detail.versionCount ? detail.updatedAt : detail.createdAt,
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Shared with</p>
                  {ws.assignments.filter(
                    (a) => a.resourceType === "DOCUMENT" && a.resourceId === detail.id,
                  ).length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                      Not shared with anyone. Only you can open it.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {ws.assignments
                        .filter((a) => a.resourceType === "DOCUMENT" && a.resourceId === detail.id)
                        .map((a) => (
                          <li
                            key={a.id}
                            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                          >
                            <span>
                              {ws.beneficiaries.find((b) => b.id === a.beneficiaryId)?.name ??
                                "Beneficiary"}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                unassign(a.id);
                                toast.success("Share revoked");
                              }}
                            >
                              Revoke
                            </Button>
                          </li>
                        ))}
                    </ul>
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
