"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  FileDropZone,
  UploadItemCard,
  newUploadItem,
  serverKind,
  type UploadItem,
  type UploadKind,
} from "@/components/documents/file-upload";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UploadCancelledError,
  useFolders,
  useRetryUpload,
  useUpload,
  type UploadCompletion,
} from "@/hooks/use-documents";
import { ApiError } from "@/lib/client/api-client";
import type { UploadOutcome } from "@/lib/types/document";
import type { DeliveryCondition } from "@/lib/types/video";
import { precheckUpload } from "@/lib/uploads/file-types";

interface UploadDialogProps {
  kind: UploadKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFolderId?: string | null;
  /** Called once per file that reaches the vault (e.g. to add it to a release scope). */
  onUploaded?: (outcome: UploadOutcome, file: File) => void;
  title?: string;
  description?: string;
}

const DELIVERY: { value: DeliveryCondition; label: string }[] = [
  { value: "IMMEDIATE", label: "Immediately (any valid access link)" },
  { value: "DEAD_MAN_SWITCH", label: "Only on Dead Man’s Switch release" },
  { value: "EMERGENCY_ACCESS", label: "Only through emergency access" },
];

/**
 * Upload dialog (ADR-005).
 *
 * The real two-step flow, once per file: the server hands out a signed URL
 * into private storage, the browser PUTs the bytes straight there, and the
 * server measures the object, checks its leading bytes against the declared
 * type and only then promotes it into the vault. Each stage is shown only once
 * the server has confirmed it; a completion that fails unexpectedly leaves the
 * bytes private and unpromoted with a Retry, and nothing can spin forever.
 * No malware scan runs, and nothing here says one did.
 *
 * Documents may be queued several at a time and are processed one after
 * another; a video is one file with its title and delivery condition.
 */
