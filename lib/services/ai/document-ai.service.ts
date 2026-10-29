import "server-only";

import { getAIConfiguration, getAIProvider } from "@/lib/ai";
import {
  OCR_MIME_TYPES,
  extractDocumentText,
  type ExtractedSection,
} from "@/lib/ai/documents/extract-text";
import {
  corpusOf,
  documentBlock,
  groundComparison,
  groundExtraction,
  groundSummary,
} from "@/lib/ai/grounding";
import {
  COMPARE_INSTRUCTIONS,
  DOCUMENT_SYSTEM,
  EXPLAIN_INSTRUCTIONS,
  EXTRACT_INSTRUCTIONS,
  OCR_INSTRUCTIONS,
  PROMPT_VERSIONS,
  SUMMARY_INSTRUCTIONS,
  translateInstructions,
} from "@/lib/ai/prompts";
import type { AIContentPart, AIMessage, AIStream, AIUsage } from "@/lib/ai/provider";
import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createServiceClient, createUserClient, type TypedSupabaseClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";
import * as aiRepository from "@/lib/repositories/ai.repository";
import * as documentRepository from "@/lib/repositories/document.repository";
import { decrypt, encrypt, isEncryptionEnvelope } from "@/lib/security/encryption";
import { readObject, type BucketName } from "@/lib/storage/storage";
import type {
  DocumentAnalysisList,
  DocumentAnalysisPayload,
  DocumentAnalysisRecord,
  DocumentComparisonResult,
  ExtractionInfo,
  GroundingReport,
} from "@/lib/types/ai";
import type { Json } from "@/lib/types/database";
import { MAX_DOCUMENT_BYTES } from "@/lib/uploads/file-types";
import {
  AI_READABLE_MIME_TYPES,
  MAX_AI_INLINE_BYTES,
  documentComparisonSchema,
  documentExtractionSchema,
  documentSummarySchema,
  type DocumentAnalyzeBody,
  type DocumentAskBody,
} from "@/lib/validators/ai.validators";

import { toAIApiError } from "./errors";

/**
 * Document intelligence (ADR-008 § 5, ADR-016).
 *
 * Every entry point starts the same way: the document row is read through RLS
 * as the caller, so a document that is not theirs — or is deleted — is a 404
 * before a single byte is fetched. Only then is the object read, server-side,
 * from private storage.
 *
 * Results are grounded (values checked against the document's own text),
 * stored as encrypted AI versions so reopening a summary costs nothing, and
 * recorded in `ai_interactions` without content. Questions and answers are
 * never stored.
 */

/** Characters of document text sent to the model (~40k tokens). */
const MAX_DOCUMENT_CHARS = 150_000;
/** Inline file limit for OCR requests to the provider. */
const MAX_OCR_BYTES = MAX_AI_INLINE_BYTES;

interface LoadedDocument {
  id: string;
  name: string;
  mimeType: string;
  versionId: string | null;
  sections: ExtractedSection[];
  info: Omit<ExtractionInfo, "truncated">;
}

/* ── Extraction cache ─────────────────────────────────────────────────────── */

/**
 * Follow-up questions about the same document should not re-download and
 * re-OCR it. Held in this server instance's memory only, keyed by owner and
 * document version, for ten minutes; never persisted.
 */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 16;
const extractionCache = new Map<string, { at: number; value: LoadedDocument }>();

function cacheGet(key: string): LoadedDocument | null {
  const hit = extractionCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    extractionCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, value: LoadedDocument): void {
  extractionCache.set(key, { at: Date.now(), value });
  while (extractionCache.size > CACHE_MAX_ENTRIES) {
    const oldest = extractionCache.keys().next().value;
    if (oldest === undefined) break;
    extractionCache.delete(oldest);
  }
}

/** For tests. */
export function clearExtractionCache(): void {
  extractionCache.clear();
}

/* ── Loading ──────────────────────────────────────────────────────────────── */

