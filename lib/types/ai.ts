import type {
  DocumentAnalysisAction,
  DocumentComparison,
  DocumentExtraction,
  DocumentSummary,
} from "@/lib/validators/ai.validators";

/**
 * AI view models shared by the server and the browser (ADR-008, ADR-016).
 *
 * Nothing here ever carries a storage key, a signed URL or a provider key.
 */
export type AIProviderName =
  "openai" | "gemini" | "openrouter" | "groq" | "cerebras" | "huggingface";

export const AI_PROVIDER_LABELS: Record<AIProviderName, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  groq: "Groq",
  cerebras: "Cerebras",
  huggingface: "Hugging Face",
};

export interface AIAvailability {
  configured: boolean;
  provider: AIProviderName | null;
  fallback: AIProviderName | null;
  /** Every fallback, in the order they are tried. */
  fallbacks: AIProviderName[];
}

/** Values the model reported that could not be found in the document text. */
export interface GroundingReport {
  checked: number;
  verified: number;
  unverified: { kind: string; value: string; reason: "not-found" | "unknown-source" }[];
}

/** How the document's text was obtained, so the UI can be honest about it. */
export interface ExtractionInfo {
  method: "plain-text" | "pdf-text" | "office-xml" | "ocr";
  /** Pages, slides or sheets. */
  unitCount: number;
  /** The document was longer than the model's budget and was cut. */
  truncated: boolean;
}

export type DocumentAnalysisPayload =
  | { action: "summary"; data: DocumentSummary }
  | { action: "extract"; data: DocumentExtraction }
  | { action: "explain" | "ocr" | "translate"; data: { text: string } };

export type DocumentAnalysisRecord = DocumentAnalysisPayload & {
  /** The stored version id; a regenerate creates a new one. */
  id: string;
  documentId: string;
  language: string | null;
  grounding: GroundingReport | null;
  extraction: ExtractionInfo;
  provider: AIProviderName;
  model: string;
  createdAt: string;
};

export interface DocumentAnalysisList {
  documentId: string;
  /** The latest stored result per action (and per language for translations). */
  items: DocumentAnalysisRecord[];
}

export interface DocumentComparisonResult {
  documents: { id: string; name: string }[];
  data: DocumentComparison;
  grounding: GroundingReport;
  truncated: boolean;
  provider: AIProviderName;
  model: string;
  createdAt: string;
}

/** Sanitized usage record (ADR-016 § 2): never content. */
export interface AIInteractionSummary {
  id: string;
  sessionType: "ASSISTANT" | "WILL_GENERATOR" | "DOCUMENT_ANALYSIS";
  provider: string;
  model: string | null;
  summary: string | null;
  createdAt: string;
}

/** One line of the NDJSON stream the chat endpoints return. */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean; provider: AIProviderName; model: string }
  | { type: "error"; code: string; message: string };

export type { DocumentAnalysisAction };
