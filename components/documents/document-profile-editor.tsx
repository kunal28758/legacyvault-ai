"use client";

import { useState } from "react";
import { CalendarClock, Sparkles, Tag } from "lucide-react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDocumentAnalyses } from "@/hooks/use-ai";
import { useUpdateDocumentProfile } from "@/hooks/use-documents";
import { ApiError } from "@/lib/client/api-client";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  suggestCategory,
  type DocumentCategory,
  type DocumentProfile,
} from "@/lib/types/document-profile";
import type { DocumentSummary } from "@/lib/types/document";
import { cn } from "@/lib/utils";

type Field = "category" | "expiresOn" | "reviewOn";

/** Marks a value that came from an AI suggestion until the owner edits it. */
function AiTag({ show }: { show: boolean }) {
  return show ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-normal text-brand-purple">
      <Sparkles className="size-3" aria-hidden /> AI-suggested · confirm or correct
    </span>
  ) : null;
}

/** "12 March 2030" → "2030-03-12"; null when the text is not a date. */
function toIsoDay(text: string): string | null {
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The owner's category and dates for one document. Suggestions come only from
 * an AI summary already stored for this document (no new AI call) and are
 * applied only when the owner chooses to; applied values stay labelled until
 * the owner edits them, and every value can be corrected or cleared.
 */
export function DocumentProfileEditor({ document }: { document: DocumentSummary }) {
  const update = useUpdateDocumentProfile();
  const analyses = useDocumentAnalyses(document.id);
  const initial = document.profile ?? {};
  const [category, setCategory] = useState<DocumentCategory | "">(initial.category ?? "");
  const [expiresOn, setExpiresOn] = useState(initial.expiresOn ?? "");
  const [reviewOn, setReviewOn] = useState(initial.reviewOn ?? "");
  const [ai, setAi] = useState<Set<Field>>(new Set(initial.aiSuggested ?? []));

  const summary = analyses.data?.items.find((item) => item.action === "summary");
  const summaryData = summary?.action === "summary" ? summary.data : null;
  const suggestedCategory = summaryData ? suggestCategory(summaryData.documentType) : null;
  const suggestedDates = (summaryData?.importantDates ?? [])
    .map((entry) => ({ ...entry, iso: toIsoDay(entry.date) }))
    .filter((entry): entry is typeof entry & { iso: string } => Boolean(entry.iso))
    .slice(0, 4);

  const edited = (field: Field) =>
    setAi((current) => {
      const next = new Set(current);
      next.delete(field);
      return next;
    });
  const applied = (field: Field) => setAi((current) => new Set(current).add(field));

  const dirty =
    (category || null) !== (initial.category ?? null) ||
    (expiresOn || null) !== (initial.expiresOn ?? null) ||
    (reviewOn || null) !== (initial.reviewOn ?? null);

  const save = async () => {
    const profile: DocumentProfile = {
      category: category || null,
      expiresOn: expiresOn || null,
      reviewOn: reviewOn || null,
      aiSuggested: [...ai],
    };
    try {
      await update.mutateAsync({ id: document.id, profile });
      toast.success("Document details saved");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save these details.");
    }
  };

  return (
    <section
      aria-labelledby="doc-profile"
      className="space-y-4 rounded-xl border border-border bg-surface/40 p-4"
    >
      <div className="space-y-0.5">
        <h3 id="doc-profile" className="flex items-center gap-2 text-sm font-semibold">
          <Tag className="size-4 text-primary" aria-hidden /> Category & dates
        </h3>
        <p className="text-xs text-muted-foreground">
          Used to show what is missing and to remind you before it expires. Only you see these.
        </p>
      </div>

      <FormField label="Category" optional hint={<AiTag show={ai.has("category")} />}>
        {(fieldProps) => (
          <Select
            value={category || "none"}
            onValueChange={(value) => {
              setCategory(value === "none" ? "" : (value as DocumentCategory));
              edited("category");
            }}
            items={[
              { value: "none", label: "No category" },
              ...DOCUMENT_CATEGORIES.map((value) => ({
                value,
                label: DOCUMENT_CATEGORY_LABELS[value],
              })),
            ]}
          >
            <SelectTrigger id={fieldProps.id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No category</SelectItem>
              {DOCUMENT_CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {DOCUMENT_CATEGORY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Expires on" optional hint={<AiTag show={ai.has("expiresOn")} />}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={expiresOn}
              onChange={(event) => {
                setExpiresOn(event.target.value);
                edited("expiresOn");
              }}
            />
          )}
        </FormField>
        <FormField label="Review on" optional hint={<AiTag show={ai.has("reviewOn")} />}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              value={reviewOn}
              onChange={(event) => {
                setReviewOn(event.target.value);
                edited("reviewOn");
              }}
            />
          )}
        </FormField>
      </div>

      {summaryData && (suggestedCategory || suggestedDates.length > 0) && (
        <div className="space-y-2 rounded-lg border border-brand-purple/25 bg-brand-purple/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-brand-purple">
            <Sparkles className="size-3.5" aria-hidden />
            AI suggestions from your saved summary — not legally authoritative
          </p>
          <ul className="space-y-1.5 text-xs">
            {suggestedCategory && suggestedCategory !== category && (
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Looks like “{summaryData.documentType}” →{" "}
                  <strong>{DOCUMENT_CATEGORY_LABELS[suggestedCategory]}</strong>
                </span>
                <Button
                  size="xs"
                  variant="ai"
                  onClick={() => {
                    setCategory(suggestedCategory);
                    applied("category");
                  }}
                >
                  Use category
                </Button>
              </li>
            )}
            {suggestedDates.map((entry) => (
              <li
                key={`${entry.iso}-${entry.description}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <CalendarClock className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">
                    {entry.description}: {entry.date}
                  </span>
                </span>
                <span className="flex gap-1">
                  <Button
                    size="xs"
                    variant="ai"
                    onClick={() => {
                      setExpiresOn(entry.iso);
                      applied("expiresOn");
                    }}
                  >
                    As expiry
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setReviewOn(entry.iso);
                      applied("reviewOn");
                    }}
                  >
                    As review
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={cn("flex items-center justify-end gap-2", !dirty && "opacity-80")}>
        <Button size="sm" disabled={!dirty} loading={update.isPending} onClick={() => void save()}>
          Save details
        </Button>
      </div>
    </section>
  );
}
