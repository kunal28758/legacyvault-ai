"use client";

import { useState } from "react";
import {
  Clock,
  FlaskConical,
  MoreHorizontal,
  Play,
  Share2,
  Siren,
  TimerReset,
  Trash2,
  Upload,
  Users,
  Video,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { AssignDialog } from "@/components/forms/assign-dialog";
import { UploadDialog } from "@/components/forms/upload-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { GridSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StaggerGrid, StaggerItem } from "@/components/shared/page-transition";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge, toneForScanStatus } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDemoWorkspace } from "@/hooks/use-demo-workspace";
import { useDemoStore } from "@/lib/demo/store";
import type { DeliveryCondition, DemoVideoMessage } from "@/lib/demo/types";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";

const DELIVERY_META: Record<
  DeliveryCondition,
  { label: string; icon: typeof Zap; tone: "info" | "warning" | "danger"; description: string }
> = {
  IMMEDIATE: {
    label: "Immediate",
    icon: Zap,
    tone: "info",
    description: "Playable through any valid access link that includes it",
  },
  DEAD_MAN_SWITCH: {
    label: "On switch release",
    icon: TimerReset,
    tone: "warning",
    description: "Playable only through a Dead Man’s Switch release link",
  },
  EMERGENCY_ACCESS: {
    label: "Emergency access",
    icon: Siren,
    tone: "danger",
    description: "Playable only through an approved emergency-access grant",
  },
};

/** Video Legacy (task T144 — UI; resumable upload + processing job pending T141/T145). */
export function VideoLegacyView() {
  const { workspace: ws, ready } = useDemoWorkspace();
  const updateVideo = useDemoStore((s) => s.updateVideo);
  const removeVideo = useDemoStore((s) => s.removeVideo);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<DemoVideoMessage | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DemoVideoMessage | null>(null);

  const recipients = (video: DemoVideoMessage) =>
    ws.assignments
      .filter((a) => a.resourceType === "VIDEO_MESSAGE" && a.resourceId === video.id)
      .map((a) => ws.beneficiaries.find((b) => b.id === a.beneficiaryId)?.name ?? "Beneficiary");
  const totalBytes = ws.videos.reduce((s, v) => s + v.sizeBytes, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vault"
        title="Video legacy"
        description="Personal messages for the people you love, delivered exactly when you decide. Recording in the browser arrives later — upload is available today."
        actions={
          <Button className="shadow-glow-blue" onClick={() => setUploadOpen(true)}>
            <Upload data-icon="inline-start" />
            Upload video
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Messages"
          value={ready ? ws.videos.length : "—"}
          icon={Video}
          accent="purple"
        />
        <StatCard
          label="Storage"
          value={ready ? formatBytes(totalBytes) : "—"}
          hint="Up to 500 MB per message"
          accent="blue"
        />
        <StatCard
          label="With recipients"
          value={ready ? ws.videos.filter((v) => recipients(v).length).length : "—"}
          icon={Users}
          accent="cyan"
        />
      </div>

      {!ready ? (
        <GridSkeleton items={3} />
      ) : ws.videos.length === 0 ? (
        <EmptyState
          icon={Video}
          title="No video messages yet"
          description="Upload a message and choose who receives it and when — immediately, on switch release, or through emergency access."
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload data-icon="inline-start" />
              Upload your first message
            </Button>
          }
        />
      ) : (
        <StaggerGrid className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {ws.videos.map((video) => {
            const delivery = DELIVERY_META[video.deliveryCondition];
            const DeliveryIcon = delivery.icon;
            const scan = toneForScanStatus(video.scanStatus);
            const names = recipients(video);
            return (
              <StaggerItem key={video.id}>
                <Card className="motion-safe-transition glass-highlight h-full overflow-hidden glass hover:-translate-y-0.5">
                  <button
                    type="button"
                    onClick={() => setPreview(video)}
                    aria-label={`Preview ${video.title}`}
                    className="group relative block aspect-video w-full overflow-hidden bg-gradient-surface outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_40%,color-mix(in_oklch,var(--brand-purple)_35%,transparent),transparent)]"
                    />
                    <span
                      aria-hidden
                      className="absolute inset-x-4 bottom-4 flex h-1 gap-0.5 opacity-60"
                    >
                      {Array.from({ length: 24 }).map((_, i) => (
                        <span
                          key={i}
                          className="flex-1 rounded-full bg-brand-cyan/60"
                          style={{ height: `${4 + ((i * 7) % 12)}px`, alignSelf: "flex-end" }}
                        />
                      ))}
                    </span>
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-14 items-center justify-center rounded-full bg-background/70 text-foreground shadow-glow-purple backdrop-blur-md transition-transform group-hover:scale-105">
                        <Play className="ml-0.5 size-6" aria-hidden />
                      </span>
                    </span>
                    <span className="absolute right-3 bottom-3 rounded-md bg-background/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums backdrop-blur-sm">
                      {video.durationSeconds ? formatDuration(video.durationSeconds) : "—:—"}
                    </span>
                  </button>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{video.title}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {video.description ?? "No description"}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${video.title}`}
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onClick={() => setPreview(video)}>
                            <Play /> Preview
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setShareFor(video.id)}>
                            <Share2 /> Assign recipient
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setRemoveTarget(video)}
                          >
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={delivery.tone} icon={DeliveryIcon}>
                        {delivery.label}
                      </StatusBadge>
                      <StatusBadge
                        tone={scan.tone}
                        pulse={video.scanStatus === "PENDING"}
                        className="h-5 text-[11px]"
                      >
                        {scan.label}
                      </StatusBadge>
                      {video.demoOnly && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                          <FlaskConical className="size-3" aria-hidden /> Demo only
                        </span>
                      )}
                    </div>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="size-3.5" aria-hidden />
                      {names.length ? names.join(", ") : "No recipient assigned"}
                    </p>
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock className="size-3" aria-hidden /> {formatDate(video.createdAt)} ·{" "}
                      {formatBytes(video.sizeBytes)}
                    </p>
                  </CardContent>
                </Card>
              </StaggerItem>
            );
          })}
        </StaggerGrid>
      )}

      <UploadDialog kind="video" open={uploadOpen} onOpenChange={setUploadOpen} />
      <AssignDialog
        open={Boolean(shareFor)}
        onOpenChange={(open) => !open && setShareFor(null)}
        resource={shareFor ? { type: "VIDEO_MESSAGE", id: shareFor } : null}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Delete “${removeTarget?.title ?? "video"}”?`}
        description="The message is removed from storage and from every access scope. The audit record is kept."
        confirmLabel="Delete video"
        variant="destructive"
        onConfirm={() => {
          if (!removeTarget) return;
          const result = removeVideo(removeTarget.id);
          if (result.ok) toast.success("Video deleted");
          else toast.error(result.message);
        }}
      />

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="glass-strong sm:max-w-2xl">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle>{preview.title}</DialogTitle>
                <DialogDescription>{preview.description ?? "No description"}</DialogDescription>
              </DialogHeader>
              <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-background/80">
                <span
                  aria-hidden
                  className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_40%,color-mix(in_oklch,var(--brand-blue)_30%,transparent),transparent)]"
                />
                <div className="relative flex flex-col items-center gap-3 text-center">
                  <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Play className="ml-0.5 size-7" aria-hidden />
                  </span>
                  <p className="text-sm font-medium">
                    Playback uses a signed 15-minute URL from private storage
                  </p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Not available in the demo workspace — no media is stored here. The player shell,
                    delivery rules and recipients are wired.
                  </p>
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-background/70 px-4 py-2 text-xs backdrop-blur-sm">
                  <span className="h-1 flex-1 rounded-full bg-muted">
                    <span className="block h-full w-0 rounded-full bg-primary" />
                  </span>
                  <span className="tabular-nums">
                    0:00 /{" "}
                    {preview.durationSeconds ? formatDuration(preview.durationSeconds) : "—:—"}
                  </span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Delivery condition</p>
                  <Select
                    value={preview.deliveryCondition}
                    onValueChange={(v) => {
                      updateVideo(preview.id, { deliveryCondition: v as DeliveryCondition });
                      setPreview({ ...preview, deliveryCondition: v as DeliveryCondition });
                      toast.success("Delivery condition updated");
                    }}
                    items={Object.entries(DELIVERY_META).map(([value, m]) => ({
                      value,
                      label: m.label,
                    }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DELIVERY_META).map(([value, m]) => (
                        <SelectItem key={value} value={value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {DELIVERY_META[preview.deliveryCondition].description}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Recipients</p>
                  <p className="text-sm">
                    {recipients(preview).length ? recipients(preview).join(", ") : "None yet"}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setShareFor(preview.id)}>
                    <Share2 data-icon="inline-start" />
                    Assign recipient
                  </Button>
                </div>
              </div>
              <DialogFooter showCloseButton />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
