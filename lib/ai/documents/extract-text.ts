import "server-only";

import { unzipSync } from "fflate";

/**
 * Text extraction for document intelligence (ADR-008 § 5).
 *
 * Runs in the Node runtime on bytes the caller has already authorised and
 * read from private storage. Nothing here writes anywhere.
 *
 *  • PDF            → text layer via `unpdf`, page by page. A PDF whose pages
 *                     carry (almost) no text is a scan and is marked for OCR.
 *  • DOCX/XLSX/PPTX → the Office Open XML parts, unzipped with hard limits on
 *                     entry count and inflated size (zip bombs stop here).
 *  • TXT/CSV        → decoded as UTF-8 or UTF-16 by byte-order mark.
 *  • Images         → no text layer: OCR.
 *  • DOC/XLS (OLE2) → not readable here; the caller says so.
 */
export type ExtractionMethod =
  "plain-text" | "pdf-text" | "office-xml" | "needs-ocr" | "unsupported";

export interface ExtractedSection {
  /** "Page 3", "Slide 2", "Sheet: Budget"… — used for page-aware answers. */
  label: string;
  text: string;
}

export interface ExtractedDocument {
  method: ExtractionMethod;
  sections: ExtractedSection[];
  /** Pages in a PDF, slides in a deck, sheets in a workbook. */
  unitCount: number;
}

/** Longest inflated XML part read from an Office file (a very large sheet). */
const MAX_PART_BYTES = 25 * 1_048_576;
/** Total inflated bytes read from one Office file. */
const MAX_TOTAL_INFLATED_BYTES = 60 * 1_048_576;
/** A scanned PDF has almost no text per page. */
const MIN_TEXT_CHARS_PER_PAGE = 25;

export const OCR_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

export async function extractDocumentText(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ExtractedDocument> {
  switch (mimeType) {
    case "text/plain":
    case "text/csv":
      return {
        method: "plain-text",
        sections: [{ label: "Text", text: decodeText(bytes) }],
        unitCount: 1,
      };
    case "application/pdf":
      return await extractPdf(bytes);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocx(bytes);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return extractXlsx(bytes);
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return extractPptx(bytes);
    default:
      if (mimeType.startsWith("image/")) return { method: "needs-ocr", sections: [], unitCount: 1 };
      return { method: "unsupported", sections: [], unitCount: 0 };
  }
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return new TextDecoder("utf-8").decode(bytes.subarray(start));
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const sections = text.map((pageText, index) => ({
      label: `Page ${index + 1}`,
      text: normaliseWhitespace(pageText),
    }));
    const characters = sections.reduce((sum, section) => sum + section.text.length, 0);
    const scanned = characters < MIN_TEXT_CHARS_PER_PAGE * Math.max(1, totalPages);
    return {
      method: scanned ? "needs-ocr" : "pdf-text",
      sections: scanned ? [] : sections,
      unitCount: totalPages,
    };
  } finally {
    // Releases the parsed document and its worker resources.
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

/** Unzips only the parts asked for, refusing anything that inflates too far. */
export function readZipParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Map<string, string> {
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!wanted(file.name)) return false;
      if (file.originalSize > MAX_PART_BYTES) {
        throw new Error("document part too large to read");
      }
      total += file.originalSize;
      if (total > MAX_TOTAL_INFLATED_BYTES) throw new Error("document too large to read");
      return true;
    },
  });
  const decoder = new TextDecoder("utf-8");
  const parts = new Map<string, string>();
  for (const [name, data] of Object.entries(files)) parts.set(name, decoder.decode(data));
  return parts;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1]?.toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return ENTITY[entity.toLowerCase()] ?? "";
  });
}

