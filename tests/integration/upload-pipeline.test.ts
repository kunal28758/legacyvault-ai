import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import { resetEnvGroupCache } from "@/lib/config/env";
import { pingScanner } from "@/lib/services/malware-scanner";
import * as uploadService from "@/lib/services/upload.service";
import { BUCKETS, permanentKey, quarantineKey, statObject } from "@/lib/storage/storage";

import {
  createServiceScopedClient,
  createUserScopedClient,
  ensureTestUser,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * The document upload pipeline end to end (ADR-005, ADR-015), against the real
 * local storage and a real ClamAV daemon:
 *
 *   session → PUT to quarantine → validate → magic bytes → ClamAV → move → promote
 *
 * These are the guarantees the "stuck at malware scan" defect broke: every path
 * ends in a terminal or explicitly retryable state, a scanner failure is never
 * treated as clean, and a retry after an outage finishes the job.
 */
const SUBJECT = "user_upload_pipeline";

// The user-scoped client normally comes from the Clerk session; here it is a
// Clerk-shaped token for the test subject, so RLS applies exactly as in the app.
const userClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/server")>();
  return { ...actual, createUserClient: async () => userClient.current };
});

const stackAvailable = await isLocalStackAvailable();
const scannerAvailable =
  stackAvailable &&
  process.env.MALWARE_SCANNER_PROVIDER === "clamav" &&
  (await pingScanner()).status === "ok";

if (!stackAvailable || !scannerAvailable) {
  console.warn(
    "[upload-pipeline] local Supabase stack or ClamAV unreachable — start them with `pnpm db:start` and the ClamAV container. Pipeline assertions are SKIPPED, not passed.",
  );
}

let user: AppUser;

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
// The EICAR anti-virus test string, assembled at runtime so this source file is
// not itself flagged by a desktop scanner. It is harmless by design.
const EICAR = new TextEncoder().encode(
  ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""),
);

async function upload(
  bytes: Uint8Array<ArrayBuffer>,
  declared: { name: string; mimeType: string },
): Promise<string> {
  const ticket = await uploadService.createUploadSession(
    user,
    {
      kind: "DOCUMENT",
      name: declared.name,
      mimeType: declared.mimeType,
      sizeBytes: bytes.byteLength,
    },
    "test-correlation",
  );
  const put = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "content-type": declared.mimeType },
    body: bytes,
  });
  expect(put.ok).toBe(true);
  return ticket.uploadId;
}

beforeAll(async () => {
  if (!scannerAvailable) return;
  const service = createServiceScopedClient();
  const id = await ensureTestUser(service, SUBJECT, "Upload Test");

  user = {
    id,
    clerkUserId: SUBJECT,
    email: `${SUBJECT}@example.com`,
    emailVerified: true,
    name: "Upload Test",
    mfaEnabled: false,
    role: "USER",
    onboardingCompletedAt: new Date().toISOString(),
    deletionRequestedAt: null,
  };
  userClient.current = await createUserScopedClient(SUBJECT);
}, 60_000);

beforeEach(() => {
  vi.unstubAllEnvs();
  resetEnvGroupCache();
});

afterAll(async () => {
  if (!scannerAvailable) return;
  vi.unstubAllEnvs();
  resetEnvGroupCache();
  const service = createServiceScopedClient();
  const { data: documents } = await service
    .from("documents")
    .select("storage_key")
    .eq("user_id", user.id);
  const keys = (documents ?? []).map((row) => row.storage_key);
  if (keys.length) await service.storage.from(BUCKETS.documents).remove(keys);
});

