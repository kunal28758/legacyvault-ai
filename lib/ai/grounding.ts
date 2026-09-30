import "server-only";

import type { ExtractedSection } from "@/lib/ai/documents/extract-text";
import type {
  DocumentComparison,
  DocumentExtraction,
  DocumentSummary,
} from "@/lib/validators/ai.validators";
import type { GroundingReport } from "@/lib/types/ai";

/**
 * Grounding checks (ADR-008 § 3: unsupported-claim and fabricated-reference
 * heuristics).
 *
 * A model can be told to quote only what the document says; this checks that
 * it did. Every value that is supposed to be copied from the document — a
 * date, an amount, a name, a reference number — is looked for in the
 * document's own text, and every cited section label must exist. Values that
 * cannot be found are reported, not silently dropped, so the owner sees
 * exactly which ones to double-check.
 *
 * Pure and dependency-free so it runs identically in tests.
 */

/** Letters and digits only, lower-cased: tolerant of spacing and punctuation. */
export function comparable(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export interface DocumentCorpus {
  text: string;
  labels: Set<string>;
}

export function corpusOf(sections: ExtractedSection[] | string): DocumentCorpus {
  if (typeof sections === "string") return { text: comparable(sections), labels: new Set() };
  return {
    text: comparable(sections.map((section) => section.text).join("\n")),
    labels: new Set(sections.map((section) => section.label.toLowerCase())),
  };
}

export function appearsIn(value: string, corpus: DocumentCorpus): boolean {
  const needle = comparable(value);
  // Nothing checkable (e.g. "—"): not a claim about the document.
  if (needle.length === 0) return true;
  return corpus.text.includes(needle);
}

/** "Page 2", "page 2, Page 3", "Slide 1" — every cited label must exist. */
export function sourceExists(source: string, corpus: DocumentCorpus): boolean {
  if (corpus.labels.size === 0) return true;
  const cited = source
    .split(/[,;]| and /)
    .map((part) => part.replace(/[()]/g, "").trim().toLowerCase())
    .filter(Boolean);
  if (cited.length === 0) return false;
  return cited.every(
    (label) => corpus.labels.has(label) || [...corpus.labels].some((l) => label.startsWith(l)),
  );
}

interface Claim {
  value: string;
  source?: string;
  kind: string;
}

function report(claims: Claim[], corpus: DocumentCorpus): GroundingReport {
  const unverified: GroundingReport["unverified"] = [];
  for (const claim of claims) {
    const found = appearsIn(claim.value, corpus);
    const cited = claim.source === undefined || sourceExists(claim.source, corpus);
    if (!found || !cited) {
      unverified.push({
        kind: claim.kind,
        value: claim.value,
        reason: !found ? "not-found" : "unknown-source",
      });
    }
  }
  return { checked: claims.length, verified: claims.length - unverified.length, unverified };
}

export function groundSummary(summary: DocumentSummary, corpus: DocumentCorpus): GroundingReport {
  return report(
    [
      ...summary.importantDates.map((d) => ({ value: d.date, source: d.source, kind: "date" })),
      ...summary.importantAmounts.map((a) => ({
        value: a.amount,
        source: a.source,
        kind: "amount",
      })),
      ...summary.people.map((p) => ({ value: p.name, source: p.source, kind: "person" })),
      ...summary.organizations.map((o) => ({
        value: o.name,
        source: o.source,
        kind: "organization",
      })),
    ],
    corpus,
  );
}

export function groundExtraction(
  extraction: DocumentExtraction,
  corpus: DocumentCorpus,
): GroundingReport {
  return report(
    [
      ...extraction.fields.map((f) => ({ value: f.value, source: f.source, kind: f.label })),
      ...extraction.referenceNumbers.map((r) => ({
        value: r.value,
        source: r.source,
        kind: r.label,
      })),
      ...extraction.names.map((n) => ({ value: n.name, source: n.source, kind: "name" })),
      ...extraction.dates.map((d) => ({ value: d.date, source: d.source, kind: "date" })),
      ...extraction.amounts.map((a) => ({ value: a.amount, source: a.source, kind: "amount" })),
    ],
    corpus,
  );
}

/** Each side of a difference is checked against its own document. */
export function groundComparison(
  comparison: DocumentComparison,
  a: DocumentCorpus,
  b: DocumentCorpus,
): GroundingReport {
  const quoted = (text: string) => [...text.matchAll(/"([^"]{3,})"/g)].map((m) => m[1] ?? "");
  const claimsA = comparison.differences.flatMap((d) =>
    quoted(d.documentA).map((value) => ({ value, kind: `A: ${d.topic}` })),
  );
  const claimsB = comparison.differences.flatMap((d) =>
    quoted(d.documentB).map((value) => ({ value, kind: `B: ${d.topic}` })),
  );
  const ra = report(claimsA, a);
  const rb = report(claimsB, b);
  return {
    checked: ra.checked + rb.checked,
    verified: ra.verified + rb.verified,
    unverified: [...ra.unverified, ...rb.unverified],
  };
}

/**
 * Wraps document text for a prompt: labelled sections inside `<document>`
 * delimiters, within a character budget. A literal closing tag inside the
 * document is defused so the document cannot "end itself" and smuggle in
 * instructions after it.
 */
export function documentBlock(
  sections: ExtractedSection[],
  maxChars: number,
  id?: string,
): { block: string; truncated: boolean; includedChars: number } {
  let used = 0;
  let truncated = false;
  const parts: string[] = [];
  for (const section of sections) {
    const safe = section.text.replace(/<\/?\s*document/gi, (match) => match.replace("<", "‹"));
    const header = `[${section.label}]\n`;
    const remaining = maxChars - used - header.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const text = safe.length > remaining ? safe.slice(0, remaining) : safe;
    if (text.length < safe.length) truncated = true;
    parts.push(header + text);
    used += header.length + text.length;
    if (truncated) break;
  }
  const open = id ? `<document id="${id}">` : "<document>";
  return { block: `${open}\n${parts.join("\n\n")}\n</document>`, truncated, includedChars: used };
}
