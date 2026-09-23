"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  FileUpload,
  precheckFile,
  type UploadKind,
  type UploadStage,
} from "@/components/shared/file-upload";
import { FormField } from "@/components/forms/form-field";
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
import { useFolders, useUpload } from "@/hooks/use-documents";
import { ApiError } from "@/lib/api/client";
import type { DeliveryCondition } from "@/lib/types/video";

interface UploadDialogProps {
  kind: UploadKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFolderId?: string | null;
}

const DELIVERY: { value: DeliveryCondition; label: string }[] = [
  { value: "IMMEDIATE", label: "Immediately (any valid access link)" },
  { value: "DEAD_MAN_SWITCH", label: "Only on Dead Man’s Switch release" },
  { value: "EMERGENCY_ACCESS", label: "Only through emergency access" },
];

/**
 * Upload dialog (ADR-005).
 *
 * The real two-step flow: the server hands out a signed URL into a private
 * quarantine bucket, the browser PUTs the bytes straight there, and the server
 * then measures the object, checks its leading bytes, runs the malware-scan
 * boundary and promotes it. Nothing exists in the vault until that succeeds.
 */
export function UploadDialog({
  kind,
  open,
  onOpenChange,
  defaultFolderId = null,
}: UploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong sm:max-w-lg">
        {open && (
          <UploadForm kind={kind} onOpenChange={onOpenChange} defaultFolderId={defaultFolderId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({
  kind,
  onOpenChange,
  defaultFolderId,
}: {
  kind: UploadKind;
  onOpenChange: (open: boolean) => void;
  defaultFolderId: string | null;
}) {
  const foldersQuery = useFolders();
  const upload = useUpload();

  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [title, setTitle] = useState("");
  const [delivery, setDelivery] = useState<DeliveryCondition>("IMMEDIATE");
  const [scanNote, setScanNote] = useState<string | null>(null);

  const folders = foldersQuery.data?.items ?? [];

  const select = (next: File) => {
    const check = precheckFile(next, kind);
    if (!check.ok) {
      setFile(next);
      setError(check.reason);
      setStage("rejected");
      return;
    }
    setFile(next);
    setError(null);
    setStage("selected");
    if (kind === "video" && !title) setTitle(next.name.replace(/\.[^.]+$/, ""));
  };

  const clear = () => {
    setFile(null);
    setError(null);
    setStage("idle");
    setProgress(0);
    setScanNote(null);
  };

  const start = async () => {
    if (!file) return;
    setStage("uploading");
    setProgress(0);
    setError(null);

    try {
      const outcome = await upload.mutateAsync({
        kind: kind === "video" ? "VIDEO" : "DOCUMENT",
        file,
        folderId: kind === "document" ? folderId : undefined,
        ...(kind === "video"
          ? { title: title.trim() || file.name, deliveryCondition: delivery }
          : {}),
        onProgress: (percent) => {
          setProgress(percent);
          if (percent >= 100) setStage("scanning");
        },
      });

      if (outcome.status === "REJECTED") {
        setStage("rejected");
        setError(outcome.rejectionReason ?? "The file was rejected.");
        return;
      }

      setStage("done");
      // Never claim a scan happened when no scanner is configured (ADR-015).
      setScanNote(
        outcome.scan.performed
          ? `Scanned by ${outcome.scan.provider ?? "the configured scanner"} and stored privately.`
          : "Stored privately. Malware scanning is not configured in this environment, so this file was not scanned.",
      );
      toast.success(kind === "document" ? "Added to your vault" : "Added to Video Legacy");
    } catch (caught) {
      setStage("rejected");
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "The upload failed. Please try again.",
      );
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {kind === "document" ? "Upload document" : "Upload video message"}
        </DialogTitle>
        <DialogDescription>
          Files are validated, uploaded directly to a private quarantine bucket, checked against the
          malware-scan boundary and only then moved into your vault.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <FileUpload
          kind={kind}
          stage={stage}
          file={file}
          error={error}
          progress={progress}
          onSelect={select}
          onClear={clear}
        />

        {scanNote && (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {scanNote}
          </p>
        )}

        {kind === "document" && stage === "selected" && (
          <FormField label="Folder">
            {(props) => (
              <Select
                value={folderId ?? "root"}
                onValueChange={(value) => setFolderId(value === "root" ? null : String(value))}
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
        )}

        {kind === "video" && stage === "selected" && (
          <>
            <FormField label="Title" required>
              {(props) => (
                <Input
                  {...props}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              )}
            </FormField>
            <FormField
              label="Delivery condition"
              hint="Strictly enforced server-side: a video is playable only through an access link whose grant type matches."
            >
              {(props) => (
                <Select
                  value={delivery}
                  onValueChange={(value) => setDelivery(value as DeliveryCondition)}
                  items={DELIVERY}
                >
                  <SelectTrigger id={props.id} className="w-full">
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
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {stage === "done" ? "Close" : "Cancel"}
        </Button>
        {stage === "selected" && (
          <Button
            onClick={() => void start()}
            disabled={upload.isPending || (kind === "video" && !title.trim())}
          >
            Upload
          </Button>
        )}
        {stage === "done" && <Button onClick={clear}>Upload another</Button>}
      </DialogFooter>
    </>
  );
}
