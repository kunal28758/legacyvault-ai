"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Mail, RotateCcw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAccessTokens,
  useIssueAccessToken,
  useResendAccessToken,
  useRevokeAccessToken,
} from "@/hooks/use-access-tokens";
import { useNow } from "@/hooks/use-now";
import { isReverificationCancelled, useReverifiedAction } from "@/hooks/use-reverified-action";
import { ApiError } from "@/lib/client/api-client";
import { formatRelative } from "@/lib/format";
import type { BeneficiaryAssignment } from "@/lib/types/beneficiary";
import type { AccessTokenSummary } from "@/lib/types/access";
import type { AccessScopeInput } from "@/lib/validators/dms.validators";

/**
 * Direct-share access links for one beneficiary (FR-D011, ADR-014).
 *
 * A link may only cover what this person is already assigned, so the choices
 * here are their assignments and nothing else — `issue_access_token()` refuses
 * anything wider. The plaintext link exists in this component's state for as
 * long as the sheet is open and is never cached, stored or logged: the server
 * keeps only its SHA-256 hash and cannot produce it again.
 */
const SHAREABLE = new Set([
  "FINANCIAL_ASSET",
  "PHYSICAL_ASSET",
  "DIGITAL_ASSET",
  "DOCUMENT",
  "VIDEO_MESSAGE",
]);

interface AccessLinksPanelProps {
  beneficiaryId: string;
  beneficiaryName: string;
  assignments: BeneficiaryAssignment[];
  canIssue: boolean;
}

