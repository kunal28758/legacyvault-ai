"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  Download,
  FileDown,
  FileSearch,
  FileText,
  FolderInput,
  GitCompare,
  Languages,
  ListChecks,
  Loader2,
  RefreshCw,
  ScanText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AIChat } from "@/components/ai/ai-chat";
import { AiDisclaimer, AiGeneratedLabel } from "@/components/ai/ai-disclaimer";
import { MarkdownText } from "@/components/ai/markdown-text";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  useAIAvailability,
  useAnalyzeDocument,
  useCompareDocuments,
  useDocumentAnalyses,
} from "@/hooks/use-ai";
import { ApiError } from "@/lib/client/api-client";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  AI_PROVIDER_LABELS,
  type DocumentAnalysisRecord,
  type DocumentComparisonResult,
  type GroundingReport,
} from "@/lib/types/ai";
import type { DocumentSummary } from "@/lib/types/document";
import {
  TRANSLATION_LANGUAGES,
  type DocumentAnalysisAction,
  type DocumentExtraction,
  type DocumentSummary as SummaryData,
} from "@/lib/validators/ai.validators";
import { cn } from "@/lib/utils";

type Tab = "summary" | "ask" | "extract" | "ocr" | "translate" | "compare";

const PROVIDER_LABEL: Record<string, string> = AI_PROVIDER_LABELS;

const ASK_SUGGESTIONS = [
  "Summarize this document",
  "What are the important dates?",
  "Who is mentioned?",
  "Explain this simply",
  "Find missing information",
];

function saveFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function copy(text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Copied to clipboard"))
    .catch(() => toast.error("Could not copy"));
}

function baseName(name: string) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w\- ]+/g, "")
      .trim() || "document"
  );
}

/* ── Plain-text renderings, for copy and export ──────────────────────────── */

function summaryToMarkdown(name: string, data: SummaryData): string {
  const list = (items: string[]) =>
    items.length ? items.map((i) => `- ${i}`).join("\n") : "- None found";
  return [
    `# ${name} — AI summary`,
    `Type: ${data.documentType} · Confidence: ${data.confidence}`,
    "",
    "## Executive summary",
    data.executiveSummary,
    "",
    "## Key points",
    list(data.keyPoints),
    "",
    "## Important dates",
    list(data.importantDates.map((d) => `${d.date} — ${d.description} (${d.source})`)),
    "",
    "## Important amounts",
    list(data.importantAmounts.map((a) => `${a.amount} — ${a.description} (${a.source})`)),
    "",
    "## People and organizations",
    list([...data.people, ...data.organizations].map((p) => `${p.name} — ${p.role} (${p.source})`)),
    "",
    "## Potentially important clauses",
    list(data.clauses.map((c) => `${c.title}: ${c.summary} (${c.source})`)),
    "",
    "## Missing information and questions",
    list(data.missingInformation),
    "",
    "## Detailed summary",
    data.detailedSummary,
    "",
    "_AI-generated from the document text. Not legal or financial advice._",
  ].join("\n");
}

function extractionToCsv(data: DocumentExtraction): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = [
    ["Category", "Label", "Value", "Source"],
    ...data.fields.map((f) => ["Field", f.label, f.value, f.source]),
    ...data.referenceNumbers.map((r) => ["Reference", r.label, r.value, r.source]),
    ...data.names.map((n) => ["Name", n.role, n.name, n.source]),
    ...data.dates.map((d) => ["Date", d.description, d.date, d.source]),
    ...data.amounts.map((a) => ["Amount", a.description, a.amount, a.source]),
  ];
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function unverifiedSet(grounding: GroundingReport | null): Set<string> {
  return new Set((grounding?.unverified ?? []).map((item) => item.value));
}

function GroundingNote({ grounding }: { grounding: GroundingReport | null }) {
  if (!grounding || grounding.checked === 0) return null;
  const ok = grounding.unverified.length === 0;
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5",
        ok ? "border-success/30 bg-success/5" : "border-warning/40 bg-warning/10",
      )}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      )}
      <span>
        {ok
          ? `All ${grounding.checked} extracted values were found in the document text.`
          : `${grounding.verified} of ${grounding.checked} values were found in the document text. Items marked “check” could not be matched exactly — verify them against the original.`}
      </span>
    </p>
  );
}

function CheckMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
      check
    </span>
  );
}

function Section({
  title,
  children,
  empty,
}: {
  title: string;
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {empty ? (
        <p className="text-sm text-muted-foreground">None found in the document.</p>
      ) : (
        children
      )}
    </section>
  );
}

function ResultMeta({
  record,
  children,
}: {
  record: DocumentAnalysisRecord;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <AiGeneratedLabel />
      <span>
        {PROVIDER_LABEL[record.provider] ?? record.provider} · {formatDateTime(record.createdAt)}
      </span>
      <span>
        ·{" "}
        {record.extraction.method === "ocr"
          ? "Read by text recognition (OCR)"
          : "Read from the file's text"}
        {record.extraction.unitCount ? ` · ${record.extraction.unitCount} page(s)/section(s)` : ""}
      </span>
      {record.extraction.truncated && (
        <span className="text-warning">· Long document: only the first part was analysed</span>
      )}
      {children}
    </div>
  );
}

function SummaryResult({
  record,
  name,
}: {
  record: DocumentAnalysisRecord & { action: "summary" };
  name: string;
}) {
  const data = record.data;
  const flagged = unverifiedSet(record.grounding);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="info" icon={null}>
          {data.documentType}
        </StatusBadge>
        <StatusBadge
          tone={
            data.confidence === "high"
              ? "success"
              : data.confidence === "medium"
                ? "info"
                : "warning"
          }
          icon={null}
        >
          {data.confidence} confidence
        </StatusBadge>
      </div>
      <Section title="Executive summary">
        <p className="text-sm leading-6">{data.executiveSummary}</p>
      </Section>
      <Section title="Key information" empty={data.keyPoints.length === 0}>
        <ul className="list-disc space-y-1 pl-5 text-sm marker:text-brand-cyan">
          {data.keyPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </Section>
      <Section title="Important dates" empty={data.importantDates.length === 0}>
        <ul className="space-y-1.5 text-sm">
          {data.importantDates.map((d) => (
            <li key={`${d.date}${d.description}`} className="flex flex-wrap gap-x-2">
              <span className="font-medium tabular-nums">{d.date}</span>
              <CheckMark show={flagged.has(d.date)} />
              <span className="text-muted-foreground">{d.description}</span>
              <span className="text-[11px] text-muted-foreground">({d.source})</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Important amounts" empty={data.importantAmounts.length === 0}>
        <ul className="space-y-1.5 text-sm">
          {data.importantAmounts.map((a) => (
            <li key={`${a.amount}${a.description}`} className="flex flex-wrap gap-x-2">
              <span className="font-medium tabular-nums">{a.amount}</span>
              <CheckMark show={flagged.has(a.amount)} />
              <span className="text-muted-foreground">{a.description}</span>
              <span className="text-[11px] text-muted-foreground">({a.source})</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section
        title="People & organizations"
        empty={data.people.length + data.organizations.length === 0}
      >
        <ul className="space-y-1.5 text-sm">
          {[...data.people, ...data.organizations].map((p) => (
            <li key={`${p.name}${p.role}`} className="flex flex-wrap gap-x-2">
              <span className="font-medium">{p.name}</span>
              <CheckMark show={flagged.has(p.name)} />
              <span className="text-muted-foreground">{p.role}</span>
              <span className="text-[11px] text-muted-foreground">({p.source})</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Potentially important clauses" empty={data.clauses.length === 0}>
        <ul className="space-y-2 text-sm">
          {data.clauses.map((c) => (
            <li key={c.title} className="rounded-lg border border-border px-3 py-2">
              <p className="font-medium">
                {c.title}{" "}
                <span className="text-[11px] font-normal text-muted-foreground">({c.source})</span>
              </p>
              <p className="text-muted-foreground">{c.summary}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Missing information & questions" empty={data.missingInformation.length === 0}>
        <ul className="list-disc space-y-1 pl-5 text-sm marker:text-warning">
          {data.missingInformation.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>
      <details className="group rounded-lg border border-border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Detailed summary
        </summary>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{data.detailedSummary}</p>
      </details>
      <GroundingNote grounding={record.grounding} />
      <ResultMeta record={record} />
      <ResultActions
        onCopy={() => copy(summaryToMarkdown(name, data))}
        onExport={() =>
          saveFile(`${baseName(name)}-summary.md`, summaryToMarkdown(name, data), "text/markdown")
        }
        exportLabel="Export .md"
      />
    </div>
  );
}

function ExtractionResult({
  record,
  name,
}: {
  record: DocumentAnalysisRecord & { action: "extract" };
  name: string;
}) {
  const data = record.data;
  const flagged = unverifiedSet(record.grounding);
  const rows: { category: string; label: string; value: string; source: string }[] = [
    ...data.fields.map((f) => ({
      category: "Field",
      label: f.label,
      value: f.value,
      source: f.source,
    })),
    ...data.referenceNumbers.map((r) => ({
      category: "Reference",
      label: r.label,
      value: r.value,
      source: r.source,
    })),
    ...data.names.map((n) => ({
      category: "Name",
      label: n.role,
      value: n.name,
      source: n.source,
    })),
    ...data.dates.map((d) => ({
      category: "Date",
      label: d.description,
      value: d.date,
      source: d.source,
    })),
    ...data.amounts.map((a) => ({
      category: "Amount",
      label: a.description,
      value: a.amount,
      source: a.source,
    })),
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <span className="text-muted-foreground">Document type:</span> {data.documentType}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No structured information was found in the document.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  What
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Value
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.category}-${index}`} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <span className="block text-[11px] text-muted-foreground">{row.category}</span>
                    {row.label}
                  </td>
                  <td className="px-3 py-2 font-medium break-all">
                    {row.value}
                    <CheckMark show={flagged.has(row.value)} />
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                    {row.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <GroundingNote grounding={record.grounding} />
      <ResultMeta record={record} />
      <ResultActions
        onCopy={() => copy(JSON.stringify(data, null, 2))}
        onExport={() =>
          saveFile(`${baseName(name)}-extracted.csv`, extractionToCsv(data), "text/csv")
        }
        exportLabel="Export .csv"
      />
    </div>
  );
}

function TextResult({
  record,
  name,
  suffix,
}: {
  record: DocumentAnalysisRecord;
  name: string;
  suffix: string;
}) {
  const text = "text" in record.data ? record.data.text : "";
  const markdown = record.action === "explain" || record.action === "translate";
  return (
    <div className="space-y-4">
      <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-background/50 p-3">
        {markdown ? (
          <MarkdownText text={text} />
        ) : (
          <pre className="font-mono text-xs leading-5 whitespace-pre-wrap">{text}</pre>
        )}
      </div>
      <ResultMeta record={record}>{record.language && <span>· {record.language}</span>}</ResultMeta>
      <ResultActions
        onCopy={() => copy(text)}
        onExport={() => saveFile(`${baseName(name)}-${suffix}.txt`, text, "text/plain")}
        exportLabel="Export .txt"
      />
    </div>
  );
}

function ResultActions({
  onCopy,
  onExport,
  exportLabel,
}: {
  onCopy: () => void;
  onExport: () => void;
  exportLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={onCopy}>
        <Copy data-icon="inline-start" /> Copy
      </Button>
      <Button size="sm" variant="outline" onClick={onExport}>
        <FileDown data-icon="inline-start" /> {exportLabel}
      </Button>
    </div>
  );
}

function Generating({ label }: { label: string }) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-10 text-center"
      role="status"
    >
      <span className="relative flex size-10 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-brand-purple/20 motion-reduce:animate-none" />
        <Sparkles className="size-5 text-brand-purple" aria-hidden />
      </span>
      <p className="text-sm font-medium">{label}</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Reading the document and checking every value against its text. Long or scanned documents
        can take a minute.
      </p>
    </div>
  );
}

/* ── Viewer ───────────────────────────────────────────────────────────────── */

interface DocumentAIViewerProps {
  document: DocumentSummary | null;
  allDocuments: DocumentSummary[];
  onOpenChange: (open: boolean) => void;
  onDownload: (id: string) => void;
  onMove?: (document: DocumentSummary) => void;
  onDelete?: (document: DocumentSummary) => void;
  initialTab?: Tab;
}

/**
 * The AI document viewer (ADR-008 § 5). Every result comes from the server,
 * grounded against the document's own text and stored encrypted; reopening a
 * result costs nothing, and "Regenerate" makes a new version.
 */
export function DocumentAIViewer({
  document,
  allDocuments,
  onOpenChange,
  onDownload,
  onMove,
  onDelete,
  initialTab = "summary",
}: DocumentAIViewerProps) {
  return (
    <Sheet open={Boolean(document)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden glass-strong sm:max-w-2xl">
        {document && (
          <ViewerBody
            key={document.id}
            document={document}
            allDocuments={allDocuments}
            onDownload={onDownload}
            onMove={onMove}
            onDelete={onDelete}
            initialTab={initialTab}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ViewerBody({
  document,
  allDocuments,
  onDownload,
  onMove,
  onDelete,
  initialTab,
}: Omit<DocumentAIViewerProps, "document" | "onOpenChange"> & {
  document: DocumentSummary;
  initialTab: Tab;
}) {
  const availability = useAIAvailability();
  const analyses = useDocumentAnalyses(document.id);
  const analyze = useAnalyzeDocument(document.id);
  const compare = useCompareDocuments();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState<(typeof TRANSLATION_LANGUAGES)[number]>("English");
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const [comparison, setComparison] = useState<DocumentComparisonResult | null>(null);

  const configured = availability.data?.configured ?? false;
  const unavailableReason =
    availability.isSuccess && !configured
      ? "AI features are not configured in this environment. An administrator needs to add an OpenAI or Gemini key. Everything else in your vault works normally."
      : null;

  const find = (action: DocumentAnalysisAction, lang?: string | null) =>
    analyses.data?.items.find(
      (item) => item.action === action && (lang === undefined || item.language === lang),
    );

  const run = async (action: DocumentAnalysisAction, regenerate = false) => {
    const slot = action === "translate" ? `translate:${language}` : action;
    setPending(slot);
    setError((current) => ({ ...current, [slot]: "" }));
    try {
      await analyze.mutateAsync({
        action,
        regenerate,
        ...(action === "translate" ? { language } : {}),
      });
    } catch (caught) {
      setError((current) => ({
        ...current,
        [slot]: caught instanceof ApiError ? caught.message : "The AI could not finish. Try again.",
      }));
    } finally {
      setPending(null);
    }
  };

  const others = useMemo(
    () => allDocuments.filter((d) => d.id !== document.id),
    [allDocuments, document.id],
  );

  const scanned = document.scan.performed;
  const kind = document.mimeType.split("/")[1]?.split(".").pop()?.toUpperCase() ?? "FILE";

  const actionButton = (
    target: Tab,
    icon: ReactNode,
    label: string,
    options: { onClick?: () => void } = {},
  ) => (
    <Button
      size="sm"
      variant={tab === target ? "default" : "outline"}
      aria-pressed={tab === target}
      onClick={() => {
        setTab(target);
        options.onClick?.();
      }}
    >
      {icon}
      {label}
    </Button>
  );

  const panel = (
    slot: string,
    action: DocumentAnalysisAction,
    result: DocumentAnalysisRecord | undefined,
    render: (record: DocumentAnalysisRecord) => ReactNode,
    label: string,
    /** What the result is called, for the empty state ("summary", "translation"). */
    noun: string,
  ) => {
    if (pending === slot) return <Generating label={`${label}…`} />;
    return (
      <div className="space-y-4">
        {error[slot] && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error[slot]}
          </p>
        )}
        {analyses.isPending ? (
          <p className="text-sm text-muted-foreground">Loading saved results…</p>
        ) : result ? (
          <>
            {render(result)}
            <Button
              size="sm"
              variant="ghost"
              disabled={!configured || pending !== null}
              onClick={() => void run(action, true)}
            >
              <RefreshCw data-icon="inline-start" /> Regenerate
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-5">
            <p className="text-sm text-muted-foreground">
              No {noun} yet for this version of the document.
            </p>
            <Button
              disabled={!configured || pending !== null}
              onClick={() => void run(action)}
              className="shadow-glow-blue"
            >
              <Sparkles data-icon="inline-start" /> {label}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <SheetHeader className="shrink-0 border-b border-border pr-10">
        <SheetTitle className="flex items-center gap-2 break-all">
          <FileText className="size-4 shrink-0 text-brand-cyan" aria-hidden />
          {document.name}
        </SheetTitle>
        <SheetDescription>
          {kind} · {formatBytes(document.sizeBytes)} · uploaded {formatDateTime(document.createdAt)}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {scanned ? (
            <StatusBadge tone="success" icon={ShieldCheck}>
              Scanned {document.scan.provider === "clamav" ? "by ClamAV" : ""}
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" icon={ShieldAlert}>
              Not scanned
            </StatusBadge>
          )}
          {availability.isPending ? null : configured ? (
            <StatusBadge tone="info" icon={Bot}>
              AI: {PROVIDER_LABEL[availability.data?.provider ?? ""] ?? "ready"}
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" icon={Bot}>
              AI not configured
            </StatusBadge>
          )}
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Document actions">
          {actionButton("summary", <Sparkles data-icon="inline-start" />, "Summarize")}
          {actionButton("ask", <Bot data-icon="inline-start" />, "Ask AI")}
          {actionButton("extract", <ListChecks data-icon="inline-start" />, "Extract information")}
          {actionButton("ocr", <ScanText data-icon="inline-start" />, "Text / OCR")}
          {actionButton("translate", <Languages data-icon="inline-start" />, "Translate")}
          {actionButton("compare", <GitCompare data-icon="inline-start" />, "Compare")}
          <Button size="sm" variant="outline" onClick={() => onDownload(document.id)}>
            <Download data-icon="inline-start" /> Download
          </Button>
          {onMove && (
            <Button size="sm" variant="outline" onClick={() => onMove(document)}>
              <FolderInput data-icon="inline-start" /> Move
            </Button>
          )}
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => onDelete(document)}
            >
              <Trash2 data-icon="inline-start" /> Delete
            </Button>
          )}
        </div>

        {unavailableReason && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5">
            {unavailableReason}
          </p>
        )}

        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsContent value="summary" className="pt-1">
            {panel(
              "summary",
              "summary",
              find("summary"),
              (record) => (
                <SummaryResult
                  record={record as DocumentAnalysisRecord & { action: "summary" }}
                  name={document.name}
                />
              ),
              "Summarize",
              "summary",
            )}
          </TabsContent>

          <TabsContent value="ask" className="pt-1">
            <AIChat
              key={document.id}
              className="h-[55vh]"
              endpoint={`/ai/documents/${document.id}/ask`}
              buildBody={(question, history) => ({ question, history: history.slice(-10) })}
              suggestions={ASK_SUGGESTIONS}
              placeholder={`Ask about ${document.name}…`}
              emptyTitle="Ask about this document"
              emptyDescription="Answers come only from this document's text. If it doesn't say, the assistant will tell you so."
              unavailableReason={unavailableReason}
              maxHistory={10}
            />
          </TabsContent>

          <TabsContent value="extract" className="pt-1">
            {panel(
              "extract",
              "extract",
              find("extract"),
              (record) => (
                <ExtractionResult
                  record={record as DocumentAnalysisRecord & { action: "extract" }}
                  name={document.name}
                />
              ),
              "Extract information",
              "extracted information",
            )}
          </TabsContent>

          <TabsContent value="ocr" className="pt-1">
            {panel(
              "ocr",
              "ocr",
              find("ocr"),
              (record) => (
                <TextResult record={record} name={document.name} suffix="text" />
              ),
              "Extract text",
              "extracted text",
            )}
          </TabsContent>

          <TabsContent value="translate" className="space-y-4 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Translate into</span>
              <Select
                value={language}
                onValueChange={(value) => setLanguage(value as typeof language)}
                items={TRANSLATION_LANGUAGES.map((l) => ({ value: l, label: l }))}
              >
                <SelectTrigger className="w-48" aria-label="Target language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSLATION_LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {panel(
              `translate:${language}`,
              "translate",
              find("translate", language),
              (record) => (
                <TextResult
                  record={record}
                  name={document.name}
                  suffix={`translation-${language.toLowerCase().replace(/\W+/g, "-")}`}
                />
              ),
              `Translate to ${language}`,
              `${language} translation`,
            )}
          </TabsContent>

          <TabsContent value="compare" className="space-y-4 pt-1">
            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Upload another document to compare it with this one.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={compareWith}
                  onValueChange={(value) => setCompareWith(value as string)}
                  items={others.map((d) => ({ value: d.id, label: d.name }))}
                >
                  <SelectTrigger className="min-w-56 flex-1" aria-label="Document to compare with">
                    <SelectValue placeholder="Choose a document" />
                  </SelectTrigger>
                  <SelectContent>
                    {others.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!compareWith || !configured || compare.isPending}
                  onClick={async () => {
                    if (!compareWith) return;
                    setError((current) => ({ ...current, compare: "" }));
                    try {
                      setComparison(
                        await compare.mutateAsync({ documentIds: [document.id, compareWith] }),
                      );
                    } catch (caught) {
                      setError((current) => ({
                        ...current,
                        compare:
                          caught instanceof ApiError
                            ? caught.message
                            : "The comparison failed. Try again.",
                      }));
                    }
                  }}
                >
                  {compare.isPending ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <FileSearch data-icon="inline-start" />
                  )}
                  Compare
                </Button>
              </div>
            )}
            {error.compare && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {error.compare}
              </p>
            )}
            {compare.isPending && <Generating label="Comparing documents…" />}
            {comparison && !compare.isPending && <ComparisonResult result={comparison} />}
          </TabsContent>
        </Tabs>

        <AiDisclaimer compact />
      </div>
    </>
  );
}

function ComparisonResult({ result }: { result: DocumentComparisonResult }) {
  const [a, b] = result.documents;
  const text = [
    `# Comparison: ${a?.name} vs ${b?.name}`,
    result.data.summary,
    "",
    "## Similarities",
    ...result.data.similarities.map((s) => `- ${s}`),
    "",
    "## Differences",
    ...result.data.differences.map((d) => `- ${d.topic}: A — ${d.documentA} | B — ${d.documentB}`),
    "",
    "## Conflicts",
    ...(result.data.conflicts.length
      ? result.data.conflicts.map((c) => `- ${c}`)
      : ["- None found"]),
  ].join("\n");
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6">{result.data.summary}</p>
      <Section title="Differences" empty={result.data.differences.length === 0}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Topic
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  A · {a?.name}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  B · {b?.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.data.differences.map((d) => (
                <tr key={d.topic} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium">{d.topic}</td>
                  <td className="px-3 py-2">{d.documentA}</td>
                  <td className="px-3 py-2">{d.documentB}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Similarities" empty={result.data.similarities.length === 0}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {result.data.similarities.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>
      <Section title="Conflicts to resolve" empty={result.data.conflicts.length === 0}>
        <ul className="list-disc space-y-1 pl-5 text-sm marker:text-destructive">
          {result.data.conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Section>
      <GroundingNote grounding={result.grounding} />
      {result.truncated && (
        <p className="text-xs text-warning">
          Long documents: only the first part of each was compared.
        </p>
      )}
      <ResultActions
        onCopy={() => copy(text)}
        onExport={() => saveFile("comparison.md", text, "text/markdown")}
        exportLabel="Export .md"
      />
    </div>
  );
}
