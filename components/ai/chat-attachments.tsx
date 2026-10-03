"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  FileImage,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  Presentation,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";

import {
  UploadCancelledError,
  useRetryUpload,
  useUpload,
  type UploadPhase,
} from "@/hooks/use-documents";
import { ApiError } from "@/lib/client/api-client";
import { formatBytes } from "@/lib/format";
import type { UploadOutcome } from "@/lib/types/document";
import { cn } from "@/lib/utils";
import { precheckChatAttachment } from "@/lib/validators/ai.validators";

/**
 * Files attached to an assistant message (ADR-005, ADR-008 § 5).
 *
 * There is no separate upload path for the chat: each file goes through the
 * vault's own two-step upload — a signed URL into the private quarantine
 * bucket, then server-side size and type checks and the malware scan — and
 * becomes a vault document. Only once the server has promoted it does the chip
 * turn "Ready", and only its document id is ever sent with a message; the
 * server checks ownership and scan status again when the AI reads it.
 */
export type AttachmentState = "preparing" | "uploading" | "scanning" | "ready" | "failed";

export interface ChatAttachment {
  /** Local id for this chip. */
  key: string;
  name: string;
  size: number;
  mimeType: string;
  state: AttachmentState;
  progress: number;
  documentId?: string;
  uploadId?: string;
  error?: string;
  /** The scan could not run; the file is still held in quarantine. */
  retryable?: boolean;
  /** The malware scanner rejected the file. */
  blocked?: boolean;
}

/** An attachment as it is remembered on a sent message. */
export interface SentAttachment {
  documentId: string;
  name: string;
  size: number;
  mimeType: string;
}

const STATE_FOR_PHASE: Record<UploadPhase, AttachmentState> = {
  validating: "preparing",
  uploading: "uploading",
  scanning: "scanning",
  storing: "scanning",
};

function describeError(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "The file could not be uploaded. Try again.";
}

function isCancel(error: unknown): boolean {
  return (
    error instanceof UploadCancelledError ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function fromOutcome(outcome: UploadOutcome): Partial<ChatAttachment> {
  if (outcome.status === "PROMOTED" && outcome.documentId) {
    return { state: "ready", documentId: outcome.documentId, error: undefined, retryable: false };
  }
  return {
    state: "failed",
    uploadId: outcome.uploadId,
    retryable: outcome.retryable,
    blocked: outcome.scan.status === "INFECTED",
    error: outcome.rejectionReason ?? "The file could not be secured. Try again.",
  };
}

/** Upload state for the files waiting to be sent with the next message. */
export function useChatAttachments(limit: number) {
  const upload = useUpload();
  const retryUpload = useRetryUpload();
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const active = controllers.current;
    return () => active.forEach((controller) => controller.abort());
  }, []);

  const patch = useCallback(
    (key: string, next: Partial<ChatAttachment>) =>
      setPending((current) => current.map((a) => (a.key === key ? { ...a, ...next } : a))),
    [],
  );

  const run = async (key: string, work: (signal: AbortSignal) => Promise<UploadOutcome>) => {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    try {
      patch(key, fromOutcome(await work(controller.signal)));
    } catch (error) {
      if (isCancel(error)) return;
      patch(key, { state: "failed", retryable: false, error: describeError(error) });
    } finally {
      controllers.current.delete(key);
    }
  };

  /** Adds chosen files; returns how many were refused because of the limit. */
  const add = (files: File[]): number => {
    const room = Math.max(0, limit - pending.length);
    const accepted = files.slice(0, room);
    const items = accepted.map((file) => {
      const check = precheckChatAttachment(file);
      const item: ChatAttachment = {
        key: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        mimeType: check.ok ? check.mimeType : file.type,
        state: check.ok ? "preparing" : "failed",
        progress: 0,
        error: check.ok ? undefined : check.reason,
      };
      return { item, file, ok: check.ok };
    });
    setPending((current) => [...current, ...items.map(({ item }) => item)]);

    for (const { item, file, ok } of items) {
      if (!ok) continue;
      void run(item.key, (signal) =>
        upload.mutateAsync({
          kind: "DOCUMENT",
          file,
          folderId: null,
          signal,
          onProgress: (percent) => patch(item.key, { progress: percent }),
          onPhase: (phase, uploadId) =>
            patch(item.key, { state: STATE_FOR_PHASE[phase], ...(uploadId ? { uploadId } : {}) }),
        }),
      );
    }
    return files.length - accepted.length;
  };

  /** Runs the security scan again for a file still held in quarantine. */
  const retry = (key: string) => {
    const item = pending.find((a) => a.key === key);
    if (!item?.uploadId || !item.retryable) return;
    patch(key, { state: "scanning", error: undefined });
    const uploadId = item.uploadId;
    void run(key, (signal) => retryUpload.mutateAsync({ uploadId, signal }));
  };

  const remove = (key: string): ChatAttachment | undefined => {
    controllers.current.get(key)?.abort();
    const item = pending.find((a) => a.key === key);
    setPending((current) => current.filter((a) => a.key !== key));
    return item;
  };

  const clear = () => setPending([]);

  return { pending, add, retry, remove, clear };
}

function FileTypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith("image/")) return <FileImage className={className} aria-hidden />;
  if (mimeType.includes("spreadsheet") || mimeType === "text/csv") {
    return <FileSpreadsheet className={className} aria-hidden />;
  }
  if (mimeType.includes("presentation")) return <Presentation className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}

function kindLabel(mimeType: string, name: string): string {
  if (mimeType.startsWith("image/")) return "Image";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "File" : name.slice(dot + 1).toUpperCase();
}

const STATE_TEXT: Record<AttachmentState, string> = {
  preparing: "Preparing…",
  uploading: "Uploading",
  scanning: "Scanning for malware…",
  ready: "Ready",
  failed: "Failed",
};

/** One file waiting to be sent, with its upload and scan state. */
export function AttachmentChip({
  attachment,
  onRemove,
  onRetry,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const busy =
    attachment.state === "preparing" ||
    attachment.state === "uploading" ||
    attachment.state === "scanning";
  const status =
    attachment.state === "uploading"
      ? `Uploading ${attachment.progress}%`
      : STATE_TEXT[attachment.state];

  return (
    <li
      className={cn(
        "flex max-w-full min-w-0 items-start gap-2 rounded-xl border px-2.5 py-2 text-xs sm:max-w-[20rem]",
        attachment.state === "failed"
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-background/70",
      )}
    >
      {attachment.blocked ? (
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      ) : (
        <FileTypeIcon
          mimeType={attachment.mimeType}
          className={cn(
            "mt-0.5 size-4 shrink-0",
            attachment.state === "failed" ? "text-destructive" : "text-brand-cyan",
          )}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={attachment.name}>
          {attachment.name}
        </p>
        <p className="flex items-center gap-1 text-muted-foreground">
          <span>
            {kindLabel(attachment.mimeType, attachment.name)} · {formatBytes(attachment.size)} ·
          </span>
          {busy && (
            <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
          )}
          {attachment.state === "ready" && (
            <CircleCheck className="size-3 text-success" aria-hidden />
          )}
          <span className={cn(attachment.state === "failed" && "text-destructive")}>{status}</span>
        </p>
        {attachment.state === "uploading" && (
          <div
            className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`Uploading ${attachment.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={attachment.progress}
          >
            <div
              className="h-full rounded-full bg-brand-cyan transition-[width]"
              style={{ width: `${attachment.progress}%` }}
            />
          </div>
        )}
        {attachment.error && <p className="mt-1 leading-4 text-destructive">{attachment.error}</p>}
        {attachment.state === "failed" && attachment.retryable && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="size-3" aria-hidden /> Retry scan
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="-m-1 rounded-md p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

/** Files shown on a sent message, or carried into the next one. */
export function SentAttachmentList({
  attachments,
  label,
  onRemove,
  className,
}: {
  attachments: SentAttachment[];
  label: string;
  /** When set, each file can be left out of the next message. */
  onRemove?: (documentId: string) => void;
  className?: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {attachments.map((attachment) => {
        return (
          <li
            key={attachment.documentId}
            className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-current/20 bg-background/10 px-2 py-1 text-[11px]"
          >
            <FileTypeIcon mimeType={attachment.mimeType} className="size-3.5 shrink-0" />
            <span className="truncate" title={attachment.name}>
              {attachment.name}
            </span>
            <span className="shrink-0 opacity-75">{formatBytes(attachment.size)}</span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(attachment.documentId)}
                aria-label={`Stop including ${attachment.name}`}
                className="-mr-1 rounded p-0.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
