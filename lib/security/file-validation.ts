import "server-only";

import {
  extensionOf,
  maxBytesFor,
  ruleForMimeType,
  type UploadKind,
} from "@/lib/uploads/file-types";

/**
 * Upload validation (FR-H002, FR-H003).
 *
 * The browser's declared filename, MIME type and size are all untrusted. They
 * are checked here before an upload is allowed, and the *actual* size and
 * leading bytes are checked again after the object lands in private storage
 * and before it is promoted into the vault — a file that claims to be a PDF and
 * starts with `MZ` is rejected and deleted at that point.
 *
 * The accepted types themselves live in `lib/uploads/file-types.ts`, shared
 * with the browser's pre-check so the two can never disagree.
 */
export {
  MAX_DOCUMENT_BYTES,
  MAX_VIDEO_BYTES,
  allowedMimeTypes,
  extensionOf,
  maxBytesFor,
  rulesFor,
  type UploadKind,
} from "@/lib/uploads/file-types";

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

  const rule = ruleForMimeType(kind, file.mimeType);
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

/** Executable and archive prefixes that are never plain text. */
const BINARY_PREFIXES: readonly (readonly number[])[] = [
  [0x4d, 0x5a], // MZ — Windows executable
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x50, 0x4b, 0x03, 0x04], // ZIP
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O
  [0x25, 0x50, 0x44, 0x46], // PDF
];

function startsWith(head: Uint8Array, signature: readonly number[]): boolean {
  return head.length >= signature.length && signature.every((byte, index) => head[index] === byte);
}

/**
 * Text has no signature, so it is checked for what it must not contain: a
 * binary prefix, or NUL bytes (UTF-16 text, which legitimately has them, is
 * recognised by its byte-order mark).
 */
export function looksLikeText(head: Uint8Array): boolean {
  if (BINARY_PREFIXES.some((prefix) => startsWith(head, prefix))) return false;
  const utf16 = startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff]);
  if (utf16) return true;
  return !head.includes(0x00);
}

/** ISO base media (MP4, MOV, HEIC): the `ftyp` box at offset 4. */
function isIsoBmff(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  return head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

/**
 * Checks the bytes that actually arrived.
 *
 * Returns false when the declared type has a known signature and the object
 * does not start with it — the "rename an executable to .pdf" case.
 */
export function magicBytesMatch(kind: UploadKind, mimeType: string, head: Uint8Array): boolean {
  const rule = ruleForMimeType(kind, mimeType);
  if (!rule) return false;

  if (rule.check === "iso-bmff") return isIsoBmff(head);
  if (rule.check === "text") return looksLikeText(head);
  if (rule.signatures.length === 0) return true;

  return rule.signatures.some((signature) => startsWith(head, signature));
}
