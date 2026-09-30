import { z } from "zod";

/**
 * AI request and output schemas (ADR-008 § 1/§ 4, api-contracts.md § AI).
 *
 * Browser-safe: the chat and document panels validate what they send with the
 * same schemas the routes enforce, and render the same output shapes the
 * server re-validates on receipt from the model.
 */

/* ── Requests ─────────────────────────────────────────────────────────────── */

export const MAX_CHAT_MESSAGE_CHARS = 4_000;
/** Client-held, session-scoped history sent with each message (ADR-016 § 2). */
export const MAX_CHAT_HISTORY_TURNS = 20;
const MAX_HISTORY_TURN_CHARS = 8_000;

const chatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_HISTORY_TURN_CHARS),
});

export const assistantMessageBodySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Type a question first.")
    .max(MAX_CHAT_MESSAGE_CHARS, `Keep questions under ${MAX_CHAT_MESSAGE_CHARS} characters.`),
  history: z.array(chatTurnSchema).max(MAX_CHAT_HISTORY_TURNS).default([]),
});
export type AssistantMessageBody = z.infer<typeof assistantMessageBodySchema>;
export type ChatTurn = z.infer<typeof chatTurnSchema>;

export const DOCUMENT_ANALYSIS_ACTIONS = [
  "summary",
  "extract",
  "explain",
  "ocr",
  "translate",
] as const;
export type DocumentAnalysisAction = (typeof DOCUMENT_ANALYSIS_ACTIONS)[number];

export const TRANSLATION_LANGUAGES = [
  "English",
  "Hindi",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Arabic",
  "Bengali",
  "Chinese (Simplified)",
  "Japanese",
  "Tamil",
  "Telugu",
  "Marathi",
  "Gujarati",
  "Urdu",
] as const;

export const documentAnalyzeBodySchema = z
  .object({
    action: z.enum(DOCUMENT_ANALYSIS_ACTIONS),
    language: z.enum(TRANSLATION_LANGUAGES).optional(),
    /** Ignore a stored result and generate a new version. */
    regenerate: z.boolean().default(false),
  })
  .refine((body) => body.action !== "translate" || body.language, {
    message: "Choose a language to translate into.",
    path: ["language"],
  });
export type DocumentAnalyzeBody = z.infer<typeof documentAnalyzeBodySchema>;

export const documentAskBodySchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Type a question first.")
    .max(2_000, "Keep questions under 2,000 characters."),
  history: z.array(chatTurnSchema).max(10).default([]),
});
export type DocumentAskBody = z.infer<typeof documentAskBodySchema>;

export const documentCompareBodySchema = z
  .object({
    documentIds: z.tuple([z.uuid("Unknown document."), z.uuid("Unknown document.")]),
  })
  .refine((body) => body.documentIds[0] !== body.documentIds[1], {
    message: "Choose two different documents.",
    path: ["documentIds"],
  });
export type DocumentCompareBody = z.infer<typeof documentCompareBodySchema>;

export const documentIdParamSchema = z.object({ id: z.uuid("Unknown document.") });

/* ── Model outputs ────────────────────────────────────────────────────────── */

const sourced = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, source: z.string().describe("Section label, e.g. Page 2") });

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const documentSummarySchema = z.object({
  documentType: z.string(),
  executiveSummary: z.string(),
  detailedSummary: z.string(),
  keyPoints: z.array(z.string()),
  importantDates: z.array(sourced({ date: z.string(), description: z.string() })),
  importantAmounts: z.array(sourced({ amount: z.string(), description: z.string() })),
  people: z.array(sourced({ name: z.string(), role: z.string() })),
  organizations: z.array(sourced({ name: z.string(), role: z.string() })),
  clauses: z.array(sourced({ title: z.string(), summary: z.string() })),
  missingInformation: z.array(z.string()),
  confidence: confidenceSchema,
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const documentExtractionSchema = z.object({
  documentType: z.string(),
  fields: z.array(sourced({ label: z.string(), value: z.string() })),
  referenceNumbers: z.array(sourced({ label: z.string(), value: z.string() })),
  names: z.array(sourced({ name: z.string(), role: z.string() })),
  dates: z.array(sourced({ date: z.string(), description: z.string() })),
  amounts: z.array(sourced({ amount: z.string(), description: z.string() })),
  confidence: confidenceSchema,
});
export type DocumentExtraction = z.infer<typeof documentExtractionSchema>;

export const documentComparisonSchema = z.object({
  summary: z.string(),
  similarities: z.array(z.string()),
  differences: z.array(
    z.object({ topic: z.string(), documentA: z.string(), documentB: z.string() }),
  ),
  conflicts: z.array(z.string()),
  confidence: confidenceSchema,
});
export type DocumentComparison = z.infer<typeof documentComparisonSchema>;