function normaliseWhitespace(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // Tabs survive: in Word and PDF text they often separate table columns.
      .replace(/[ \f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Word: paragraphs from `<w:p>`; text runs, tabs and line breaks in document order. */
const WORD_RUN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>/g;

export function wordXmlToText(xml: string): string {
  return normaliseWhitespace(
    xml
      .split(/<\/w:p>/)
      .map((paragraph) =>
        [...paragraph.matchAll(WORD_RUN)]
          .map((match) =>
            match[1] !== undefined
              ? decodeXmlEntities(match[1])
              : match[0].startsWith("<w:tab")
                ? "\t"
                : "\n",
          )
          .join(""),
      )
      .join("\n"),
  );
}

function extractDocx(bytes: Uint8Array): ExtractedDocument {
  const parts = readZipParts(bytes, (name) =>
    /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(name),
  );
  const body = parts.get("word/document.xml");
  if (!body) return { method: "unsupported", sections: [], unitCount: 0 };

  const sections: ExtractedSection[] = [{ label: "Document", text: wordXmlToText(body) }];
  for (const [name, xml] of parts) {
    if (name === "word/document.xml") continue;
    const text = wordXmlToText(xml);
    if (text) sections.push({ label: name.replace(/^word\/|\.xml$/g, ""), text });
  }
  return { method: "office-xml", sections, unitCount: 1 };
}

function columnIndex(reference: string): number {
  const letters = reference.replace(/\d+$/, "");
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Excel: each sheet as CSV-like rows, shared strings resolved. */
function extractXlsx(bytes: Uint8Array): ExtractedDocument {
  const parts = readZipParts(
    bytes,
    (name) =>
      name === "xl/sharedStrings.xml" ||
      name === "xl/workbook.xml" ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );

  const shared: string[] = [];
  for (const item of (parts.get("xl/sharedStrings.xml") ?? "").split("</si>")) {
    const runs = [...item.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? "");
    if (item.includes("<si")) shared.push(decodeXmlEntities(runs.join("")));
  }

  const names = [
    ...(parts.get("xl/workbook.xml") ?? "").matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g),
  ].map((m) => decodeXmlEntities(m[1] ?? ""));

  const sheets = [...parts.keys()]
    .filter((name) => name.startsWith("xl/worksheets/"))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));

  const sections = sheets.map((sheetName, index) => {
    const xml = parts.get(sheetName) ?? "";
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributes = cell[1] ?? "";
        const inner = cell[2] ?? "";
        const reference = attributes.match(/\br="([A-Z]+\d+)"/)?.[1];
        const type = attributes.match(/\bt="(\w+)"/)?.[1];
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (type === "s" && raw !== undefined) value = shared[Number(raw)] ?? "";
        else if (type === "inlineStr") {
          value = decodeXmlEntities(
            [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? "").join(""),
          );
        } else if (raw !== undefined) value = decodeXmlEntities(raw);
        const column = reference ? columnIndex(reference) : cells.length;
        while (cells.length < column) cells.push("");
        cells[column] = csvCell(value);
      }
      if (cells.some(Boolean)) rows.push(cells.join(","));
    }
    return { label: `Sheet: ${names[index] ?? index + 1}`, text: rows.join("\n") };
  });

  return {
    method: "office-xml",
    sections: sections.filter((s) => s.text),
    unitCount: sheets.length,
  };
}

/** PowerPoint: slide text in slide order, notes where present. */
function extractPptx(bytes: Uint8Array): ExtractedDocument {
  const parts = readZipParts(bytes, (name) =>
    /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name),
  );
  const number = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const slides = [...parts.keys()]
    .filter((name) => name.startsWith("ppt/slides/"))
    .sort((a, b) => number(a) - number(b));

  const textOf = (xml: string) =>
    normaliseWhitespace(
      xml
        .split(/<\/a:p>/)
        .map((paragraph) =>
          decodeXmlEntities(
            [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1] ?? "").join(""),
          ),
        )
        .filter(Boolean)
        .join("\n"),
    );

  const sections = slides.map((name) => {
    const notes = parts.get(`ppt/notesSlides/notesSlide${number(name)}.xml`);
    const body = textOf(parts.get(name) ?? "");
    const noteText = notes ? textOf(notes) : "";
    return {
      label: `Slide ${number(name)}`,
      text: noteText ? `${body}\n\nSpeaker notes:\n${noteText}` : body,
    };
  });
  return {
    method: "office-xml",
    sections: sections.filter((s) => s.text),
    unitCount: slides.length,
  };
}
