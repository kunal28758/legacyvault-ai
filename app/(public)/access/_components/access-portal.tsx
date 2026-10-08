"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  Gem,
  MailCheck,
  Play,
  ScrollText,
  ShieldCheck,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiClient } from "@/lib/client/api-client";
import { formatBytes, formatDateTime } from "@/lib/format";
import { PLAN_SECTION_TITLES } from "@/lib/legacy-plan/completeness";
import type { PlanSectionKey } from "@/lib/types/legacy-plan";

/**
 * What a beneficiary sees.
 *
 * The token is exchanged once, on arrival, and the URL is rewritten without it.
 * Everything after that runs on the access cookie, which the browser sends only
 * to `/api/v1/access`. Nothing here can change anything: there is no write on
 * this surface at all.
 *
 * A release link first asks for a one-time code emailed to the contact. The
 * token is kept in memory only (never in the URL or storage) until then.
 */
interface Summary {
  ownerName: string;
  beneficiaryName: string;
  grantType: "DIRECT_SHARE" | "DMS_RELEASE" | "EMERGENCY_ACCESS";
  expiresAt: string;
  issuedAt: string;
  verifiedAt: string | null;
  counts: { documents: number; assets: number; videos: number; planSections: number };
}

interface Challenge {
  verificationRequired: true;
  sentTo: string;
  codeExpiresAt: string;
}

interface Resources {
  grant: Summary;
  documents: { id: string; name: string; mimeType: string; sizeBytes: number }[];
  assets: { id: string; type: string; name: string; category: string }[];
  videos: { id: string; title: string; description: string | null; mimeType: string }[];
  planSections: { key: string; available: boolean }[];
}

interface SignedAccess {
  url: string;
  expiresAt: string;
  name: string;
  mimeType: string;
}

const GRANT_LABEL: Record<Summary["grantType"], string> = {
  DIRECT_SHARE: "shared these with you directly",
  DMS_RELEASE: "arranged for these to reach you",
  EMERGENCY_ACCESS: "granted you emergency access to these",
};

/**
 * Takes the link's secret out of the address bar, before any request is made.
 *
 * Links carry it in the fragment (`/access#t=…`), which a browser never sends
 * to a server, so it reaches no request log and no Referer. A legacy `?t=` link
 * is turned into that form by the proxy before this page renders; reading the
 * query here is only a fallback. Either way the address and the history entry
 * are reset to the bare path first.
 */
function takeLinkSecret(): string | null {
  const secret =
    new URLSearchParams(window.location.hash.slice(1)).get("t") ??
    new URLSearchParams(window.location.search).get("t");
  if (window.location.hash || window.location.search) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  return secret;
}

