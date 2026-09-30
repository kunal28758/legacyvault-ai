import { describe, expect, it } from "vitest";

import {
  MAX_DOCUMENT_BYTES,
  MAX_VIDEO_BYTES,
  extensionOf,
  magicBytesMatch,
  sanitizeFilename,
  validateDeclaredFile,
} from "@/lib/security/file-validation";
import { declaredMimeType, precheckUpload } from "@/lib/uploads/file-types";

/**
 * Upload validation (FR-H002/H003, ADR-015).
 *
 * These are the checks that stand between a user-supplied file and private
 * storage: what the browser claims is bounded here, and what actually arrives
 * is checked against its leading bytes — the "renamed executable" case.
 */
describe("filename sanitization", () => {
  it("strips directory traversal and separators", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\config")).toBe("config");
    expect(sanitizeFilename("/absolute/path/deed.pdf")).toBe("deed.pdf");
  });

  it("removes leading dots so a file cannot be hidden or empty-named", () => {
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename(".env")).toBe("env");
  });

  it("removes control and shell-significant characters", () => {
    expect(sanitizeFilename('will<>:"|?*.pdf')).toBe("will.pdf");
    expect(sanitizeFilename("will\u0000\u001f.pdf")).toBe("will.pdf");
  });

  it("bounds the length", () => {
    expect(sanitizeFilename("a".repeat(500)).length).toBe(200);
  });

  it("reads the extension case-insensitively", () => {
    expect(extensionOf("Deed.PDF")).toBe(".pdf");
    expect(extensionOf("noextension")).toBe("");
  });
});

