"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

const DOCUMENT_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "text/plain": [".txt"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};

const VIDEO_TYPES: Record<string, string[]> = {
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
  "video/quicktime": [".mov"],
};

export type UploadKind = "document" | "video";

/** Client-side pre-check (UX only — the server re-validates declared + actual bytes, FR-H002/H003). */
export function precheckFile(
  file: File,
  kind: UploadKind,
): { ok: true } | { ok: false; reason: string } {
  const types = kind === "document" ? DOCUMENT_TYPES : VIDEO_TYPES;
  const max = kind === "document" ? DOCUMENT_MAX_BYTES : VIDEO_MAX_BYTES;
  const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  const allowedExt = Object.values(types).flat();
  if (!allowedExt.includes(ext))
    return {
      ok: false,
      reason: `“${ext}” files are not accepted. Allowed: ${allowedExt.join(", ")}.`,
    };
  if (file.type && !types[file.type])
    return {
      ok: false,
      reason: `Declared type ${file.type} does not match an accepted ${kind} type.`,
    };
  if (file.type && !types[file.type]?.includes(ext))
    return { ok: false, reason: "The file extension does not match its declared type." };
  if (file.size === 0) return { ok: false, reason: "The file is empty." };
  if (file.size > max)
    return {
      ok: false,
      reason: `Files must be ${formatBytes(max)} or smaller (this one is ${formatBytes(file.size)}).`,
    };
  return { ok: true };
}

export type UploadStage = "idle" | "selected" | "uploading" | "scanning" | "done" | "rejected";

interface FileUploadProps {
  kind: UploadKind;
  stage: UploadStage;
  file: File | null;
  error: string | null;
  progress: number;
  onSelect: (file: File) => void;
  onClear: () => void;
  className?: string;
}

/**
 * Drag-and-drop upload zone (task T096 — UI). Mirrors the two-step direct
 * upload flow visually: declare → upload to quarantine → scan → promote.
 */
export function FileUpload({
  kind,
  stage,
  file,
  error,
  progress,
  onSelect,
  onClear,
  className,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const accept = Object.values(kind === "document" ? DOCUMENT_TYPES : VIDEO_TYPES)
    .flat()
    .join(",");

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const first = files?.[0];
      if (first) onSelect(first);
    },
    [onSelect],
  );

  if (stage === "idle" || (stage === "rejected" && !file)) {
    return (
      <div className={cn("space-y-3", className)}>
        <div
          role="button"
          tabIndex={0}
          aria-label={`Choose a ${kind} to upload`}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30",
            error && "border-destructive/50",
          )}
        >
          <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow-blue">
            <UploadCloud className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium">Drop a {kind} here, or click to browse</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {kind === "document"
                ? "PDF, images, text or Office files · up to 50 MB"
                : "MP4, WebM or MOV · up to 500 MB"}
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>
    );
  }

  const steps = [
    { id: "validate", label: "Validated", done: stage !== "rejected" },
    {
      id: "upload",
      label: "Uploaded to quarantine",
      done: stage === "scanning" || stage === "done",
      active: stage === "uploading",
    },
    { id: "scan", label: "Malware scan", done: stage === "done", active: stage === "scanning" },
    { id: "promote", label: "Moved to your vault", done: stage === "done" },
  ];

  return (
    <div className={cn("space-y-4 rounded-2xl border border-border p-4", className)}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <FileUp className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file?.name}</p>
          <p className="text-xs text-muted-foreground">{file ? formatBytes(file.size) : ""}</p>
        </div>
        {(stage === "selected" || stage === "rejected" || stage === "done") && (
          <Button variant="ghost" size="icon-sm" aria-label="Remove file" onClick={onClear}>
            <X />
          </Button>
        )}
      </div>
      {stage === "rejected" ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : stage === "selected" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" aria-hidden /> Passed the client pre-check.
          The server validates type, size and content again before scanning.
        </p>
      ) : (
        <ol className="space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center gap-2 text-sm">
              {step.done ? (
                <CheckCircle2 className="size-4 text-success" aria-hidden />
              ) : step.active ? (
                <Loader2 className="size-4 animate-spin text-brand-cyan" aria-hidden />
              ) : (
                <span className="size-4 rounded-full border border-border" aria-hidden />
              )}
              <span className={cn(!step.done && !step.active && "text-muted-foreground")}>
                {step.label}
              </span>
              {step.id === "upload" && step.active && (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {progress}%
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {stage === "uploading" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full bg-gradient-brand transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