export function AccessLinksPanel({
  beneficiaryId,
  beneficiaryName,
  assignments,
  canIssue,
}: AccessLinksPanelProps) {
  const tokensQuery = useAccessTokens(beneficiaryId);
  const issue = useIssueAccessToken();
  const resend = useResendAccessToken();
  const revoke = useRevokeAccessToken();
  const reverified = useReverifiedAction();
  const now = useNow(30_000);

  const [selected, setSelected] = useState<string[]>([]);
  const [ttlDays, setTtlDays] = useState("30");
  const [issued, setIssued] = useState<{ link: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  // Assignments already carry their resource's name, so the panel does not
  // download the vault's catalogues to label five rows.
  const shareable = assignments.filter((assignment) => SHAREABLE.has(assignment.resourceType));

  const tokens = tokensQuery.data?.items ?? [];
  const days = Number(ttlDays);
  const validTtl = Number.isInteger(days) && days >= 1 && days <= 30;

  const scopeFrom = (ids: string[]): AccessScopeInput => ({
    documents: shareable
      .filter((a) => ids.includes(a.id) && a.resourceType === "DOCUMENT")
      .map((a) => a.resourceId),
    assets: shareable
      .filter((a) => ids.includes(a.id) && a.resourceType.endsWith("_ASSET"))
      .map((a) => ({
        type: a.resourceType as AccessScopeInput["assets"][number]["type"],
        id: a.resourceId,
      })),
    videos: shareable
      .filter((a) => ids.includes(a.id) && a.resourceType === "VIDEO_MESSAGE")
      .map((a) => a.resourceId),
    planSections: [],
  });

  const show = (result: { link: string; emailSent: boolean }) => {
    setIssued(result);
    setCopied(false);
    setSelected([]);
    toast.success(
      result.emailSent
        ? `Link emailed to ${beneficiaryName}`
        : "Link created — copy it now, it cannot be shown again",
    );
  };

  const onIssue = async () => {
    try {
      show(
        await issue.mutateAsync({
          beneficiaryId,
          scope: scopeFrom(selected),
          ttlDays: days,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not create that link.");
    }
  };

  const onResend = async (tokenId: string) => {
    try {
      show(await reverified(() => resend.mutateAsync({ beneficiaryId, tokenId, ttlDays: days })));
    } catch (error) {
      if (isReverificationCancelled(error)) return;
      toast.error(error instanceof ApiError ? error.message : "Could not resend that link.");
    }
  };

  const onRevoke = async (tokenId: string) => {
    try {
      await revoke.mutateAsync({ beneficiaryId, tokenId });
      toast.success("Link revoked");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not revoke that link.");
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.link);
      setCopied(true);
    } catch {
      toast.error("Copying is not available here — select the link and copy it.");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4 text-brand-cyan" aria-hidden /> Access links
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        A link covers only what this person is assigned, expires within 30 days and is exchanged
        once for a secure session. Only its hash is stored — it cannot be shown again later.
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        Sharing a document emails them a link automatically. Create one here only for assets,
        videos, or to send a fresh link.
      </p>

      {issued && (
        <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 p-3">
          <p className="text-xs font-medium text-success">
            {issued.emailSent
              ? "Emailed to the beneficiary. Your copy:"
              : "Copy this now — it is not stored and cannot be shown again."}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">
              {issued.link}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {shareable.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Nothing is assigned to this person yet, so there is nothing a link could cover.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium">What the link covers</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {shareable.map((assignment) => (
              <li key={assignment.id}>
                <Label className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-muted/50">
                  <Checkbox
                    checked={selected.includes(assignment.id)}
                    onCheckedChange={(checked) =>
                      setSelected((previous) =>
                        checked
                          ? [...previous, assignment.id]
                          : previous.filter((id) => id !== assignment.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {assignment.resourceName ?? "No longer available"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {RESOURCE_LABELS[assignment.resourceType]}
                  </span>
                </Label>
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <div className="w-28">
              <Label htmlFor={`ttl-${beneficiaryId}`} className="text-xs">
                Expires in (days)
              </Label>
              <Input
                id={`ttl-${beneficiaryId}`}
                type="number"
                min={1}
                max={30}
                value={ttlDays}
                onChange={(event) => setTtlDays(event.target.value)}
              />
            </div>
            <Button
              className="flex-1"
              disabled={!canIssue || selected.length === 0 || !validTtl || issue.isPending}
              onClick={() => void onIssue()}
            >
              <Send data-icon="inline-start" />
              {issue.isPending ? "Creating and emailing…" : "Create and email the link"}
            </Button>
          </div>
          {!canIssue && (
            <p className="text-xs text-muted-foreground">
              This beneficiary is inactive — reactivate them to issue a link.
            </p>
          )}
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="space-y-2">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-xs">
                  <StatusBadge tone={stateOf(token, now).tone}>
                    {stateOf(token, now).label}
                  </StatusBadge>
                  <span className="text-muted-foreground">{scopeSummary(token)}</span>
                </p>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="size-3" aria-hidden />
                  {token.deliveredAt
                    ? `Delivered ${formatRelative(token.deliveredAt, now)}`
                    : "Not delivered yet"}
                  {" · "}
                  Expires {formatRelative(token.expiresAt, now)}
                  {token.lastUsedAt ? ` · Last used ${formatRelative(token.lastUsedAt, now)}` : ""}
                </p>
              </div>
              {!token.revokedAt && Date.parse(token.expiresAt) > now && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!validTtl || resend.isPending}
                    onClick={() => void onResend(token.id)}
                  >
                    <RotateCcw data-icon="inline-start" />
                    {resend.isPending && resend.variables?.tokenId === token.id
                      ? "Resending…"
                      : "Resend"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => void onRevoke(token.id)}
                  >
                    <Trash2 data-icon="inline-start" />
                    {revoke.isPending && revoke.variables?.tokenId === token.id
                      ? "Revoking…"
                      : "Revoke"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RESOURCE_LABELS: Record<string, string> = {
  FINANCIAL_ASSET: "Financial asset",
  PHYSICAL_ASSET: "Physical asset",
  DIGITAL_ASSET: "Digital asset",
  DOCUMENT: "Document",
  VIDEO_MESSAGE: "Video",
};

function stateOf(
  token: AccessTokenSummary,
  now: number,
): { label: string; tone: "success" | "neutral" | "danger" | "warning" } {
  if (token.revokedAt)
    return { label: `Revoked (${token.revokedReason ?? "OWNER"})`, tone: "danger" };
  if (Date.parse(token.expiresAt) <= now) return { label: "Expired", tone: "neutral" };
  if (token.usedAt) return { label: "In use", tone: "success" };
  return { label: "Active", tone: "warning" };
}

function scopeSummary(token: AccessTokenSummary): string {
  const parts = [
    [token.scope.documents.length, "document"],
    [token.scope.assets.length, "asset"],
    [token.scope.videos.length, "video"],
  ] as const;
  return (
    parts
      .filter(([count]) => count > 0)
      .map(([count, noun]) => `${count} ${noun}${count === 1 ? "" : "s"}`)
      .join(" · ") || "Nothing"
  );
}
