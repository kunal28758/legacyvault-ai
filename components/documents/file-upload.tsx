"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  Lock,
  RotateCcw,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";

import { ProgressLine } from "@/components/shared/operation-progress";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import {
  acceptAttribute,
  describeAcceptedTypes,
  maxBytesFor,
  type UploadKind as ServerUploadKind,
} from "@/lib/uploads/file-types";
import { cn } from "@/lib/utils";

export type UploadKind = "document" | "video";

export function serverKind(kind: UploadKind): ServerUploadKind {
  return kind === "video" ? "VIDEO" : "DOCUMENT";
}

/**
 * Where one file is. `ready` has passed the browser pre-check; everything after
 * it is driven by real server responses — a stage is only marked done once the
 * server has confirmed it.
 */
export type UploadItemStage =
  | "ready"
  | "invalid"
  | "validating"
  | "uploading"
  | "saving"
  | "done"
  | "rejected"
  | "failed"
  | "cancelled";

export type UploadStep = "validate" | "upload" | "check" | "store";

export interface UploadItem {
  id: string;
  file: File;
  stage: UploadItemStage;
  progress: number;
  error: string | null;
  /** The step the failure happened at, so the checklist marks the right one. */
  failedAt: UploadStep | null;
  /** True once the bytes have reached private storage. */
  uploaded: boolean;
  /** The server holds the bytes, unpromoted, and completing again may succeed. */
  retryable: boolean;
  uploadId: string | null;
}

export function newUploadItem(file: File, invalidReason: string | null): UploadItem {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    stage: invalidReason ? "invalid" : "ready",
    progress: 0,
    error: invalidReason,
    failedAt: null,
    uploaded: false,
    retryable: false,
    uploadId: null,
  };
}

interface DropZoneProps {
  kind: UploadKind;
  multiple?: boolean;
  disabled?: boolean;
  onSelect: (files: File[]) => void;
  className?: string;
}

/** Drag-and-drop zone with a keyboard-reachable file picker. */
export function FileDropZone({
  kind,
  multiple = false,
  disabled,
  onSelect,
  className,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const accepted = serverKind(kind);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const list = Array.from(files ?? []);
      if (list.length) onSelect(multiple ? list : list.slice(0, 1));
    },
    [multiple, onSelect],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`Choose ${multiple ? `${kind}s` : `a ${kind}`} to upload`}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
      className={cn(
        "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/30",
        disabled && "cursor-not-allowed opacity-60 hover:border-border hover:bg-transparent",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow-blue transition-transform group-hover:scale-105 motion-reduce:transition-none">
        <UploadCloud className="size-6" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-medium">
          Drop {multiple ? `${kind}s` : `a ${kind}`} here, or click to browse
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {describeAcceptedTypes(accepted)} · up to {formatBytes(maxBytesFor(accepted))}
          {multiple ? " each" : ""}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={acceptAttribute(accepted)}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

type StepState = "done" | "active" | "failed" | "pending";

const STAGE_FOR_STEP: Record<UploadStep, UploadItemStage> = {
  validate: "validating",
  upload: "uploading",
  check: "saving",
  store: "saving", // promotion happens in the same server call as the checks
};

function stepState(item: UploadItem, step: UploadStep): StepState {
  if (item.failedAt === step) return "failed";
  if (item.stage === STAGE_FOR_STEP[step] && step !== "store") return "active";
  switch (step) {
    case "validate":
      return item.uploadId ? "done" : "pending";
    case "upload":
      return item.uploaded ? "done" : "pending";
    case "check":
    case "store":
      return item.stage === "done" ? "done" : "pending";
  }
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <CheckCircle2 className="size-4 text-success" aria-hidden />;
  if (state === "failed") return <XCircle className="size-4 text-destructive" aria-hidden />;
  if (state === "active") {
    return (
      <Loader2
        className="size-4 animate-spin text-brand-cyan motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  return <span className="size-4 rounded-full border border-border" aria-hidden />;
}

interface UploadItemCardProps {
  item: UploadItem;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
}

const STATUS_TEXT: Record<UploadItemStage, string> = {
  ready: "Ready to upload",
  invalid: "Not accepted",
  validating: "Validating…",
  uploading: "Uploading to private storage…",
  saving: "Checking and saving…",
  done: "Stored privately",
  rejected: "Rejected",
  failed: "Upload failed",
  cancelled: "Cancelled",
};

/** One file's journey: validated → uploaded → checked → stored, or why not. */
export function UploadItemCard({ item, onCancel, onRetry, onRemove }: UploadItemCardProps) {
  const steps = {
    validate: stepState(item, "validate"),
    upload: stepState(item, "upload"),
    check: stepState(item, "check"),
    store: stepState(item, "store"),
  };
  const busy = item.stage === "validating" || item.stage === "uploading" || item.stage === "saving";
  const showSteps =
    item.stage !== "ready" && item.stage !== "invalid" && item.stage !== "cancelled";

  return (
    <li
      className={cn(
        "space-y-3 rounded-2xl border p-4 transition-colors",
        item.stage === "done" && "border-success/30 bg-success/5",
        (item.stage === "failed" || item.stage === "rejected" || item.stage === "invalid") &&
          "border-destructive/30 bg-destructive/5",
        !["done", "failed", "rejected", "invalid"].includes(item.stage) && "border-border",
      )}
      aria-busy={busy}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <FileUp className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(item.file.size)} · <span role="status">{STATUS_TEXT[item.stage]}</span>
          </p>
        </div>
        {busy && item.stage !== "saving" ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : !busy ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${item.file.name}`}
            onClick={onRemove}
          >
            <X />
          </Button>
        ) : null}
      </div>

      {showSteps && (
        <ol className="space-y-1.5" aria-label={`Progress for ${item.file.name}`}>
          <li className="flex items-center gap-2 text-sm">
            <StepIcon state={steps.validate} />
            <span>Validated</span>
          </li>
          <li className="flex items-center gap-2 text-sm">
            <StepIcon state={steps.upload} />
            <span>Uploaded to private storage</span>
            {steps.upload === "active" && (
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {item.progress}%
              </span>
            )}
          </li>
          <li className="flex items-center gap-2 text-sm">
            <StepIcon state={steps.check} />
            <span className={cn(steps.check === "active" && "font-medium")}>
              {steps.check === "active"
                ? "Checking file size and type…"
                : steps.check === "failed"
                  ? item.retryable
                    ? "Could not finish saving"
                    : "File checks failed"
                  : "File size and type checked"}
            </span>
          </li>
          <li className="flex items-center gap-2 text-sm">
            <StepIcon state={steps.store} />
            <span>Added to your private vault</span>
          </li>
        </ol>
      )}

      {/* Bytes in transit have a real percentage; the checks before and after
          them do not, so those show activity without a number — and the bar
          never reads 100% before the file is actually stored. */}
      {item.stage === "uploading" && (
        <ProgressLine label={`Uploading ${item.file.name}`} value={item.progress} />
      )}
      {(item.stage === "validating" || item.stage === "saving") && (
        <ProgressLine
          label={
            item.stage === "validating"
              ? `Validating ${item.file.name}`
              : `Checking and saving ${item.file.name}`
          }
        />
      )}

      {item.stage === "done" && (
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-brand-cyan" aria-hidden />
          Stored privately. It opens only through short-lived signed links.
        </p>
      )}

      {item.error && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-2 rounded-lg border border-destructive/30 bg-background/60 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{item.error}</p>
          {item.retryable && (
            <Button size="sm" variant="outline" onClick={onRetry} className="ml-auto">
              <RotateCcw aria-hidden /> Retry
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