async function findOwnedDocument(db: TypedSupabaseClient, user: AppUser, documentId: string) {
  const row = await documentRepository.findById(db, user.id, documentId);
  if (!row) throw ApiError.notFound();
  return row;
}

/** Splits OCR output on its "[Page N]" markers into labelled sections. */
export function sectionsFromOcr(text: string): ExtractedSection[] {
  const parts = text.split(/^\s*\[Page (\d+)\]\s*$/m);
  if (parts.length < 3) return text.trim() ? [{ label: "Page 1", text: text.trim() }] : [];
  const sections: ExtractedSection[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const body = (parts[index + 1] ?? "").trim();
    if (body) sections.push({ label: `Page ${parts[index]}`, text: body });
  }
  return sections;
}

async function ocr(
  user: AppUser,
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
  signal?: AbortSignal,
): Promise<ExtractedSection[]> {
  if (!OCR_MIME_TYPES.has(mimeType)) {
    throw ApiError.invariant(
      "FILE_TYPE_MISMATCH",
      "The AI cannot read this file type. Save it as PDF or DOCX and upload it again.",
    );
  }
  if (bytes.byteLength > MAX_OCR_BYTES) {
    throw ApiError.invariant(
      "FILE_TOO_LARGE",
      "This scanned file is too large for text recognition (20 MB maximum).",
    );
  }
  const provider = getAIProvider();
  const result = await provider.generateText({
    system: DOCUMENT_SYSTEM,
    containsDocuments: true,
    messages: [
      {
        role: "user",
        content: [
          { kind: "text", text: OCR_INSTRUCTIONS },
          { kind: "file", mimeType, data: bytes, filename },
        ],
      },
    ],
    maxOutputTokens: 16_000,
    signal,
  });
  await recordInteraction(user, {
    provider: result.provider,
    model: result.model,
    promptVersion: PROMPT_VERSIONS.documentOcr,
    inputSummary: `ocr · ${mimeType} · ${bytes.byteLength} bytes`,
    outputSummary: `ocr · ${result.text.length} chars${result.truncated ? " · truncated" : ""}`,
    usage: result.usage,
  });
  const text = result.text.trim();
  if (!text || text === "[no readable text]") return [];
  return sectionsFromOcr(text);
}

