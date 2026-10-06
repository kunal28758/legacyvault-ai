/**
 * Owner-maintained document profile: what a document is and the dates that
 * matter. Stored under `documents.metadata.profile` — the owner's existing
 * Class A metadata write (grant + RLS in 0002) — next to system keys such as
 * `scan`, which a profile update never touches.
 *
 * Every value is set by the owner. A value that started as an AI suggestion is
 * listed in `aiSuggested` until the owner edits it, so the UI can label it; it
 * is never authoritative and the owner can always change it.
 *
 * This module is dependency-free so the browser can use it without pulling in
 * zod; the schema that validates writes lives in lib/validators/document-profile.
 */
export const DOCUMENT_CATEGORIES = [
  "WILL_ESTATE",
  "IDENTITY",
  "PROPERTY",
  "INSURANCE",
  "FINANCIAL",
  "MEDICAL",
  "TAX",
  "BUSINESS",
  "PERSONAL",
  "OTHER",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  WILL_ESTATE: "Will & estate",
  IDENTITY: "Identity",
  PROPERTY: "Property",
  INSURANCE: "Insurance",
  FINANCIAL: "Financial",
  MEDICAL: "Medical",
  TAX: "Tax",
  BUSINESS: "Business",
  PERSONAL: "Personal",
  OTHER: "Other",
};

export type DocumentProfileField = "category" | "expiresOn" | "reviewOn";

export interface DocumentProfile {
  category?: DocumentCategory | null;
  /** When the document stops being valid (passport, policy, lease…), YYYY-MM-DD. */
  expiresOn?: string | null;
  /** A date the owner wants to be reminded to look at it again, YYYY-MM-DD. */
  reviewOn?: string | null;
  /** Fields whose current value came from an AI suggestion the owner accepted. */
  aiSuggested?: DocumentProfileField[];
}

/** Documents within this many days of expiry count as "expiring soon". */
export const EXPIRY_WINDOW_DAYS = 60;

/** Whole days from `now` until an ISO date (negative once it has passed). */
export function daysUntil(isoDay: string, now: number): number {
  const target = Date.parse(`${isoDay}T00:00:00`);
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - start) / 86_400_000);
}

/** Maps an AI-reported document type ("Life insurance policy") to a category, conservatively. */
export function suggestCategory(documentType: string): DocumentCategory | null {
  const type = documentType.toLowerCase();
  const rules: [RegExp, DocumentCategory][] = [
    [/\bwill\b|testament|codicil|estate|probate|power of attorney|trust deed/, "WILL_ESTATE"],
    [
      /passport|aadhaar|identity|\bid card|driving licen[cs]e|pan card|voter|birth certificate/,
      "IDENTITY",
    ],
    [/insurance|policy|assurance/, "INSURANCE"],
    [/deed|property|lease|tenancy|mortgage|title|registry|sale agreement/, "PROPERTY"],
    [/tax|itr|form 16|gst/, "TAX"],
    [/bank|statement|account|investment|share certificate|mutual fund|loan|pension/, "FINANCIAL"],
    [/medical|health|prescription|hospital|vaccination/, "MEDICAL"],
    [/incorporation|partnership|business|company|shareholder/, "BUSINESS"],
  ];
  for (const [pattern, category] of rules) if (pattern.test(type)) return category;
  return null;
}
