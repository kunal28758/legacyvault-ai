"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  FileText,
  History,
  Lock,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import { AIChat } from "@/components/ai/ai-chat";
import { AiDisclaimer } from "@/components/ai/ai-disclaimer";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLegacyState } from "@/hooks/use-legacy-snapshot";
import type { LegacyIntelligence } from "@/lib/client/intelligence";
import { useAIAvailability, useAIInteractions } from "@/hooks/use-ai";
import { useDocumentAccess, useDocuments } from "@/hooks/use-documents";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/client/api-client";
import { formatRelative } from "@/lib/format";
import { AI_PROVIDER_LABELS } from "@/lib/types/ai";
import type { DocumentSummary } from "@/lib/types/document";
import { toast } from "sonner";

const DocumentAIViewer = dynamic(() =>
  import("@/components/ai/document-ai-viewer").then((m) => m.DocumentAIViewer),
);

type Mode = "understand" | "analyze" | "plan";

/**
 * Copilot modes only change the suggested prompts and framing. The assistant
 * reads the same account overview (counts and gaps — never names, values or
 * documents) in every mode, and it cannot change anything in the vault.
 */
const MODES: Record<Mode, { label: string; blurb: string; suggestions: string[] }> = {
  understand: {
    label: "Understand",
    blurb: "Plain-language explanations of documents and how LegacyVault works.",
    suggestions: [
      "Explain beneficiaries vs emergency contacts",
      "How does the Dead Man's Switch protect my family?",
      "What happens to my documents when the switch releases?",
      "What does finalizing my will change?",
    ],
  },
  analyze: {
    label: "Analyze",
    blurb: "Look at your account's gaps and what could be missing.",
    suggestions: [
      "What information needs my attention?",
      "Show me conflicting legacy information",
      "Which assets are not referenced in my Will?",
      "What should I review this month?",
    ],
  },
  plan: {
    label: "Plan",
    blurb: "Turn gaps into an ordered list of next steps.",
    suggestions: [
      "Help me complete my legacy plan",
      "What should I do next, in order?",
      "Help me organize my digital accounts",
      "What should a complete digital legacy plan include?",
    ],
  },
};

const PROVIDER_LABEL: Record<string, string> = AI_PROVIDER_LABELS;
const SESSION_LABEL: Record<string, string> = {
  ASSISTANT: "Assistant",
  DOCUMENT_ANALYSIS: "Document AI",
  WILL_GENERATOR: "Will generator",
};

/**
 * AI Assistant (ADR-008, ADR-016).
 *
 * Answers stream from the configured provider. The conversation exists only
 * in this page's memory: nothing typed here is stored, and the server keeps a
 * content-free usage record. Personalised suggestions come from an account
 * overview of counts and gaps — never names, values or documents.
 */
