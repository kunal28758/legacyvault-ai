import "server-only";

/**
 * Upload validation (FR-H002, FR-H003, ADR-015).
 *
 * The browser's declared filename, MIME type and size are all untrusted. They
 * are checked here before an upload is allowed, and the *actual* size and
 * leading bytes are checked again after the object lands in quarantine — a file
 * that claims to be a PDF and starts with `MZ` is rejected at that point.
 */
export const MAX_DOCUMENT_BYTES = 52_428_800; // 50 MB (FR-H002)
export const MAX_VIDEO_BYTES = 524_288_000; // 500 MB (FR-K002)

interface TypeRule {
  mimeTypes: readonly string[];
  extensions: readonly string[];
  /** Leading byte signatures; an empty list means the format has no reliable one. */
  signatures: readonly (readonly number[])[];
}

const DOCUMENT_TYPES: readonly TypeRule[] = [
  { mimeTypes: ["application/pdf"], extensions: [".pdf"], signatures: [[0x25, 0x50, 0x44, 0x46]] },
  {
    mimeTypes: ["image/jpeg"],
    extensions: [".jpg", ".jpeg"],
    signatures: [[0xff, 0xd8, 0xff]],
  },
  {
    mimeTypes: ["image/png"],
    extensions: [".png"],
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  { mimeTypes: ["image/webp"], extensions: [".webp"], signatures: [[0x52, 0x49, 0x46, 0x46]] },
  { mimeTypes: ["image/heic"], extensions: [".heic"], signatures: [] },
  { mimeTypes: ["text/plain"], extensions: [".txt"], signatures: [] },
  // Office formats: .docx/.xlsx are ZIP containers, .doc/.xls are OLE2.
  {
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    extensions: [".docx", ".xlsx"],
    signatures: [[0x50, 0x4b, 0x03, 0x04]],
  },
  {
    mimeTypes: ["application/msword", "application/vnd.ms-excel"],
    extensions: [".doc", ".xls"],
    signatures: [[0xd0, 0xcf, 0x11, 0xe0]],
  },
];

const VIDEO_TYPES: readonly TypeRule[] = [
  // ISO base media: bytes 4–7 are "ftyp"; checked separately below.
  { mimeTypes: ["video/mp4"], extensions: [".mp4", ".m4v"], signatures: [] },
  { mimeTypes: ["video/quicktime"], extensions: [".mov"], signatures: [] },
  { mimeTypes: ["video/webm"], extensions: [".webm"], signatures: [[0x1a, 0x45, 0xdf, 0xa3]] },
];

export type UploadKind = "DOCUMENT" | "DOCUMENT_VERSION" | "VIDEO";

export function rulesFor(kind: UploadKind): readonly TypeRule[] {
  return kind === "VIDEO" ? VIDEO_TYPES : DOCUMENT_TYPES;
}

export function maxBytesFor(kind: UploadKind): number {
  return kind === "VIDEO" ? MAX_VIDEO_BYTES : MAX_DOCUMENT_BYTES;
}

export function allowedMimeTypes(kind: UploadKind): string[] {
  return rulesFor(kind).flatMap((rule) => [...rule.mimeTypes]);
}

/**
 * Strips a user-supplied filename down to something safe to store and display.
 *
 * Path separators, traversal segments and control characters are removed. The
 * result is never used as an object key — keys are generated — but it is shown
 * back to the user and sent in a `Content-Disposition`, so it still has to be
 * inert.
 */
export function sanitizeFilename(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return cleaned.slice(0, 200) || "file";
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

export interface DeclaredFile {
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export type ValidationFailure =
  | { field: "name"; reason: string }
  | { field: "mimeType"; reason: string }
  | { field: "sizeBytes"; reason: string };

/** Checks what the browser claims, before an upload URL is handed out. */
export function validateDeclaredFile(
  kind: UploadKind,
  file: DeclaredFile,
): { ok: true; name: string } | { ok: false; failure: ValidationFailure } {
  const name = sanitizeFilename(file.name);
  if (!name || name === "file") {
    return { ok: false, failure: { field: "name", reason: "Give the file a name." } };
  }

  const max = maxBytesFor(kind);
  if (!Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0) {
    return { ok: false, failure: { field: "sizeBytes", reason: "The file appears to be empty." } };
  }
  if (file.sizeBytes > max) {
    return {
      ok: false,
      failure: {
        field: "sizeBytes",
        reason: `Files must be ${Math.round(max / 1_048_576)} MB or smaller.`,
      },
    };
  }

  const rule = rulesFor(kind).find((entry) => entry.mimeTypes.includes(file.mimeType));
  if (!rule) {
    return { ok: false, failure: { field: "mimeType", reason: "That file type is not accepted." } };
  }

  const extension = extensionOf(name);
  if (extension && !rule.extensions.includes(extension)) {
    return {
      ok: false,
      failure: {
        field: "name",
        reason: "The file extension does not match the file type.",
      },
    };
  }

  return { ok: true, name };
}

/**
 * Checks the bytes that actually arrived.
 *
 * Returns false when the declared type has a known signature and the object
 * does not start with it — the "rename an executable to .pdf" case.
 */
export function magicBytesMatch(kind: UploadKind, mimeType: string, head: Uint8Array): boolean {
  const rule = rulesFor(kind).find((entry) => entry.mimeTypes.includes(mimeType));
  if (!rule) return false;

  // ISO base media (mp4 / mov): "ftyp" at offset 4.
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    if (head.length < 12) return false;
    return (
      head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70 // "ftyp"
    );
  }

  if (rule.signatures.length === 0) return true;

  return rule.signatures.some((signature) => {
    if (head.length < signature.length) return false;
    return signature.every((byte, index) => head[index] === byte);
  });
}