describe.skipIf(!scannerAvailable)("upload pipeline with ClamAV", () => {
  it("scans a clean PDF and promotes it into the vault", async () => {
    const uploadId = await upload(PDF, { name: "deed.pdf", mimeType: "application/pdf" });

    const outcome = await uploadService.completeUpload(user, uploadId, {}, "test-correlation");

    expect(outcome.status).toBe("PROMOTED");
    expect(outcome.scan).toMatchObject({ status: "CLEAN", performed: true, provider: "clamav" });
    expect(outcome.documentId).toBeTruthy();
    expect(await statObject(BUCKETS.quarantine, quarantineKey(user.id, uploadId))).toBeNull();
    expect((await statObject(BUCKETS.documents, permanentKey(user.id, uploadId)))?.sizeBytes).toBe(
      PDF.byteLength,
    );

    const status = await uploadService.getUploadStatus(user, uploadId);
    expect(status).toMatchObject({ status: "PROMOTED", inProgress: false, retryable: false });
  }, 60_000);

  it("rejects an infected file and deletes it from quarantine", async () => {
    const uploadId = await upload(EICAR, { name: "notes.txt", mimeType: "text/plain" });

    const outcome = await uploadService.completeUpload(user, uploadId, {}, "test-correlation");

    expect(outcome.status).toBe("REJECTED");
    expect(outcome.scan).toMatchObject({ status: "INFECTED", performed: true });
    expect(outcome.retryable).toBe(false);
    expect(await statObject(BUCKETS.quarantine, quarantineKey(user.id, uploadId))).toBeNull();
  }, 60_000);

  it("rejects an executable renamed to .pdf before it reaches the scanner", async () => {
    const executable = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const uploadId = await upload(executable, { name: "deed.pdf", mimeType: "application/pdf" });

    const outcome = await uploadService.completeUpload(user, uploadId, {}, "test-correlation");

    expect(outcome.status).toBe("REJECTED");
    expect(outcome.rejectionReason).toMatch(/do not match/);
  }, 60_000);

  it("never treats an unreachable scanner as clean, and a retry finishes the upload", async () => {
    const uploadId = await upload(PDF, { name: "retry.pdf", mimeType: "application/pdf" });

    // A port nothing listens on: the scanner is "down".
    vi.stubEnv("CLAMAV_PORT", "1");
    resetEnvGroupCache();
    const failed = await uploadService.completeUpload(user, uploadId, {}, "test-correlation");

    expect(failed.status).toBe("UPLOADED");
    expect(failed.retryable).toBe(true);
    expect(failed.scan.status).toBe("ERROR");
    expect(failed.rejectionReason).toMatch(/scanner unavailable/i);
    // Still held in quarantine, never promoted.
    expect(await statObject(BUCKETS.quarantine, quarantineKey(user.id, uploadId))).not.toBeNull();
    expect(await statObject(BUCKETS.documents, permanentKey(user.id, uploadId))).toBeNull();

    vi.unstubAllEnvs();
    resetEnvGroupCache();
    const retried = await uploadService.completeUpload(user, uploadId, {}, "test-correlation");
    expect(retried.status).toBe("PROMOTED");
    expect(retried.scan.performed).toBe(true);
  }, 60_000);

  it("runs the pipeline once when two completions race", async () => {
    const name = `race-${crypto.randomUUID()}.pdf`;
    const uploadId = await upload(PDF, { name, mimeType: "application/pdf" });

    const settled = await Promise.allSettled([
      uploadService.completeUpload(user, uploadId, {}, "test-correlation"),
      uploadService.completeUpload(user, uploadId, {}, "test-correlation"),
    ]);
    const outcomes = settled
      .filter((result) => result.status === "fulfilled")
      .map(
        (result) =>
          (result as PromiseFulfilledResult<{ status: string; inProgress: boolean }>).value,
      );

    // Exactly one promotion; the other either saw it in progress or was refused.
    expect(outcomes.filter((outcome) => outcome.status === "PROMOTED")).toHaveLength(1);
    const service = createServiceScopedClient();
    const { count } = await service
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("name", name);
    expect(count).toBe(1);
  }, 60_000);

  it("reports a session abandoned mid-scan as retryable, and lets a retry reclaim it", async () => {
    const uploadId = await upload(PDF, { name: "stuck.pdf", mimeType: "application/pdf" });
    const service = createServiceScopedClient();

    // Simulate the old defect: a request died while the session said SCANNING.
    await service.from("upload_sessions").update({ status: "SCANNING" }).eq("id", uploadId);

    // Fresh, it is someone else's scan in progress — not retryable yet.
    expect(await uploadService.getUploadStatus(user, uploadId)).toMatchObject({
      inProgress: true,
      retryable: false,
    });
    expect(
      await uploadService.completeUpload(user, uploadId, {}, "test-correlation"),
    ).toMatchObject({ inProgress: true });

    // Once it has been silent past the staleness window, it is reclaimable.
    // Only `Date` moves; timers and I/O stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + uploadService.STALE_IN_PROGRESS_MS + 60_000);

      const status = await uploadService.getUploadStatus(user, uploadId);
      expect(status).toMatchObject({ inProgress: false, retryable: true });

      const retried = await uploadService.completeUpload(user, uploadId, {}, "test-correlation");
      expect(retried.status).toBe("PROMOTED");
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);
});

describe.skipIf(!scannerAvailable)("upload pipeline — refusals, expiry and audit", () => {
  async function auditActions(uploadId: string): Promise<{ action: string; outcome: string }[]> {
    const { data } = await createServiceScopedClient()
      .from("audit_log")
      .select("action, outcome")
      .eq("resource_id", uploadId);
    return (data ?? []) as { action: string; outcome: string }[];
  }

  it("refuses an undeclared type before any upload URL is issued", async () => {
    await expect(
      uploadService.createUploadSession(
        user,
        { kind: "DOCUMENT", name: "tool.exe", mimeType: "application/x-msdownload", sizeBytes: 10 },
        "test-correlation",
      ),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });

    // A declared size above the limit is refused the same way.
    await expect(
      uploadService.createUploadSession(
        user,
        { kind: "DOCUMENT", name: "huge.pdf", mimeType: "application/pdf", sizeBytes: 52_428_801 },
        "test-correlation",
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("measures what arrived, not what was declared: an oversized object is rejected and removed", async () => {
    // Declares a small PDF, then puts 51 MB into quarantine.
    const ticket = await uploadService.createUploadSession(
      user,
      { kind: "DOCUMENT", name: "small.pdf", mimeType: "application/pdf", sizeBytes: 1_024 },
      "test-correlation",
    );
    const big = new Uint8Array(51 * 1_048_576);
    big.set(PDF);
    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: big,
    });
    expect(put.ok).toBe(true);

    const outcome = await uploadService.completeUpload(
      user,
      ticket.uploadId,
      {},
      "test-correlation",
    );
    expect(outcome.status).toBe("REJECTED");
    expect(outcome.rejectionReason).toMatch(/larger than the limit/);
    expect(
      await statObject(BUCKETS.quarantine, quarantineKey(user.id, ticket.uploadId)),
    ).toBeNull();
  }, 120_000);

  it("expires a stale session, removes its object and refuses to complete it", async () => {
    const uploadId = await upload(PDF, { name: "late.pdf", mimeType: "application/pdf" });
    await createServiceScopedClient()
      .from("upload_sessions")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", uploadId);

    await expect(
      uploadService.completeUpload(user, uploadId, {}, "test-correlation"),
    ).rejects.toMatchObject({ status: 409 });

    const { data } = await createServiceScopedClient()
      .from("upload_sessions")
      .select("status")
      .eq("id", uploadId)
      .single();
    expect(data?.status).toBe("EXPIRED");
    expect(await statObject(BUCKETS.quarantine, quarantineKey(user.id, uploadId))).toBeNull();
    expect(await uploadService.getUploadStatus(user, uploadId)).toMatchObject({
      status: "EXPIRED",
      retryable: false,
      inProgress: false,
    });
  }, 60_000);

  it("audits rejections and scanner failures", async () => {
    const infected = await upload(EICAR, { name: "virus.txt", mimeType: "text/plain" });
    await uploadService.completeUpload(user, infected, {}, "test-correlation");
    expect(await auditActions(infected)).toContainEqual({
      action: "upload.rejected",
      outcome: "FAILURE",
    });

    const unscanned = await upload(PDF, { name: "outage.pdf", mimeType: "application/pdf" });
    vi.stubEnv("CLAMAV_PORT", "1");
    resetEnvGroupCache();
    try {
      await uploadService.completeUpload(user, unscanned, {}, "test-correlation");
    } finally {
      vi.unstubAllEnvs();
      resetEnvGroupCache();
    }
    expect(await auditActions(unscanned)).toContainEqual({
      action: "upload.scan_failed",
      outcome: "FAILURE",
    });
  }, 60_000);
});
