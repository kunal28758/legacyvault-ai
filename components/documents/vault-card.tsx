"use client";

import {
  CalendarClock,
  FileImage,
  FileText,
  Lock,
  MoreHorizontal,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNow } from "@/hooks/use-now";
import {
  DOCUMENT_CATEGORY_LABELS,
  EXPIRY_WINDOW_DAYS,
  daysUntil,
  type DocumentProfile,
} from "@/lib/types/document-profile";
import type { DocumentSummary } from "@/lib/types/document";
import { formatBytes, formatDate, pluralize } from "@/lib/format";
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

/**
 * Sharing state of a document, never by colour alone: green "Shared securely"
 * with the beneficiary count, or a neutral "Private" lock.
 */
export function SharingChip({ count, className }: { count: number; className?: string }) {
  return count > 0 ? (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 text-[11px] font-medium text-success",
        className,
      )}
    >
      <ShieldCheck className="size-3.5" aria-hidden />
      Shared securely · {pluralize(count, "beneficiary", "beneficiaries")}
    </span>
  ) : (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <Lock className="size-3" aria-hidden />
      Private
    </span>
  );
}

/**
 * Category and expiry, as the owner set them. Expiry turns amber inside the
 * expiry window and red once passed; AI-suggested values carry a violet mark.
 */
export function DocumentProfileChips({
  profile,
  now,
}: {
  profile: DocumentProfile | null;
  now: number;
}) {
  if (!profile?.category && !profile?.expiresOn) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const days = profile.expiresOn ? daysUntil(profile.expiresOn, now) : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {profile.category && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-[11px] font-medium text-primary">
          {profile.aiSuggested?.includes("category") && (
            <Sparkles className="size-3 text-brand-purple" aria-label="AI-suggested" />
          )}
          {DOCUMENT_CATEGORY_LABELS[profile.category]}
        </span>
      )}
      {profile.expiresOn && days !== null && (
        <span
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium",
            days < 0
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : days <= EXPIRY_WINDOW_DAYS
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          <CalendarClock className="size-3" aria-hidden />
          {days < 0 ? "Expired" : "Expires"} {formatDate(profile.expiresOn)}
        </span>
      )}
    </span>
  );
}

interface VaultCardProps {
  document: DocumentSummary;
  folderName: string;
  sharedCount: number;
  onOpen: () => void;
  menu?: React.ReactNode;
  className?: string;
}

/** Document tile for the vault grid: type, size, version, sharing state. */
export function VaultCard({
  document,
  folderName,
  sharedCount,
  onOpen,
  menu,
  className,
}: VaultCardProps) {
  const now = useNow();
  return (
    <Card className={cn("group glass-highlight h-full surface-interactive py-0 glass", className)}>
      <CardContent className="flex h-full flex-col gap-4 p-4">
        <div className="flex items-start gap-3">
          <span className="relative icon-tile size-11 rounded-xl text-primary">
            <DocumentIcon
              mimeType={document.mimeType}
              className="size-5 transition-transform duration-300 group-hover:scale-110"
            />
            <span className="absolute -right-1.5 -bottom-1.5 rounded-md bg-background px-1 text-[9px] font-semibold tracking-wide text-muted-foreground ring-1 ring-border">
              {documentKind(document.mimeType)}
            </span>
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
        {(document.profile?.category || document.profile?.expiresOn) && (
          <DocumentProfileChips profile={document.profile} now={now} />
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <SharingChip count={sharedCount} />
          <p className="text-[11px] text-muted-foreground">
            Updated {formatDate(document.updatedAt)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
