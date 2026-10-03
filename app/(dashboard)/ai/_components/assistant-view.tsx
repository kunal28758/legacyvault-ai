"use client";

import { useState } from "react";
import { Bot, FileText, History, Lock, ShieldCheck, Sparkles } from "lucide-react";

import { AIChat } from "@/components/ai/ai-chat";
import { AiDisclaimer } from "@/components/ai/ai-disclaimer";
import { DocumentAIViewer } from "@/components/ai/document-ai-viewer";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAIAvailability, useAIInteractions } from "@/hooks/use-ai";
import { useDocumentAccess, useDocuments } from "@/hooks/use-documents";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/client/api-client";
import { formatRelative } from "@/lib/format";
import { AI_PROVIDER_LABELS } from "@/lib/types/ai";
import type { DocumentSummary } from "@/lib/types/document";
import { toast } from "sonner";

const SUGGESTIONS = [
  "What should a complete digital legacy plan include?",
  "What's missing from my legacy plan?",
  "How does the Dead Man's Switch protect my family?",
  "Help me organize my digital accounts",
  "What happens to my documents when the switch releases?",
  "Explain beneficiaries vs emergency contacts",
];

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
        eyebrow="AI assistant"
        title="Ask LegacyVault AI"
        description="Plain-language help with your legacy plan, beneficiaries, assets, documents and the Dead Man’s Switch — and general questions too."
        actions={
          availability.isPending ? null : configured ? (
            <StatusBadge tone="success" icon={Bot}>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="glass-strong">
          <CardContent className="flex h-[min(72vh,44rem)] flex-col p-4 sm:p-5">
            <AIChat
              className="min-h-0 flex-1"
              endpoint="/ai/assistant/message"
              buildBody={(message, history, attachmentIds) => ({
                message,
                history,
                attachmentIds,
              })}
              allowAttachments
              suggestions={SUGGESTIONS}
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
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="size-4 text-brand-cyan" aria-hidden />
                Work with a document
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
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
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
                <Lock className="mt-0.5 size-3.5 shrink-0 text-brand-cyan" aria-hidden />
                Conversations stay in this browser tab and are gone when you leave.
              </p>
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand-cyan" aria-hidden />
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
        </div>
      </div>

      <DocumentAIViewer
        document={viewing}
        allDocuments={documents}
        onOpenChange={(open) => !open && setViewing(null)}
        onDownload={(id) => void download(id)}
      />
    </div>
  );
}
