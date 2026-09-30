"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, FileText, Gem, Play, ScrollText, ShieldCheck, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
 */
interface Summary {
  ownerName: string;
  beneficiaryName: string;
  grantType: "DIRECT_SHARE" | "DMS_RELEASE" | "EMERGENCY_ACCESS";
  expiresAt: string;
  counts: { documents: number; assets: number; videos: number; planSections: number };
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

export function AccessPortal() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<"opening" | "ready" | "refused">("opening");
  const [message, setMessage] = useState<string | null>(null);
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
      const token = searchParams.get("t");
      try {
        if (token) {
          await apiClient.post<Summary>("/access/exchange", { token });
          // The secret must not stay in the address bar or the history entry.
          window.history.replaceState(null, "", window.location.pathname);
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
  }, [searchParams, load]);

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
    <div className="space-y-6">
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
