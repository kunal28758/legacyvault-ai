"use client";

import { FileImage, FileText, FlaskConical, Lock, MoreHorizontal, Share2 } from "lucide-react";

import { StatusBadge, toneForScanStatus } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DemoDocument } from "@/lib/demo/types";
import { formatBytes, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Renders the type icon for a MIME type (image vs. document). */
export function DocumentIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  return mimeType.startsWith("image/") ? (
    <FileImage className={className} aria-hidden />
  ) : (
    <FileText className={className} aria-hidden />
  );
}

export function documentKind(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return mimeType.split("/")[1].toUpperCase();
  if (mimeType.includes("word")) return "DOCX";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "XLSX";
  if (mimeType.startsWith("text/")) return "TXT";
  return "FILE";
}

interface VaultCardProps {
  document: DemoDocument;
  folderName: string;
  sharedCount: number;
  onOpen: () => void;
  menu?: React.ReactNode;
  className?: string;
}

/** Document tile for the vault grid: type, size, scan status, sharing and privacy indicator. */
export function VaultCard({
  document,
  folderName,
  sharedCount,
  onOpen,
  menu,
  className,
}: VaultCardProps) {
  const scan = toneForScanStatus(document.scanStatus);
  return (
    <Card
      className={cn(
        "motion-safe-transition glass-highlight h-full glass hover:-translate-y-0.5",
        className,
      )}
    >
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <DocumentIcon mimeType={document.mimeType} className="size-5" />
            <span className="absolute -right-1 -bottom-1 rounded-md bg-background px-1 text-[9px] font-semibold tracking-wide text-muted-foreground ring-1 ring-border">
              {documentKind(document.mimeType)}
            </span>
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="truncate text-sm font-medium">{document.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {folderName} · {formatBytes(document.sizeBytes)} · v{document.versionCount}
            </p>
          </button>
          {menu ?? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Open ${document.name}`}
              onClick={onOpen}
            >
              <MoreHorizontal />
            </Button>
          )}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={scan.tone}
            pulse={document.scanStatus === "PENDING"}
            className="h-5 text-[11px]"
          >
            {scan.label}
          </StatusBadge>
          {document.demoOnly && (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              <FlaskConical className="size-3" aria-hidden /> Demo only
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            {sharedCount > 0 && (
              <span className="flex items-center gap-1">
                <Share2 className="size-3" aria-hidden /> {sharedCount}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Lock className="size-3 text-brand-cyan" aria-hidden /> Private
            </span>
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Updated {formatDate(document.updatedAt)}
        </p>
      </CardContent>
    </Card>
  );
}