export function UploadDialog({ open, onOpenChange, ...props }: UploadDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-transfer would orphan the request; the Cancel buttons
        // stop a transfer explicitly instead.
        if (!next && busy) {
          toast.info("An upload is in progress", {
            description: "Cancel it first, or wait for it to finish saving.",
          });
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="glass-strong sm:max-w-lg">
        {open && <UploadForm {...props} onOpenChange={onOpenChange} onBusyChange={setBusy} />}
      </DialogContent>
    </Dialog>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The upload failed. Please try again.";
}

function isCancel(error: unknown): boolean {
  return (
    error instanceof UploadCancelledError ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function UploadForm({
  kind,
  onOpenChange,
  onBusyChange,
  defaultFolderId = null,
  onUploaded,
  title: dialogTitle,
  description: dialogDescription,
}: Omit<UploadDialogProps, "open"> & { onBusyChange: (busy: boolean) => void }) {
  const foldersQuery = useFolders();
  const upload = useUpload();
  const retry = useRetryUpload();

  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [videoTitle, setVideoTitle] = useState("");
  const [delivery, setDelivery] = useState<DeliveryCondition>("IMMEDIATE");
  const controllers = useRef(new Map<string, AbortController>());

  const folders = foldersQuery.data?.items ?? [];
  const multiple = kind === "document";

  useEffect(() => onBusyChange(running), [running, onBusyChange]);
  useEffect(() => {
    const active = controllers.current;
    return () => active.forEach((controller) => controller.abort());
  }, []);

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const select = (files: File[]) => {
    const added = files.map((file) => {
      const check = precheckUpload(serverKind(kind), file);
      return newUploadItem(file, check.ok ? null : check.reason);
    });
    setItems((current) => (multiple ? [...current, ...added] : added));
    if (kind === "video" && !videoTitle && files[0]) {
      setVideoTitle(files[0].name.replace(/\.[^.]+$/, ""));
    }
  };

  const completion = (): UploadCompletion =>
    kind === "video" ? { title: videoTitle.trim() || undefined, deliveryCondition: delivery } : {};

  /** Applies a server outcome to one item — the only place a stage is marked done. */
  const settle = (item: UploadItem, outcome: UploadOutcome) => {
    if (outcome.status === "PROMOTED") {
      patch(item.id, {
        stage: "done",
        uploaded: true,
        error: null,
        failedAt: null,
        retryable: false,
      });
      onUploaded?.(outcome, item.file);
      return true;
    }
    patch(item.id, {
      stage: outcome.retryable ? "failed" : "rejected",
      uploaded: true,
      failedAt: "check",
      retryable: outcome.retryable,
      error:
        outcome.rejectionReason ??
        (outcome.retryable ? "Saving the file could not finish." : "The file was rejected."),
    });
    return false;
  };

  const processItem = async (item: UploadItem): Promise<boolean> => {
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    patch(item.id, { stage: "validating", error: null, failedAt: null, progress: 0 });
    const track: { reached: "validate" | "upload" | "check" } = { reached: "validate" };
    try {
      const outcome = await upload.mutateAsync({
        kind: kind === "video" ? "VIDEO" : "DOCUMENT",
        file: item.file,
        folderId: kind === "document" ? folderId : undefined,
        ...completion(),
        signal: controller.signal,
        onPhase: (phase, uploadId) => {
          if (phase === "uploading") {
            track.reached = "upload";
            patch(item.id, { stage: "uploading", uploadId: uploadId ?? null });
          } else if (phase === "saving") {
            track.reached = "check";
            patch(item.id, { stage: "saving", uploaded: true, progress: 100 });
          }
        },
        onProgress: (percent) => patch(item.id, { progress: percent }),
      });
      return settle(item, outcome);
    } catch (error) {
      if (isCancel(error)) {
        patch(item.id, { stage: "cancelled", error: null });
        return false;
      }
      const uploadedAlready = track.reached === "check";
      patch(item.id, {
        stage: uploadedAlready ? "failed" : "rejected",
        failedAt: track.reached,
        // A lost connection after the bytes arrived can be finished later.
        retryable: uploadedAlready && !(error instanceof ApiError && error.isClientError),
        error: describeError(error),
      });
      return false;
    } finally {
      controllers.current.delete(item.id);
    }
  };

  const startAll = async () => {
    const queue = items.filter((item) => item.stage === "ready");
    if (queue.length === 0) return;
    setRunning(true);
    let stored = 0;
    for (const item of queue) {
      if (await processItem(item)) stored += 1;
    }
    setRunning(false);
    if (stored > 0) {
      toast.success(
        kind === "video"
          ? "Added to Video Legacy"
          : stored === 1
            ? "Added to your vault"
            : `${stored} documents added to your vault`,
      );
    }
  };

  const retryItem = async (item: UploadItem) => {
    if (!item.uploadId) return;
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    setRunning(true);
    patch(item.id, { stage: "saving", error: null, failedAt: null, retryable: false });
    try {
      const outcome = await retry.mutateAsync({
        uploadId: item.uploadId,
        completion: completion(),
        signal: controller.signal,
      });
      if (settle(item, outcome)) toast.success("Stored privately");
    } catch (error) {
      if (isCancel(error)) patch(item.id, { stage: "cancelled" });
      else {
        patch(item.id, {
          stage: "failed",
          failedAt: "check",
          retryable: !(error instanceof ApiError && error.isClientError),
          error: describeError(error),
        });
      }
    } finally {
      controllers.current.delete(item.id);
      setRunning(false);
    }
  };

  const cancelItem = (item: UploadItem) => controllers.current.get(item.id)?.abort();
  const removeItem = (item: UploadItem) =>
    setItems((current) => current.filter((entry) => entry.id !== item.id));

  const ready = items.filter((item) => item.stage === "ready");
  const allSettled = items.length > 0 && !running && ready.length === 0;
  const anyDone = items.some((item) => item.stage === "done");

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {dialogTitle ?? (kind === "document" ? "Upload documents" : "Upload video message")}
        </DialogTitle>
        <DialogDescription>
          {dialogDescription ??
            "Files are checked for type and size, uploaded directly to private storage and then added to your vault."}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {/* Hidden while uploading so the file in progress is in view, not below the fold. */}
        {(multiple || items.length === 0) && !running && (
          <FileDropZone kind={kind} multiple={multiple} disabled={running} onSelect={select} />
        )}

        {items.length > 0 && (
          <ul className="space-y-3" aria-label="Files to upload">
            {items.map((item) => (
              <UploadItemCard
                key={item.id}
                item={item}
                onCancel={() => cancelItem(item)}
                onRetry={() => void retryItem(item)}
                onRemove={() => removeItem(item)}
              />
            ))}
          </ul>
        )}

        {kind === "document" && ready.length > 0 && (
          <FormField label="Folder">
            {(fieldProps) => (
              <Select
                value={folderId ?? "root"}
                onValueChange={(value) => setFolderId(value === "root" ? null : String(value))}
                items={[
                  { value: "root", label: "Root" },
                  ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
                ]}
              >
                <SelectTrigger id={fieldProps.id} className="w-full">
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
        )}

        {kind === "video" && ready.length > 0 && (
          <>
            <FormField label="Title" required>
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  value={videoTitle}
                  onChange={(event) => setVideoTitle(event.target.value)}
                />
              )}
            </FormField>
            <FormField
              label="Delivery condition"
              hint="Strictly enforced server-side: a video is playable only through an access link whose grant type matches."
            >
              {(fieldProps) => (
                <Select
                  value={delivery}
                  onValueChange={(value) => setDelivery(value as DeliveryCondition)}
                  items={DELIVERY}
                >
                  <SelectTrigger id={fieldProps.id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DELIVERY.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
          {anyDone || allSettled ? "Close" : "Cancel"}
        </Button>
        {ready.length > 0 && (
          <Button
            onClick={() => void startAll()}
            disabled={running || (kind === "video" && !videoTitle.trim())}
          >
            {ready.length > 1 ? `Upload ${ready.length} files` : "Upload"}
          </Button>
        )}
        {allSettled && kind === "video" && (
          <Button onClick={() => setItems([])}>Upload another</Button>
        )}
      </DialogFooter>
    </>
  );
}