async function loadDocument(
  user: AppUser,
  documentId: string,
  signal?: AbortSignal,
): Promise<LoadedDocument> {
  const db = await createUserClient();
  const row = await findOwnedDocument(db, user, documentId);

  const key = `${user.id}:${row.id}:${row.current_version_id ?? row.storage_key}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const bytes = await readObject(row.storage_bucket as BucketName, row.storage_key, {
    maxBytes: MAX_DOCUMENT_BYTES,
  });

  let extracted;
  try {
    extracted = await extractDocumentText(bytes, row.mime_type);
  } catch (cause) {
    logger.warn({ err: cause, documentId }, "document text extraction failed");
    throw ApiError.invariant(
      "FILE_TYPE_MISMATCH",
      "The document's text could not be read. It may be damaged or password-protected.",
    );
  }

  let sections = extracted.sections;
  let method: ExtractionInfo["method"];
  if (extracted.method === "unsupported") {
    throw ApiError.invariant(
      "FILE_TYPE_MISMATCH",
      "The AI cannot read this file type yet. Save it as PDF, DOCX, XLSX or PPTX and upload it again.",
    );
  } else if (extracted.method === "needs-ocr") {
    sections = await ocr(user, bytes, row.mime_type, row.name, signal);
    method = "ocr";
  } else {
    method = extracted.method;
  }

  if (sections.every((section) => !section.text.trim())) {
    throw ApiError.invariant("FILE_TYPE_MISMATCH", "No readable text was found in this document.");
  }

  const loaded: LoadedDocument = {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    versionId: row.current_version_id,
    sections,
    info: { method, unitCount: extracted.unitCount || sections.length },
  };
  cacheSet(key, loaded);
  return loaded;
}

/* ── Records ──────────────────────────────────────────────────────────────── */

async function recordInteraction(
  user: AppUser,
  input: {
    provider: string;
    model: string;
    promptVersion: string;
    inputSummary: string;
    outputSummary: string;
    usage: AIUsage;
    draftId?: string | null;
    validation?: Json;
  },
): Promise<string | null> {
  try {
    return await aiRepository.insertInteraction(createServiceClient(), {
      userId: user.id,
      sessionType: "DOCUMENT_ANALYSIS",
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      draftId: input.draftId ?? null,
      inputSummary: input.inputSummary,
      outputSummary: input.outputSummary,
      validation: input.validation ?? null,
      tokenCount:
        input.usage.inputTokens === null && input.usage.outputTokens === null
          ? null
          : (input.usage.inputTokens ?? 0) + (input.usage.outputTokens ?? 0),
    });
  } catch (cause) {
    // The usage record must never cost the user their answer.
    logger.error({ err: cause }, "failed to record AI interaction");
    return null;
  }
}

interface StoredAnalysis {
  payload: DocumentAnalysisPayload;
  language: string | null;
  grounding: GroundingReport | null;
  extraction: ExtractionInfo;
  documentVersionId: string | null;
}

function toRecord(
  version: aiRepository.DraftVersionRow,
  documentId: string,
  stored: StoredAnalysis,
): DocumentAnalysisRecord {
  return {
    ...stored.payload,
    id: version.id,
    documentId,
    language: stored.language,
    grounding: stored.grounding,
    extraction: stored.extraction,
    provider: (version.provider ?? "openai") as DocumentAnalysisRecord["provider"],
    model: version.model ?? "",
    createdAt: version.created_at,
  };
}

function readStored(version: aiRepository.DraftVersionRow): StoredAnalysis | null {
  if (!isEncryptionEnvelope(version.content)) return null;
  try {
    return JSON.parse(decrypt(version.content)) as StoredAnalysis;
  } catch (cause) {
    logger.error(
      { err: cause, versionId: version.id },
      "stored AI analysis could not be decrypted",
    );
    return null;
  }
}

/* ── Public API ───────────────────────────────────────────────────────────── */

export function getAvailability() {
  const configuration = getAIConfiguration();
  return {
    configured: configuration.configured,
    provider: configuration.primary,
    fallback: configuration.fallback,
    fallbacks: configuration.fallbacks,
  };
}

/** The latest stored result per action for the document's current version. */
export async function listAnalyses(
  user: AppUser,
  documentId: string,
): Promise<DocumentAnalysisList> {
  const db = await createUserClient();
  const row = await documentRepository.findById(db, user.id, documentId);
  if (!row) throw ApiError.notFound();

  const draftId = await aiRepository.findAnalysisDraftId(db, user.id, documentId);
  if (!draftId) return { documentId, items: [] };

  const versions = await aiRepository.listVersions(db, draftId, 40);
  const seen = new Set<string>();
  const items: DocumentAnalysisRecord[] = [];
  for (const version of versions) {
    const stored = readStored(version);
    if (!stored || stored.documentVersionId !== row.current_version_id) continue;
    const slot = `${stored.payload.action}:${stored.language ?? ""}`;
    if (seen.has(slot)) continue;
    seen.add(slot);
    items.push(toRecord(version, documentId, stored));
  }
  return { documentId, items };
}

export async function analyzeDocument(
  user: AppUser,
  documentId: string,
  body: DocumentAnalyzeBody,
  correlationId: string,
  signal?: AbortSignal,
): Promise<DocumentAnalysisRecord> {
  assertAccountActive(user);

  if (!body.regenerate) {
    const existing = await listAnalyses(user, documentId);
    const hit = existing.items.find(
      (item) => item.action === body.action && (item.language ?? null) === (body.language ?? null),
    );
    if (hit) return hit;
  }

  try {
    const document = await loadDocument(user, documentId, signal);
    const { block, truncated } = documentBlock(document.sections, MAX_DOCUMENT_CHARS);
    const extraction: ExtractionInfo = { ...document.info, truncated };
    const draftLookupDb = await createUserClient();
    const existingDraftId = await aiRepository.findAnalysisDraftId(
      draftLookupDb,
      user.id,
      documentId,
    );

    const corpus = corpusOf(document.sections);
    const provider = getAIProvider();
    const messages = (instructions: string): AIMessage[] => [
      { role: "user", content: `${block}\n\n${instructions}` },
    ];

    let payload: DocumentAnalysisPayload;
    let grounding: GroundingReport | null = null;
    let usage: AIUsage;
    let modelInfo: { provider: DocumentAnalysisRecord["provider"]; model: string };
    let promptVersion: string;
    let outputSummary: string;

    switch (body.action) {
      case "summary": {
        const result = await provider.generateStructured({
          system: DOCUMENT_SYSTEM,
          containsDocuments: true,
          messages: messages(SUMMARY_INSTRUCTIONS),
          schema: documentSummarySchema,
          schemaName: "document_summary",
          maxOutputTokens: 4_000,
          signal,
        });
        grounding = groundSummary(result.data, corpus);
        payload = { action: "summary", data: result.data };
        usage = result.usage;
        modelInfo = result;
        promptVersion = PROMPT_VERSIONS.documentSummary;
        outputSummary = `summary · ${result.data.importantDates.length} dates · ${result.data.importantAmounts.length} amounts · ${grounding.unverified.length} unverified`;
        break;
      }
      case "extract": {
        const result = await provider.generateStructured({
          system: DOCUMENT_SYSTEM,
          containsDocuments: true,
          messages: messages(EXTRACT_INSTRUCTIONS),
          schema: documentExtractionSchema,
          schemaName: "document_extraction",
          maxOutputTokens: 4_000,
          signal,
        });
        grounding = groundExtraction(result.data, corpus);
        payload = { action: "extract", data: result.data };
        usage = result.usage;
        modelInfo = result;
        promptVersion = PROMPT_VERSIONS.documentExtract;
        outputSummary = `extract · ${result.data.fields.length} fields · ${grounding.unverified.length} unverified`;
        break;
      }
      case "ocr": {
        // The text is already in hand: extracted from the file, or recognised
        // from a scan while loading. Nothing more is asked of the model.
        payload = {
          action: "ocr",
          data: {
            text: document.sections.map((s) => `[${s.label}]\n${s.text}`).join("\n\n"),
          },
        };
        usage = { inputTokens: null, outputTokens: null };
        modelInfo = { provider: provider.name, model: provider.model };
        promptVersion = PROMPT_VERSIONS.documentOcr;
        outputSummary = `text · ${document.info.method}`;
        break;
      }
      default: {
        const isTranslation = body.action === "translate";
        const result = await provider.generateText({
          system: DOCUMENT_SYSTEM,
          containsDocuments: true,
          messages: messages(
            isTranslation
              ? translateInstructions(body.language ?? "English")
              : EXPLAIN_INSTRUCTIONS,
          ),
          maxOutputTokens: isTranslation ? 12_000 : 2_000,
          signal,
        });
        payload = { action: body.action, data: { text: result.text.trim() } };
        usage = result.usage;
        modelInfo = result;
        promptVersion = isTranslation
          ? PROMPT_VERSIONS.documentTranslate
          : PROMPT_VERSIONS.documentExplain;
        outputSummary = `${body.action} · ${result.text.length} chars${result.truncated ? " · truncated" : ""}`;
        if (result.truncated) extraction.truncated = true;
      }
    }

    // Persist as an encrypted AI version (ADR-016): reopening costs nothing,
    // regenerating adds a version, and nothing is readable at rest.
    const service = createServiceClient();
    const draftId =
      existingDraftId ?? (await aiRepository.createAnalysisDraft(service, user.id, documentId));

    const interactionId = await recordInteraction(user, {
      provider: modelInfo.provider,
      model: modelInfo.model,
      promptVersion,
      inputSummary: `${body.action} · ${document.info.method} · ${document.info.unitCount} units${truncated ? " · truncated" : ""}`,
      outputSummary,
      usage,
      draftId,
      validation: grounding ? { checked: grounding.checked, verified: grounding.verified } : null,
    });

    const stored: StoredAnalysis = {
      payload,
      language: body.action === "translate" ? (body.language ?? null) : null,
      grounding,
      extraction,
      documentVersionId: document.versionId,
    };
    const version = await aiRepository.appendVersion(service, {
      draftId,
      content: encrypt(JSON.stringify(stored)) as unknown as Json,
      provider: modelInfo.provider,
      model: modelInfo.model,
      promptVersion,
      interactionId,
      sectionConfidence:
        payload.action === "summary" || payload.action === "extract"
          ? { overall: payload.data.confidence }
          : null,
    });

    await audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: "ai.document_analyzed",
      resourceType: "document",
      resourceId: documentId,
      outcome: "SUCCESS",
      metadata: { action: body.action, provider: modelInfo.provider, method: document.info.method },
      correlationId,
    });

    return toRecord(version, documentId, stored);
  } catch (error) {
    throw toAIApiError(error);
  }
}

/**
 * A grounded, streamed answer to one question about one document. Neither the
 * question nor the answer is stored; the usage record says only that a
 * question was asked.
 */
export async function askDocument(
  user: AppUser,
  documentId: string,
  body: DocumentAskBody,
  signal?: AbortSignal,
): Promise<{
  stream: AIStream;
  truncated: boolean;
  onComplete: (usage: AIUsage) => Promise<void>;
}> {
  assertAccountActive(user);
  try {
    const document = await loadDocument(user, documentId, signal);
    const { block, truncated } = documentBlock(document.sections, MAX_DOCUMENT_CHARS);
    const provider = getAIProvider();
    const stream = await provider.stream({
      system: DOCUMENT_SYSTEM,
      containsDocuments: true,
      messages: [
        ...body.history.map((turn) => ({ role: turn.role, content: turn.content })),
        {
          role: "user",
          content: `${block}\n\nQuestion about the document above: ${body.question}`,
        },
      ],
      maxOutputTokens: 1_500,
      signal,
    });
    return {
      stream,
      truncated,
      onComplete: async (usage) => {
        await recordInteraction(user, {
          provider: stream.provider,
          model: stream.model,
          promptVersion: PROMPT_VERSIONS.documentAsk,
          inputSummary: `question · ${document.info.method} · ${body.history.length} prior turns`,
          outputSummary: "answer streamed",
          usage,
        });
      },
    };
  } catch (error) {
    throw toAIApiError(error);
  }
}

/* ── Assistant attachments ────────────────────────────────────────────────── */

export interface AssistantAttachments {
  /** Content for the user's message: document blocks as text, images inline. */
  parts: AIContentPart[];
  /** Per attachment, how it was read ("pdf-text", "ocr", "image"…) — no names. */
  methods: string[];
  documentIds: string[];
  truncated: boolean;
}

/**
 * Files the user attached to an assistant message (ADR-008 § 5).
 *
 * Every id is treated as untrusted: each one is looked up through RLS as the
 * caller, so another user's document or a deleted one is refused before a
 * single byte is read — exactly as for document intelligence. Text-bearing files are read through the same
 * extraction (and OCR) path, cache included; an image is sent to the model as
 * the image itself, so a photo without text can still be described.
 *
 * Only what the question needs leaves the server: the attachments' text or
 * pixels and their file names. Nothing here is stored or logged.
 */
export async function loadAssistantAttachments(
  user: AppUser,
  documentIds: string[],
  signal?: AbortSignal,
): Promise<AssistantAttachments> {
  if (documentIds.length === 0)
    return { parts: [], methods: [], documentIds: [], truncated: false };

  const db = await createUserClient();
  const rows = [];
  for (const id of documentIds) {
    const row = await findOwnedDocument(db, user, id);
    if (!AI_READABLE_MIME_TYPES.has(row.mime_type)) {
      throw ApiError.invariant(
        "FILE_TYPE_MISMATCH",
        `The AI can't read “${row.name}”. Attach a PDF, Word, Excel, PowerPoint, text, CSV or image file.`,
      );
    }
    rows.push(row);
  }

  const images = rows.filter((row) => row.mime_type.startsWith("image/"));
  const imageBytes = images.reduce((sum, row) => sum + row.size_bytes, 0);
  if (imageBytes > MAX_AI_INLINE_BYTES) {
    throw ApiError.invariant(
      "FILE_TOO_LARGE",
      "The attached images are too large for the AI together (20 MB in total). Attach fewer or smaller images.",
    );
  }

  const textual = rows.length - images.length;
  const budget = textual > 0 ? Math.floor(MAX_DOCUMENT_CHARS / textual) : 0;
  const parts: AIContentPart[] = [];
  const methods: string[] = [];
  let truncated = false;

  for (const [index, row] of rows.entries()) {
    const number = index + 1;
    if (row.mime_type.startsWith("image/")) {
      const bytes = await readObject(row.storage_bucket as BucketName, row.storage_key, {
        maxBytes: MAX_AI_INLINE_BYTES,
      });
      parts.push(
        { kind: "text", text: `Attachment ${number}: “${row.name}” (image, shown below).` },
        { kind: "file", mimeType: row.mime_type, data: bytes, filename: row.name },
      );
      methods.push("image");
      continue;
    }

    const document = await loadDocument(user, row.id, signal);
    const block = documentBlock(document.sections, budget, String(number));
    truncated ||= block.truncated;
    const units = `${document.info.unitCount} ${document.info.unitCount === 1 ? "section" : "sections"}`;
    parts.push({
      kind: "text",
      text: `Attachment ${number}: “${document.name}” (${units}${block.truncated ? ", shortened to fit" : ""}).\n${block.block}`,
    });
    methods.push(document.info.method);
  }

  return { parts, methods, documentIds: rows.map((row) => row.id), truncated };
}