export function AssistantView() {
  const availability = useAIAvailability();
  const interactions = useAIInteractions(8);
  const documentsQuery = useDocuments({ limit: 100 });
  const accessDocument = useDocumentAccess();
  const now = useNow();
  const [viewing, setViewing] = useState<DocumentSummary | null>(null);
  const searchParams = useSearchParams();
  const requested = searchParams.get("mode");
  const [mode, setMode] = useState<Mode>(
    requested === "understand" || requested === "plan" ? requested : "analyze",
  );
  const legacy = useLegacyState();

  const documents = documentsQuery.data?.items ?? [];
  const configured = availability.data?.configured ?? false;
  const unavailableReason = availability.isError
    ? "The AI status could not be checked. Try reloading the page."
    : availability.isSuccess && !configured
      ? "AI features are not configured in this environment — an administrator needs to add an OpenAI or Gemini key. Everything else in LegacyVault works normally."
      : null;

  const download = async (id: string) => {
    try {
      const access = await accessDocument(id, "download");
      window.open(access.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not open this document.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="LegacyVault Copilot"
        description="Understand documents, analyze gaps and plan your next steps. Copilot answers are AI suggestions; the panel on the right is verified from your account."
        actions={
          availability.isPending ? null : configured ? (
            <StatusBadge tone="ai" icon={Sparkles}>
              {PROVIDER_LABEL[availability.data?.provider ?? ""] ?? "AI"} connected
              {availability.data?.fallbacks?.length
                ? ` · fallback: ${availability.data.fallbacks.map((name) => PROVIDER_LABEL[name]).join(", ")}`
                : ""}
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" icon={Bot}>
              AI not configured
            </StatusBadge>
          )
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <TabsList aria-label="Copilot mode">
            {(Object.keys(MODES) as Mode[]).map((key) => (
              <TabsTrigger key={key} value={key}>
                {MODES[key].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <ul
          aria-label="Where information comes from"
          className="flex flex-wrap gap-1.5 text-[11px]"
        >
          <li className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-success">
            <BadgeCheck className="size-3" aria-hidden /> Verified from your account
          </li>
          <li className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-primary">
            <ScanSearch className="size-3" aria-hidden /> System detected
          </li>
          <li className="inline-flex items-center gap-1 rounded-full border border-brand-purple/25 bg-brand-purple/10 px-2 py-0.5 text-brand-purple">
            <Sparkles className="size-3" aria-hidden /> AI suggestion
          </li>
          <li className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
            <UserRound className="size-3" aria-hidden /> Your input
          </li>
        </ul>
      </div>
      <p className="-mt-3 text-sm text-muted-foreground">{MODES[mode].blurb}</p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="relative overflow-hidden shadow-elevated border-gradient-ai">
          <span
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/2 h-48 w-2/3 -translate-x-1/2 rounded-full bg-brand-purple/15 blur-3xl"
          />
          <CardContent className="relative flex h-[min(72vh,44rem)] flex-col p-4 sm:p-5">
            <AIChat
              className="min-h-0 flex-1"
              endpoint="/ai/assistant/message"
              buildBody={(message, history, attachmentIds) => ({
                message,
                history,
                attachmentIds,
              })}
              allowAttachments
              suggestions={MODES[mode].suggestions}
              placeholder="Ask anything about your legacy, LegacyVault or digital estates…"
              emptyTitle="How can I help?"
              emptyDescription="Answers are tailored with an overview of your account (counts and gaps only). Attach a document or photo to summarize it or ask about it. Legal and financial questions get careful, jurisdiction-aware answers — never a guarantee."
              unavailableReason={unavailableReason}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="glass">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <BadgeCheck className="size-4 text-success" aria-hidden />
                  Verified from your account
                </span>
                {legacy.state && (
                  <span className="font-heading text-base tabular-nums">
                    {legacy.state.readiness.score}%
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!legacy.state ? (
                <p className="text-sm text-muted-foreground">Reading your account…</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Legacy readiness · {legacy.state.open.length} open action
                    {legacy.state.open.length === 1 ? "" : "s"}
                  </p>
                  <ul className="space-y-1">
                    {legacy.state.open.slice(0, 3).map((action) => (
                      <li key={action.id}>
                        <Link
                          href={action.href}
                          className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="min-w-0 flex-1 truncate">{action.title}</span>
                          <ArrowRight
                            className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary"
                            aria-hidden
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={<Link href="/actions" />}
                  >
                    Open Action Centre
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="size-4 text-primary" aria-hidden />
                Understand a document
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {documentsQuery.isPending ? (
                <p className="text-sm text-muted-foreground">Loading your vault…</p>
              ) : documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Upload a document to summarize it, extract details, translate it or ask questions
                  about it.
                </p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {documents.slice(0, 30).map((document) => (
                    <li key={document.id}>
                      <button
                        type="button"
                        onClick={() => setViewing(document)}
                        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-brand-purple/10 focus-visible:ring-3 focus-visible:ring-brand-purple/35"
                      >
                        <Sparkles className="size-3.5 shrink-0 text-brand-purple" aria-hidden />
                        <span className="truncate">{document.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <History className="size-4 text-muted-foreground" aria-hidden />
                Recent AI activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {interactions.isPending ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (interactions.data?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No AI activity yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {interactions.data?.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {SESSION_LABEL[item.sessionType] ?? item.sessionType}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelative(item.createdAt, now)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
                Only when and how AI was used is recorded — never what you asked or what it
                answered.
              </p>
            </CardContent>
          </Card>

          <Card className="glass">
            <CardContent className="space-y-2 p-4 text-xs leading-5 text-muted-foreground">
              <p className="flex items-start gap-2">
                <Lock className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                Conversations stay in this browser tab and are gone when you leave.
              </p>
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                The assistant never sees passwords, account numbers or documents unless you attach a
                file or open a document and ask about it. Attached files are kept in your private
                vault.
              </p>
            </CardContent>
          </Card>
          <AiDisclaimer compact />
          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            render={<a href="/documents" />}
          >
            <FileText data-icon="inline-start" /> Open the document vault
          </Button>
          {/* Last in the column: it fills in when the account has loaded, so
              nothing below it can shift. */}
          {legacy.state && <SystemDetectedCard intelligence={legacy.state.intelligence} />}
        </div>
      </div>

      {viewing && (
        <DocumentAIViewer
          document={viewing}
          allDocuments={documents}
          onOpenChange={(open) => !open && setViewing(null)}
          onDownload={(id) => void download(id)}
        />
      )}
    </div>
  );
}

/**
 * Findings from Legacy Intelligence, labelled "System detected": deterministic
 * rules over the owner's records, shown here by name. The Copilot itself only
 * receives counts.
 */
function SystemDetectedCard({ intelligence }: { intelligence: LegacyIntelligence }) {
  const open = intelligence.open;
  return (
    <Card className="glass">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ScanSearch className="size-4 text-primary" aria-hidden />
          System detected · {open.length} finding{open.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No missing, expiring or conflicting information detected.
          </p>
        ) : (
          <ul className="space-y-1" aria-label="System-detected findings">
            {open.slice(0, 3).map((finding) => (
              <li key={finding.id}>
                <Link
                  href={finding.destination}
                  className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="min-w-0 flex-1 truncate">{finding.title}</span>
                  <ArrowRight
                    className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] leading-4 text-muted-foreground">
          Copilot sees only counts of these findings — never names. The exact records are listed in
          Legacy Intelligence.
        </p>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/intelligence" />}
        >
          Open Legacy Intelligence
        </Button>
      </CardContent>
    </Card>
  );
}