describe("declared file validation", () => {
  const pdf = { name: "deed.pdf", mimeType: "application/pdf", sizeBytes: 1024 };

  it("accepts an allowed type and returns the sanitized name", () => {
    const result = validateDeclaredFile("DOCUMENT", { ...pdf, name: "../deed.pdf" });
    expect(result).toEqual({ ok: true, name: "deed.pdf" });
  });

  it("refuses a type that is not on the allow-list", () => {
    const result = validateDeclaredFile("DOCUMENT", {
      ...pdf,
      name: "payload.exe",
      mimeType: "application/x-msdownload",
    });
    expect(result).toMatchObject({ ok: false, failure: { field: "mimeType" } });
  });

  it("refuses an extension that contradicts the declared type", () => {
    const result = validateDeclaredFile("DOCUMENT", { ...pdf, name: "deed.exe" });
    expect(result).toMatchObject({ ok: false, failure: { field: "name" } });
  });

  it("enforces the per-kind size limit", () => {
    expect(
      validateDeclaredFile("DOCUMENT", { ...pdf, sizeBytes: MAX_DOCUMENT_BYTES + 1 }),
    ).toMatchObject({ ok: false, failure: { field: "sizeBytes" } });

    // The same size is fine for a video, which has its own larger limit.
    expect(
      validateDeclaredFile("VIDEO", {
        name: "message.mp4",
        mimeType: "video/mp4",
        sizeBytes: MAX_DOCUMENT_BYTES + 1,
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateDeclaredFile("VIDEO", {
        name: "message.mp4",
        mimeType: "video/mp4",
        sizeBytes: MAX_VIDEO_BYTES + 1,
      }),
    ).toMatchObject({ ok: false, failure: { field: "sizeBytes" } });
  });

  it("refuses an empty file", () => {
    expect(validateDeclaredFile("DOCUMENT", { ...pdf, sizeBytes: 0 })).toMatchObject({
      ok: false,
      failure: { field: "sizeBytes" },
    });
  });

  it("refuses a document type for a video upload", () => {
    expect(
      validateDeclaredFile("VIDEO", {
        name: "deed.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }),
    ).toMatchObject({ ok: false, failure: { field: "mimeType" } });
  });
});

describe("magic bytes", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("accepts a real PDF header", () => {
    expect(
      magicBytesMatch("DOCUMENT", "application/pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d)),
    ).toBe(true);
  });

  it("rejects an executable renamed to .pdf", () => {
    // "MZ" — a Windows executable.
    expect(magicBytesMatch("DOCUMENT", "application/pdf", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(
      false,
    );
  });

  it("accepts PNG and JPEG signatures", () => {
    expect(
      magicBytesMatch(
        "DOCUMENT",
        "image/png",
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      ),
    ).toBe(true);
    expect(magicBytesMatch("DOCUMENT", "image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(magicBytesMatch("DOCUMENT", "image/png", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(false);
  });

  it("recognises ISO base media for mp4 and mov", () => {
    // Four size bytes, then "ftyp".
    const mp4 = bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
    expect(magicBytesMatch("VIDEO", "video/mp4", mp4)).toBe(true);
    expect(magicBytesMatch("VIDEO", "video/quicktime", mp4)).toBe(true);
    expect(magicBytesMatch("VIDEO", "video/mp4", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
  });

  it("refuses a type that has no rule at all", () => {
    expect(magicBytesMatch("DOCUMENT", "application/x-msdownload", bytes(0x4d, 0x5a))).toBe(false);
  });

  it("accepts plain text and CSV that look like text", () => {
    expect(magicBytesMatch("DOCUMENT", "text/plain", bytes(0x68, 0x69))).toBe(true);
    expect(magicBytesMatch("DOCUMENT", "text/csv", bytes(0x61, 0x2c, 0x62, 0x0a))).toBe(true);
    // UTF-16 text carries NUL bytes but announces itself with a byte-order mark.
    expect(magicBytesMatch("DOCUMENT", "text/plain", bytes(0xff, 0xfe, 0x68, 0x00))).toBe(true);
  });

  it("rejects binaries disguised as text", () => {
    expect(magicBytesMatch("DOCUMENT", "text/plain", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
    expect(magicBytesMatch("DOCUMENT", "text/csv", bytes(0x7f, 0x45, 0x4c, 0x46))).toBe(false);
    expect(magicBytesMatch("DOCUMENT", "text/plain", bytes(0x68, 0x00, 0x69))).toBe(false);
  });

  it("checks HEIC as ISO base media instead of accepting any bytes", () => {
    const heic = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
    expect(magicBytesMatch("DOCUMENT", "image/heic", heic)).toBe(true);
    expect(magicBytesMatch("DOCUMENT", "image/heic", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
  });

  it("accepts Office Open XML containers, including PowerPoint", () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
    expect(
      magicBytesMatch(
        "DOCUMENT",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        zip,
      ),
    ).toBe(true);
  });
});

describe("browser pre-check (shared rules)", () => {
  const file = (name: string, type: string, size = 1024) => ({ name, type, size });

  it("agrees with the server on what is accepted", () => {
    expect(precheckUpload("DOCUMENT", file("deed.pdf", "application/pdf"))).toEqual({
      ok: true,
      mimeType: "application/pdf",
    });
    // GIF used to pass the browser check and then fail on the server.
    expect(precheckUpload("DOCUMENT", file("photo.gif", "image/gif"))).toMatchObject({ ok: false });
  });

  it("infers the type from the extension when the browser leaves it empty", () => {
    expect(precheckUpload("DOCUMENT", file("ledger.csv", ""))).toEqual({
      ok: true,
      mimeType: "text/csv",
    });
    expect(declaredMimeType("DOCUMENT", { name: "photo.heic", type: "" })).toBe("image/heic");
  });

  it("maps Windows' Excel type for a .csv back to text/csv", () => {
    expect(precheckUpload("DOCUMENT", file("ledger.csv", "application/vnd.ms-excel"))).toEqual({
      ok: true,
      mimeType: "text/csv",
    });
  });

  it("refuses mismatched extensions, empty files and oversized files", () => {
    expect(precheckUpload("DOCUMENT", file("deed.pdf", "image/png"))).toMatchObject({ ok: false });
    expect(precheckUpload("DOCUMENT", file("deed.pdf", "application/pdf", 0))).toMatchObject({
      ok: false,
    });
    expect(
      precheckUpload("DOCUMENT", file("deed.pdf", "application/pdf", MAX_DOCUMENT_BYTES + 1)),
    ).toMatchObject({ ok: false });
    expect(
      precheckUpload("VIDEO", file("message.mp4", "video/mp4", MAX_DOCUMENT_BYTES + 1)),
    ).toMatchObject({ ok: true });
  });
});
