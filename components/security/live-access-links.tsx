"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveAccessLinks, useRevokeAccessToken } from "@/hooks/use-access-tokens";
import { ApiError } from "@/lib/client/api-client";
import { formatDateTime } from "@/lib/format";
import type { AccessGrantType, AccessTokenSummary } from "@/lib/types/access";

const KIND: Record<AccessGrantType, string> = {
  DIRECT_SHARE: "Shared by you",
  DMS_RELEASE: "Emergency release",
  EMERGENCY_ACCESS: "Emergency access",
};

function linkState(link: AccessTokenSummary): { label: string; tone: StatusTone } {
  if (link.grantType === "DMS_RELEASE") {
    return link.verifiedAt
      ? { label: "Verified by code", tone: "success" }
      : { label: "Not verified yet", tone: "warning" };
  }
  if (link.lastUsedAt) return { label: "Opened", tone: "info" };
  return link.deliveredAt
    ? { label: "Sent, not opened", tone: "neutral" }
    : { label: "Not opened", tone: "neutral" };
}

/**
 * Every link that can still open part of the legacy — who holds it, why, and
 * until when — with revocation one click away. Secrets never reach this view:
 * the API selects no hash of any kind.
 */
export function LiveAccessLinks() {
  const links = useLiveAccessLinks();
  const revoke = useRevokeAccessToken();
  const [pending, setPending] = useState<AccessTokenSummary | null>(null);
  const items = links.data?.items ?? [];

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-primary" aria-hidden />
          Live access links
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Every link that can still open something, scoped to what it was issued for. Revoking takes
          effect on the next request.
        </p>
      </CardHeader>
      <CardContent>
        {links.isPending ? (
          <Skeleton className="h-24 w-full rounded-lg" aria-hidden />
        ) : links.isError ? (
          <p className="text-sm text-destructive">Access links could not be loaded.</p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No live links. Nobody can open anything in your vault right now.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Live access links">
            {items.map((link) => {
              const state = linkState(link);
              return (
                <li
                  key={link.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1" id={`link-${link.id}`}>
                    <p className="truncate text-sm font-medium">
                      {link.beneficiaryName}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {KIND[link.grantType]}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expires {formatDateTime(link.expiresAt)}
                    </p>
                  </div>
                  <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    aria-describedby={`link-${link.id}`}
                    onClick={() => setPending(link)}
                  >
                    Revoke
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Revoke this link?"
        description="It stops working on the next request. Anything already opened cannot be taken back."
        confirmLabel="Revoke link"
        variant="destructive"
        onConfirm={async () => {
          if (!pending) return;
          try {
            await revoke.mutateAsync({ beneficiaryId: pending.beneficiaryId, tokenId: pending.id });
            toast.success("Link revoked");
            setPending(null);
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "That link was not revoked.");
          }
        }}
      />
    </Card>
  );
}
