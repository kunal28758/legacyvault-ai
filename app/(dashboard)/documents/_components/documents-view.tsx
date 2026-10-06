"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  Eye,
  FileText,
  Folder,
  FolderInput,
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
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { DocumentAIViewer } from "@/components/ai/document-ai-viewer";
import {
  DocumentIcon,
  SharingChip,
  VaultCard,
  documentKind,
} from "@/components/documents/vault-card";
import { ShareDocumentDialog } from "@/components/documents/share-document-dialog";
import { FormField } from "@/components/shared/form-field";
import { UploadDialog } from "@/components/documents/upload-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { GridSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StaggerGrid, StaggerItem } from "@/components/shared/page-transition";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useCreateFolder,
  useDeleteDocument,
  useDocument,
  useDocumentAccess,
  useDocuments,
  useFolders,
  useRenameDocument,
  useUnshareDocument,
} from "@/hooks/use-documents";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/client/api-client";
import type { DocumentSummary } from "@/lib/types/document";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Secure Document Vault (FR-H001–H010).
 *
 * Everything here is persisted: uploads go straight to a private bucket and
 * are promoted by the server once checked, downloads are short-lived signed links minted
 * after an ownership check, and deletion runs `delete_document()`.
 */
type DocumentFilter = "all" | "shared" | "private" | "pdf" | "image" | "office";

const DOCUMENT_FILTERS: Record<
  DocumentFilter,
  { label: string; test: (doc: DocumentSummary) => boolean }
> = {
  all: { label: "All", test: () => true },
  shared: { label: "Shared", test: (doc) => doc.shareCount > 0 },
  private: { label: "Private", test: (doc) => doc.shareCount === 0 },
  pdf: { label: "PDF", test: (doc) => doc.mimeType === "application/pdf" },
  image: { label: "Images", test: (doc) => doc.mimeType.startsWith("image/") },
  office: {
    label: "Office & text",
    test: (doc) =>
      doc.mimeType.startsWith("text/") ||
      /word|sheet|excel|presentation|powerpoint|officedocument/.test(doc.mimeType),
  },
};