export async function compareDocuments(
  user: AppUser,
  documentIds: [string, string],
  correlationId: string,
  signal?: AbortSignal,
): Promise<DocumentComparisonResult> {
  assertAccountActive(user);
  try {
    const [a, b] = await Promise.all([
      loadDocument(user, documentIds[0], signal),
      loadDocument(user, documentIds[1], signal),
    ]);
    const half = Math.floor(MAX_DOCUMENT_CHARS / 2);
    const blockA = documentBlock(a.sections, half, "A");
    const blockB = documentBlock(b.sections, half, "B");
    const provider = getAIProvider();
    const result = await provider.generateStructured({
      system: DOCUMENT_SYSTEM,
      containsDocuments: true,
      messages: [
        {
          role: "user",
          content: `${blockA.block}\n\n${blockB.block}\n\nDocument A is "${a.name}". Document B is "${b.name}".\n\n${COMPARE_INSTRUCTIONS}`,
        },
      ],
      schema: documentComparisonSchema,
      schemaName: "document_comparison",
      maxOutputTokens: 4_000,
      signal,
    });
    const grounding = groundComparison(result.data, corpusOf(a.sections), corpusOf(b.sections));

    await recordInteraction(user, {
      provider: result.provider,
      model: result.model,
      promptVersion: PROMPT_VERSIONS.documentCompare,
      inputSummary: `compare · ${a.info.method} + ${b.info.method}`,
      outputSummary: `${result.data.differences.length} differences · ${result.data.conflicts.length} conflicts`,
      usage: result.usage,
      validation: { checked: grounding.checked, verified: grounding.verified },
    });
    await audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: "ai.documents_compared",
      resourceType: "document",
      resourceId: a.id,
      outcome: "SUCCESS",
      metadata: { otherDocumentId: b.id, provider: result.provider },
      correlationId,
    });

    return {
      documents: [
        { id: a.id, name: a.name },
        { id: b.id, name: b.name },
      ],
      data: result.data,
      grounding,
      truncated: blockA.truncated || blockB.truncated,
      provider: result.provider,
      model: result.model,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    throw toAIApiError(error);
  }
}