export function AccessPortal() {
  const [state, setState] = useState<"opening" | "verify" | "ready" | "refused">("opening");
  const [message, setMessage] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const token = useRef<string | null>(null);
  const [resources, setResources] = useState<Resources | null>(null);
  const [section, setSection] = useState<{ key: string; data: Record<string, unknown> } | null>(
    null,
  );
  const [playing, setPlaying] = useState<SignedAccess | null>(null);
  const exchanged = useRef(false);

  const load = useCallback(async () => {
    const { data } = await apiClient.get<Resources>("/access/resources");
    setResources(data);
    setState("ready");
  }, []);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    void (async () => {
      token.current = takeLinkSecret();
      try {
        if (token.current) {
          const { data } = await apiClient.post<Summary | Challenge>("/access/exchange", {
            token: token.current,
          });
          if ("verificationRequired" in data) {
            setChallenge(data);
            setState("verify");
            return;
          }
          token.current = null;
        }
        await load();
      } catch (error) {
        setState("refused");
        setMessage(
          error instanceof ApiError
            ? error.message
            : "This link could not be opened. Ask the person who sent it for a new one.",
        );
      }
    })();
  }, [load]);

  const submitCode = async () => {
    if (!token.current) return;
    setVerifying(true);
    setMessage(null);
    try {
      await apiClient.post<Summary>("/access/exchange", { token: token.current, code });
      token.current = null;
      setCode("");
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "That code could not be checked.");
      if (error instanceof ApiError && error.status === 401) setState("refused");
    } finally {
      setVerifying(false);
    }
  };

  const sendNewCode = async () => {
    if (!token.current) return;
    setVerifying(true);
    setMessage(null);
    try {
      const { data } = await apiClient.post<Summary | Challenge>("/access/exchange", {
        token: token.current,
      });
      if ("verificationRequired" in data) setChallenge(data);
      setCode("");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "A new code could not be sent.");
    } finally {
      setVerifying(false);
    }
  };

  const openDocument = async (id: string) => {
    try {
      const { data } = await apiClient.get<SignedAccess>(`/access/documents/${id}/download`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "That file could not be opened.");
    }
  };

  const playVideo = async (id: string) => {
    try {
      const { data } = await apiClient.get<SignedAccess>(`/access/videos/${id}`);
      setPlaying(data);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "That message could not be played.");
    }
  };

  const openSection = async (key: string) => {
    try {
      const { data } = await apiClient.get<{ key: string; data: Record<string, unknown> }>(
        `/access/plan-sections/${key}`,
      );
      setSection({ key: data.key, data: data.data });
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "That section could not be opened.");
    }
  };

  const signOut = async () => {
    await apiClient.post("/access/logout", {});
    setResources(null);
    setState("refused");
    setMessage("You have been signed out. Open your link again to come back.");
  };

  if (state === "opening") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (state === "verify" && challenge) {
    return (
      <Card className="glass">
        <CardHeader>
          <h1 className="flex items-center gap-2 font-heading text-xl font-semibold">
            <MailCheck className="size-5 text-primary" aria-hidden />
            Confirm it is you
          </h1>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            This link was shared under an emergency release. Before anything opens, enter the
            6-digit code we just sent to <span className="text-foreground">{challenge.sentTo}</span>
            . It expires at {formatDateTime(challenge.codeExpiresAt)}.
          </p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCode();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="release-code">Verification code</Label>
              <Input
                id="release-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                aria-describedby={message ? "release-code-error" : undefined}
                aria-invalid={message ? true : undefined}
                className="max-w-40 text-lg tracking-[0.3em]"
              />
              {message && (
                <p id="release-code-error" role="alert" className="text-xs text-destructive">
                  {message}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={verifying || code.length !== 6}>
                Confirm and open
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={verifying}
                onClick={() => void sendNewCode()}
              >
                Send a new code
              </Button>
            </div>
          </form>
          <p className="text-xs text-muted-foreground">
            Three wrong attempts end a code. If you did not expect this, close the page — nothing
            opens without the code.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state === "refused" || !resources) {
    return (
      <Card className="glass">
        <CardHeader>
          <CardTitle>This link cannot be opened</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{message ?? "The link may have expired, or it may have been revoked."}</p>
          <p>Links expire, and the person who sent it can always send a new one.</p>
        </CardContent>
      </Card>
    );
  }

  const { grant } = resources;

  return (
    // Names can be one long word (an address, a long surname): wrap rather than overflow.
    <div className="space-y-6 break-words">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Hello {grant.beneficiaryName},</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          {grant.ownerName} {GRANT_LABEL[grant.grantType]}.
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-success" aria-hidden />
          Read-only access, open until {formatDateTime(grant.expiresAt)}.
        </p>
      </header>

      {grant.grantType === "DMS_RELEASE" && (
        <Card className="glass" aria-labelledby="release-context">
          <CardHeader>
            <CardTitle id="release-context" className="text-base">
              Why you can see this
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {grant.ownerName} chose, in advance, to share these items with you if their check-ins
              stopped. Their emergency release workflow completed after a period with no recent
              activity on their account. That is all LegacyVault knows — it is not a statement about{" "}
              {grant.ownerName}.
            </p>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Authorized by</dt>
                <dd className="font-medium">{grant.ownerName}, in advance</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Released</dt>
                <dd className="font-medium">{formatDateTime(grant.issuedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Access until</dt>
                <dd className="font-medium">{formatDateTime(grant.expiresAt)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Status: released{grant.verifiedAt ? ", identity confirmed by code" : ""}. Only the
              items below were included; nothing else in {grant.ownerName}&apos;s vault is visible
              to you.
            </p>
          </CardContent>
        </Card>
      )}

      {message && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {message}
        </p>
      )}

      {resources.documents.length > 0 && (
        <Section icon={FileText} title="Documents">
          {resources.documents.map((document) => (
            <Row
              key={document.id}
              title={document.name}
              subtitle={`${document.mimeType} · ${formatBytes(document.sizeBytes)}`}
              action={
                <Button variant="outline" size="sm" onClick={() => void openDocument(document.id)}>
                  <Download data-icon="inline-start" />
                  Open
                </Button>
              }
            />
          ))}
        </Section>
      )}

      {resources.videos.length > 0 && (
        <Section icon={Video} title="Video messages">
          {resources.videos.map((video) => (
            <Row
              key={video.id}
              title={video.title}
              subtitle={video.description ?? "A message recorded for you"}
              action={
                <Button variant="outline" size="sm" onClick={() => void playVideo(video.id)}>
                  <Play data-icon="inline-start" />
                  Play
                </Button>
              }
            />
          ))}
        </Section>
      )}

      {playing && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">{playing.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* A personal recording; there is no caption track to offer. */}
            <video src={playing.url} controls className="w-full rounded-lg" />
          </CardContent>
        </Card>
      )}

      {resources.assets.length > 0 && (
        <Section icon={Gem} title="Assets">
          {resources.assets.map((asset) => (
            <Row
              key={asset.id}
              title={asset.name}
              subtitle={asset.category.replace(/_/g, " ").toLowerCase()}
            />
          ))}
          <p className="px-1 pt-1 text-xs text-muted-foreground">
            Account numbers, credentials and recovery details are never shown here.
          </p>
        </Section>
      )}

      {resources.planSections.length > 0 && (
        <Section icon={ScrollText} title="Plan sections">
          {resources.planSections.map((entry) => (
            <Row
              key={entry.key}
              title={PLAN_SECTION_TITLES[entry.key as PlanSectionKey] ?? entry.key}
              subtitle={entry.available ? "From the finalized plan" : "Not completed"}
              action={
                entry.available ? (
                  <Button variant="outline" size="sm" onClick={() => void openSection(entry.key)}>
                    Read
                  </Button>
                ) : undefined
              }
            />
          ))}
        </Section>
      )}

      {section && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">
              {PLAN_SECTION_TITLES[section.key as PlanSectionKey] ?? section.key}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {Object.entries(section.data).map(([key, value]) => (
                <div key={key} className="grid gap-1 sm:grid-cols-[12rem_1fr]">
                  <dt className="text-muted-foreground">{humanize(key)}</dt>
                  <dd className="break-words">{render(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end pt-2">
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out of this link
        </Button>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Icon className="size-4 text-brand-cyan" aria-hidden />
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function Row({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(render).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