export function DocumentsView() {
  const now = useNow();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [folderId, setFolderId] = useState<string | "all">("all");
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const openUpload = searchParams.get("upload") === "1";
  const [uploadOpen, setUploadOpen] = useState(openUpload);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DocumentSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [removeTarget, setRemoveTarget] = useState<DocumentSummary | null>(null);
  const [aiFor, setAiFor] = useState<DocumentSummary | null>(null);
  const [moveTarget, setMoveTarget] = useState<DocumentSummary | null>(null);
  const [moveFolder, setMoveFolder] = useState<string>("root");

  const listQuery = useDocuments({
    ...(folderId === "all" || folderId === "root" ? {} : { folderId }),
    ...(query.trim() ? { q: query.trim() } : {}),
  });
  const everything = useDocuments();
  const foldersQuery = useFolders();
  const detailQuery = useDocument(detailId);
  const createFolder = useCreateFolder();
  const renameDoc = useRenameDocument();
  const deleteDoc = useDeleteDocument();
  const unshare = useUnshareDocument();
  const accessDocument = useDocumentAccess();

  const ready = !everything.isPending && !foldersQuery.isPending;
  const folders = foldersQuery.data?.items ?? [];
  const allDocuments = everything.data?.items ?? [];

  useEffect(() => {
    if (openUpload) router.replace("/documents");
  }, [openUpload, router]);

  const folderNameOf = (id: string | null) =>
    id ? (folders.find((f) => f.id === id)?.name ?? "Folder") : "Root";
  const sharedCount = (doc: DocumentSummary) => doc.shareCount;

  // The root filter is the one case the API cannot express, so it is applied here.
  const rows = useMemo(() => {
    const items = listQuery.data?.items ?? [];
    const inFolder = folderId === "root" ? items.filter((d) => d.folderId === null) : items;
    return inFolder.filter(DOCUMENT_FILTERS[filter].test);
  }, [listQuery.data, folderId, filter]);

  const detail = detailQuery.data ?? null;
  const totalBytes = allDocuments.reduce((s, d) => s + d.sizeBytes, 0);
  const versions = allDocuments.reduce((s, d) => s + d.versionCount, 0);
  const shared = allDocuments.filter((d) => d.shareCount > 0).length;

  const download = async (id: string) => {
    try {
      const access = await accessDocument(id, "download");
      // The signed link is opened immediately and never stored.
      window.open(access.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not open this document.");
    }
  };

  const menuFor = (doc: DocumentSummary) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${doc.name}`} />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => setAiFor(doc)}>
          <Sparkles /> Open in AI viewer
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDetailId(doc.id)}>
          <Eye /> Details & versions
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setMoveTarget(doc);
            setMoveFolder(doc.folderId ?? "root");
          }}
        >
          <FolderInput /> Move to folder
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

  const columns: DataTableColumn<DocumentSummary>[] = [
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
            <span className="icon-tile size-9 text-primary">
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
      id: "shared",
      header: "Sharing",
      hideBelowLg: true,
      cell: (doc) => <SharingChip count={sharedCount(doc)} />,
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
        description="Private storage for wills, deeds, policies and identity documents. Every file's size and type are checked before it enters your vault."
        actions={
          <>
            <Button variant="outline" onClick={() => setFolderOpen(true)}>
              <FolderPlus data-icon="inline-start" />
              New folder
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Upload data-icon="inline-start" />
              Upload
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Documents"
          value={ready ? (everything.data?.total ?? allDocuments.length) : "—"}
          icon={FileText}
          accent="blue"
          hint={`${folders.length} folders`}
        />
        <StatCard
          label="Storage used"
          value={ready ? formatBytes(totalBytes) : "—"}
          icon={HardDrive}
          accent="cyan"
          hint="Provider-encrypted at rest"
        />
        <StatCard
          label="Versions"
          value={ready ? versions : "—"}
          icon={History}
          accent="blue"
          hint="Earlier versions are kept"
        />
        <StatCard
          label="Shared"
          value={ready ? shared : "—"}
          icon={Share2}
          accent="success"
          hint="Shared securely via scoped access links"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-1">
          <p className="px-2 pb-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Folders
          </p>
          {[
            { id: "all" as const, name: "All documents", count: allDocuments.length },
            {
              id: "root" as const,
              name: "Root",
              count: allDocuments.filter((d) => !d.folderId).length,
            },
            ...folders.map((f) => ({
              id: f.id,
              name: f.name,
              count: allDocuments.filter((d) => d.folderId === f.id).length,
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
                  "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "border-primary/25 bg-primary/10 font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                {active ? (
                  <FolderOpen className="size-4 text-primary" aria-hidden />
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
              className="flex items-center gap-1 self-end rounded-lg border border-border bg-surface/60 p-0.5 sm:self-auto"
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

          <div
            role="group"
            aria-label="Filter documents"
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
          >
            {(Object.keys(DOCUMENT_FILTERS) as DocumentFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  filter === key
                    ? "border-primary/40 bg-primary/15 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
              >
                {DOCUMENT_FILTERS[key].label}
              </button>
            ))}
          </div>

          {!ready ? (
            <GridSkeleton />
          ) : rows.length === 0 ? (
            allDocuments.length === 0 ? (
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
                description="Try another folder, filter or search term."
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
      <ShareDocumentDialog
        open={Boolean(shareFor)}
        onOpenChange={(open) => !open && setShareFor(null)}
        documentId={shareFor}
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
                void (async () => {
                  try {
                    await createFolder.mutateAsync({ name: folderName });
                    toast.success("Folder created");
                    setFolderName("");
                    setFolderOpen(false);
                  } catch (error) {
                    toast.error(
                      error instanceof ApiError ? error.message : "Could not create this folder.",
                    );
                  }
                })();
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
                void (async () => {
                  try {
                    await renameDoc.mutateAsync({ id: renameTarget.id, name: renameValue });
                    toast.success("Document renamed");
                    setRenameTarget(null);
                  } catch (error) {
                    toast.error(
                      error instanceof ApiError ? error.message : "Could not rename this document.",
                    );
                  }
                })();
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
        onConfirm={async () => {
          if (!removeTarget) return;
          try {
            await deleteDoc.mutateAsync(removeTarget.id);
            toast.success("Document deleted");
            if (detailId === removeTarget.id) setDetailId(null);
            if (aiFor?.id === removeTarget.id) setAiFor(null);
          } catch (error) {
            toast.error(
              error instanceof ApiError ? error.message : "Could not delete this document.",
            );
          }
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
                  <StatusBadge tone="info" icon={Lock}>
                    Private bucket
                  </StatusBadge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"

                    onClick={() => {
                      setAiFor(detail);
                      setDetailId(null);
                    }}
                  >
                    <Sparkles data-icon="inline-start" />
                    AI insights
                  </Button>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void download(detail.id)}
                        />
                      }
                    >
                      <Download data-icon="inline-start" />
                      Download
                    </TooltipTrigger>
                    <TooltipContent>Opens a signed link that expires in 15 minutes</TooltipContent>
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
                    {detail.versions.map((version) => (
                      <li
                        key={version.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <span>
                          Version {version.versionNumber}
                          {version.isCurrent && (
                            <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                              Current
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(version.sizeBytes)} · {formatDateTime(version.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Shared with</p>
                  {detail.shares.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                      Not shared with anyone. Only you can open it.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.shares.map((share) => (
                        <li
                          key={share.assignmentId}
                          className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                        >
                          <span>{share.beneficiaryName}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={unshare.isPending}
                            onClick={async () => {
                              try {
                                await unshare.mutateAsync({
                                  id: detail.id,
                                  beneficiaryId: share.beneficiaryId,
                                });
                                toast.success("Share revoked");
                              } catch (error) {
                                toast.error(
                                  error instanceof ApiError
                                    ? error.message
                                    : "Could not revoke this share.",
                                );
                              }
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

      <DocumentAIViewer
        document={aiFor}
        allDocuments={allDocuments}
        onOpenChange={(open) => !open && setAiFor(null)}
        onDownload={(id) => void download(id)}
        onMove={(doc) => {
          setMoveTarget(doc);
          setMoveFolder(doc.folderId ?? "root");
        }}
        onDelete={(doc) => setRemoveTarget(doc)}
      />

      <Dialog open={Boolean(moveTarget)} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent className="glass-strong sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move document</DialogTitle>
            <DialogDescription className="break-all">
              Choose where {moveTarget?.name} should live. Sharing and access are unchanged.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Folder">
            {(props) => (
              <Select
                value={moveFolder}
                onValueChange={(value) => setMoveFolder(String(value))}
                items={[
                  { value: "root", label: "Root" },
                  ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
                ]}
              >
                <SelectTrigger id={props.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Root</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={renameDoc.isPending}
              onClick={async () => {
                if (!moveTarget) return;
                try {
                  await renameDoc.mutateAsync({
                    id: moveTarget.id,
                    folderId: moveFolder === "root" ? null : moveFolder,
                  });
                  toast.success("Document moved");
                  setMoveTarget(null);
                } catch (error) {
                  toast.error(
                    error instanceof ApiError ? error.message : "Could not move this document.",
                  );
                }
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
