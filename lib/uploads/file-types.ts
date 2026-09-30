/**
 * Accepted upload types and limits (FR-H002, FR-K002, ADR-005).
 *
 * The single source of truth for what may be uploaded. Browser-safe on
 * purpose: the upload dialog pre-checks against these rules for a fast answer,
 * and `lib/security/file-validation.ts` enforces the same rules on the server —
 * declared metadata before a signed URL is issued, and the real bytes after
 * they land in quarantine. The browser's check is a convenience; the server's
 * is the control.
 *
 * Adding a document type also needs the `documents` bucket allow-list in a new
 * migration (see 0005_document_types.sql).
 */
export const MAX_DOCUMENT_BYTES = 52_428_800; // 50 MB (FR-H002)
export const MAX_VIDEO_BYTES = 524_288_000; // 500 MB (FR-K002)

export type UploadKind = "DOCUMENT" | "DOCUMENT_VERSION" | "VIDEO";

export interface TypeRule {
  label: string;
  mimeTypes: readonly string[];
  extensions: readonly string[];
  /** Leading byte signatures; empty when the format is checked another way. */
  signatures: readonly (readonly number[])[];
  /** How the bytes are verified when there is no fixed leading signature. */
  check?: "text" | "iso-bmff";
}

const ZIP = [0x50, 0x4b, 0x03, 0x04] as const;
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0] as const;

export const DOCUMENT_TYPES: readonly TypeRule[] = [
  {
    label: "PDF",
    mimeTypes: ["application/pdf"],
    extensions: [".pdf"],
    signatures: [[0x25, 0x50, 0x44, 0x46]],
  },
  {
    label: "JPEG",
    mimeTypes: ["image/jpeg"],
    extensions: [".jpg", ".jpeg"],
    signatures: [[0xff, 0xd8, 0xff]],
  },
  {
    label: "PNG",
    mimeTypes: ["image/png"],
    extensions: [".png"],
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  {
    label: "WebP",
    mimeTypes: ["image/webp"],
    extensions: [".webp"],
    signatures: [[0x52, 0x49, 0x46, 0x46]],
  },
  {
    label: "HEIC",
    mimeTypes: ["image/heic"],
    extensions: [".heic"],
    signatures: [],
    check: "iso-bmff",
  },
  { label: "Text", mimeTypes: ["text/plain"], extensions: [".txt"], signatures: [], check: "text" },
  { label: "CSV", mimeTypes: ["text/csv"], extensions: [".csv"], signatures: [], check: "text" },
  // Office Open XML formats are ZIP containers; legacy .doc/.xls are OLE2.
  {
    label: "Word",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    extensions: [".docx"],
    signatures: [ZIP],
  },
  {
    label: "Excel",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    extensions: [".xlsx"],
    signatures: [ZIP],
  },
  {
    label: "PowerPoint",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    extensions: [".pptx"],
    signatures: [ZIP],
  },
  { label: "Word 97", mimeTypes: ["application/msword"], extensions: [".doc"], signatures: [OLE2] },
  {
    label: "Excel 97",
    mimeTypes: ["application/vnd.ms-excel"],
    extensions: [".xls"],
    signatures: [OLE2],
  },
];

export const VIDEO_TYPES: readonly TypeRule[] = [
  {
    label: "MP4",
    mimeTypes: ["video/mp4"],
    extensions: [".mp4", ".m4v"],
    signatures: [],
    check: "iso-bmff",
  },
  {
    label: "MOV",
    mimeTypes: ["video/quicktime"],
    extensions: [".mov"],
    signatures: [],
    check: "iso-bmff",
  },
  {
    label: "WebM",
    mimeTypes: ["video/webm"],
    extensions: [".webm"],
    signatures: [[0x1a, 0x45, 0xdf, 0xa3]],
  },
];

export function rulesFor(kind: UploadKind): readonly TypeRule[] {
  return kind === "VIDEO" ? VIDEO_TYPES : DOCUMENT_TYPES;
}

export function maxBytesFor(kind: UploadKind): number {
  return kind === "VIDEO" ? MAX_VIDEO_BYTES : MAX_DOCUMENT_BYTES;
}

export function allowedMimeTypes(kind: UploadKind): string[] {
  return rulesFor(kind).flatMap((rule) => [...rule.mimeTypes]);
}

export function allowedExtensions(kind: UploadKind): string[] {
  return rulesFor(kind).flatMap((rule) => [...rule.extensions]);
}

/** The `accept` attribute for a file input. */
export function acceptAttribute(kind: UploadKind): string {
  return [...allowedExtensions(kind), ...allowedMimeTypes(kind)].join(",");
}

/** Human-readable list, e.g. "PDF, JPEG, PNG …". */
export function describeAcceptedTypes(kind: UploadKind): string {
  return rulesFor(kind)
    .map((rule) => rule.label)
    .join(", ");
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

export function ruleForMimeType(kind: UploadKind, mimeType: string): TypeRule | undefined {
  return rulesFor(kind).find((rule) => rule.mimeTypes.includes(mimeType));
}

export function ruleForExtension(kind: UploadKind, extension: string): TypeRule | undefined {
  return rulesFor(kind).find((rule) => rule.extensions.includes(extension));
}

/**
 * The MIME type to declare for a file.
 *
 * Browsers leave `File.type` empty for some formats (CSV and HEIC on Windows,
 * for example); the extension then decides. A non-empty type the rules do not
 * know is kept as-is so the server can refuse it with a clear message.
 */
export function declaredMimeType(kind: UploadKind, file: { name: string; type: string }): string {
  if (file.type) {
    // Windows reports CSV as Excel; the extension is the better witness there.
    if (file.type === "application/vnd.ms-excel" && extensionOf(file.name) === ".csv") {
      return "text/csv";
    }
    return file.type;
  }
  return ruleForExtension(kind, extensionOf(file.name))?.mimeTypes[0] ?? "application/octet-stream";
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_048_576)} MB`;
}

/**
 * Checks what the browser can know before any bytes move: extension, declared
 * type and size. The server repeats this and then inspects the bytes.
 */
export function precheckUpload(
  kind: UploadKind,
  file: { name: string; type: string; size: number },
): { ok: true; mimeType: string } | { ok: false; reason: string } {
  const extension = extensionOf(file.name);
  const byExtension = ruleForExtension(kind, extension);
  if (!byExtension) {
    return {
      ok: false,
      reason: `${extension ? `“${extension}” files are` : "Files without an extension are"} not accepted. Allowed: ${describeAcceptedTypes(kind)}.`,
    };
  }

  const mimeType = declaredMimeType(kind, file);
  const byType = ruleForMimeType(kind, mimeType);
  if (!byType) {
    return {
      ok: false,
      reason: `This ${kind === "VIDEO" ? "video" : "file"} type is not accepted.`,
    };
  }
  if (byType !== byExtension) {
    return { ok: false, reason: "The file extension does not match its type." };
  }

  if (file.size <= 0) return { ok: false, reason: "The file is empty." };
  const max = maxBytesFor(kind);
  if (file.size > max) {
    return {
      ok: false,
      reason: `Files must be ${formatMegabytes(max)} or smaller (this one is ${formatMegabytes(file.size)}).`,
    };
  }
  return { ok: true, mimeType };
}
