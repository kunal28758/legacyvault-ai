"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
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
import { useDemoWorkspace } from "@/hooks/use-demo-workspace";
import { useDemoStore } from "@/lib/demo/store";
import type { DeliveryCondition } from "@/lib/demo/types";

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
 * Upload dialog. Runs the real client pre-check, then PREVIEWS the two-step
 * flow (quarantine upload → scan → promote) without sending bytes anywhere —
 * the storage API (T090/T205) does not exist yet. The result is flagged
 * "demo only" in the workspace.
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
        <UploadForm kind={kind} onOpenChange={onOpenChange} defaultFolderId={defaultFolderId} />
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
  const { workspace: ws } = useDemoWorkspace();
  const addDemoDocument = useDemoStore((s) => s.addDemoDocument);
  const markDocumentScanned = useDemoStore((s) => s.markDocumentScanned);
  const addDemoVideo = useDemoStore((s) => s.addDemoVideo);
  const updateVideo = useDemoStore((s) => s.updateVideo);

  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [title, setTitle] = useState("");
  const [delivery, setDelivery] = useState<DeliveryCondition>("IMMEDIATE");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, []);

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
  };

  const start = () => {
    if (!file) return;
    setStage("uploading");
    setProgress(0);
    let value = 0;
    const tick = window.setInterval(() => {
      value = Math.min(100, value + 12 + Math.round(Math.random() * 10));
      setProgress(value);
      if (value >= 100) {
        window.clearInterval(tick);
        setStage("scanning");
        const created =
          kind === "document"
            ? addDemoDocument({
                name: file.name,
                mimeType: file.type || "application/octet-stream",
                sizeBytes: file.size,
                folderId,
              })
            : addDemoVideo({
                title: title.trim() || file.name,
                description: null,
                deliveryCondition: delivery,
                sizeBytes: file.size,
              });
        const id = created.details?.id as string | undefined;
        const t = window.setTimeout(() => {
          if (id) {
            if (kind === "document") markDocumentScanned(id);
            else updateVideo(id, {});
          }
          setStage("done");
          toast.success(
            kind === "document" ? "Added to your vault (demo)" : "Added to Video Legacy (demo)",
            {
              description:
                "Preview only — no file left this browser. Real uploads go straight to private storage.",
            },
          );
        }, 1800);
        timers.current.push(t);
      }
    }, 160);
    timers.current.push(tick);
  };

  const folders = ws.folders;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {kind === "document" ? "Upload document" : "Upload video message"}
        </DialogTitle>
        <DialogDescription>
          Files are validated, uploaded directly to a private quarantine bucket, scanned for malware
          and only then moved into your vault.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Demo workspace: this previews the flow and adds a placeholder record. The file is not
          uploaded or stored anywhere.
        </p>
        <FileUpload
          kind={kind}
          stage={stage}
          file={file}
          error={error}
          progress={progress}
          onSelect={select}
          onClear={clear}
        />
        {kind === "document" && stage === "selected" && (
          <FormField label="Folder">
            {(props) => (
              <Select
                value={folderId ?? "root"}
                onValueChange={(v) => setFolderId(v === "root" ? null : String(v))}
                items={[
                  { value: "root", label: "Root" },
                  ...folders.map((f) => ({ value: f.id, label: f.name })),
                ]}
              >
                <SelectTrigger id={props.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Root</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
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
                <Input {...props} value={title} onChange={(e) => setTitle(e.target.value)} />
              )}
            </FormField>
            <FormField
              label="Delivery condition"
              hint="Strictly enforced: a video is playable only through an access link whose grant type matches."
            >
              {(props) => (
                <Select
                  value={delivery}
                  onValueChange={(v) => setDelivery(v as DeliveryCondition)}
                  items={DELIVERY}
                >
                  <SelectTrigger id={props.id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DELIVERY.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
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
          <Button onClick={start} disabled={kind === "video" && !title.trim()}>
            Preview upload
          </Button>
        )}
        {stage === "done" && <Button onClick={clear}>Upload another</Button>}
      </DialogFooter>
    </>
  );
}
