import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import { runHousekeeping } from "@/lib/jobs/handlers/housekeeping";
import * as uploadService from "@/lib/services/upload.service";
import {
  BUCKETS,
  createSignedDownloadUrl,
  statObject,
  uploadObjectKey,
} from "@/lib/storage/storage";

import {
  createServiceScopedClient,
  createUserScopedClient,
  ensureTestUser,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * The upload pipeline end to end (ADR-005), against the real local database
 * and storage, with no malware scanner anywhere:
 *
 *   session → PUT straight to the private bucket → size → magic bytes → promote
 *
 * Asserted: an ordinary upload succeeds and is recorded as NOT_SCANNED (never
 * CLEAN); the bytes stay private; a caller can never complete, target or read
 * another user's upload; a bad file is rejected and its bytes deleted; every
 * path ends in a terminal or explicitly retryable state; and the daily sweep
 * removes abandoned bytes without ever touching a file a row points at.
 */
const SUBJECT = "user_upload_pipeline";
const INTRUDER = "user_upload_pipeline_intruder";

// The user-scoped client normally comes from the Clerk session; here it is a
// Clerk-shaped token for the acting subject, so RLS applies exactly as in the app.
const userClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/server")>();
  return { ...actual, createUserClient: async () => userClient.current };
});

const available = await isLocalStackAvailable();
if (!available) {
  console.warn(
    "[upload-pipeline] local Supabase stack unreachable — start it with `pnpm db:start`. Pipeline assertions are SKIPPED, not passed.",
  );
}

let user: AppUser;
let intruder: AppUser;
let ownerClient: unknown;
let intruderClient: unknown;

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
// The smallest ISO-BMFF header the content check accepts: a `ftyp` box.
const MP4 = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
]);

function appUser(id: string, subject: string): AppUser {
  return {
    id,
    clerkUserId: subject,
    email: `${subject}@example.com`,
    emailVerified: true,
    name: subject,
    mfaEnabled: false,
    role: "USER",
    onboardingCompletedAt: new Date().toISOString(),
    deletionRequestedAt: null,
  };
}

function as(actor: "owner" | "intruder"): AppUser {
  userClient.current = actor === "owner" ? ownerClient : intruderClient;
  return actor === "owner" ? user : intruder;
}

async function put(url: string, bytes: Uint8Array, mimeType: string): Promise<Response> {
  return fetch(url, {
    method: "PUT",
    headers: { "content-type": mimeType },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
}

async function upload(
  bytes: Uint8Array,
  declared: {
    name: string;
    mimeType: string;
    kind?: "DOCUMENT" | "DOCUMENT_VERSION" | "VIDEO";
    documentId?: string;
  },
): Promise<string> {
  const ticket = await uploadService.createUploadSession(
    as("owner"),
    {
      kind: declared.kind ?? "DOCUMENT",
      name: declared.name,
      mimeType: declared.mimeType,
      sizeBytes: bytes.byteLength,
      ...(declared.documentId ? { documentId: declared.documentId } : {}),
    },
    "test-correlation",
  );
  const response = await put(ticket.uploadUrl, bytes, declared.mimeType);
  expect(response.ok).toBe(true);
  return ticket.uploadId;
}

function complete(uploadId: string, body = {}) {
  return uploadService.completeUpload(as("owner"), uploadId, body, "test-correlation");
}

async function sessionStatus(uploadId: string): Promise<string | undefined> {
  const { data } = await createServiceScopedClient()
    .from("upload_sessions")
    .select("status")
    .eq("id", uploadId)
    .single();
  return (data as { status: string } | null)?.status;
}

async function auditActions(resourceId: string): Promise<{ action: string; outcome: string }[]> {
  const { data } = await createServiceScopedClient()
    .from("audit_log")
    .select("action, outcome")
    .eq("resource_id", resourceId);
  return (data ?? []) as { action: string; outcome: string }[];
}

beforeAll(async () => {
  if (!available) return;
  const service = createServiceScopedClient();
  user = appUser(await ensureTestUser(service, SUBJECT, "Upload Test"), SUBJECT);
  intruder = appUser(await ensureTestUser(service, INTRUDER, "Intruder"), INTRUDER);
  ownerClient = await createUserScopedClient(SUBJECT);
  intruderClient = await createUserScopedClient(INTRUDER);
}, 60_000);

afterAll(async () => {
  if (!available) return;
  const service = createServiceScopedClient();
  const { data: documents } = await service
    .from("documents")
    .select("storage_key")
    .eq("user_id", user.id);
  const { data: versions } = await service
    .from("document_versions")
    .select("storage_key, documents!inner(user_id)")
    .eq("documents.user_id", user.id);
  const keys = [
    ...new Set([...(documents ?? []), ...(versions ?? [])].map((row) => row.storage_key)),
  ];
  if (keys.length) await service.storage.from(BUCKETS.documents).remove(keys);
  const { data: videos } = await service
    .from("video_messages")
    .select("storage_key")
    .eq("user_id", user.id);
  const videoKeys = (videos ?? []).map((row) => row.storage_key);
  if (videoKeys.length) await service.storage.from(BUCKETS.videos).remove(videoKeys);
});

describe.skipIf(!available)("upload without a malware scanner", () => {
  it("stores a PDF privately and records it as not scanned", async () => {
    const uploadId = await upload(PDF, { name: "deed.pdf", mimeType: "application/pdf" });

    const outcome = await complete(uploadId);

    expect(outcome).toMatchObject({
      status: "PROMOTED",
      retryable: false,
      inProgress: false,
      rejectionReason: null,
    });
    expect(outcome).not.toHaveProperty("scan");
    expect(outcome.documentId).toBeTruthy();

    // The bytes went straight to the documents bucket and stayed at their key.
    const key = uploadObjectKey(user.id, uploadId);
    expect((await statObject(BUCKETS.documents, key))?.sizeBytes).toBe(PDF.byteLength);

    // Nothing claims a scan happened.
    const { data: row } = await createServiceScopedClient()
      .from("documents")
      .select("scan_status, storage_bucket, storage_key, metadata")
      .eq("id", outcome.documentId!)
      .single();
    expect(row).toMatchObject({
      scan_status: "NOT_SCANNED",
      storage_bucket: "documents",
      storage_key: key,
    });
    expect(JSON.stringify(row?.metadata ?? {})).not.toMatch(/scan|clean/i);

    expect(await uploadService.getUploadStatus(as("owner"), uploadId)).toMatchObject({
      status: "PROMOTED",
      inProgress: false,
      retryable: false,
    });
    expect(await auditActions(outcome.documentId!)).toContainEqual({
      action: "document.uploaded",
      outcome: "SUCCESS",
    });
  });

  it("stores a new version of an existing document the same way", async () => {
    const first = await complete(
      await upload(PDF, { name: "policy.pdf", mimeType: "application/pdf" }),
    );
    const versionUpload = await upload(PDF, {
      name: "policy-v2.pdf",
      mimeType: "application/pdf",
      kind: "DOCUMENT_VERSION",
      documentId: first.documentId,
    });

    const outcome = await complete(versionUpload);

    expect(outcome).toMatchObject({ status: "PROMOTED", documentId: first.documentId });
    const service = createServiceScopedClient();
    const { data } = await service
      .from("documents")
      .select("scan_status, storage_key")
      .eq("id", first.documentId!)
      .single();
    expect(data?.scan_status).toBe("NOT_SCANNED");
    expect(data?.storage_key).toBe(uploadObjectKey(user.id, versionUpload));
    const { count } = await service
      .from("document_versions")
      .select("id", { count: "exact", head: true })
      .eq("document_id", first.documentId!);
    expect(count).toBe(2);
  });

  it("stores a video in the private videos bucket with its delivery condition", async () => {
    const uploadId = await upload(MP4, {
      name: "message.mp4",
      mimeType: "video/mp4",
      kind: "VIDEO",
    });

    const outcome = await complete(uploadId, {
      title: "For my family",
      deliveryCondition: "DEAD_MAN_SWITCH",
    });

    expect(outcome.status).toBe("PROMOTED");
    expect(outcome.videoId).toBeTruthy();
    expect((await statObject(BUCKETS.videos, uploadObjectKey(user.id, uploadId)))?.sizeBytes).toBe(
      MP4.byteLength,
    );
    const { data } = await createServiceScopedClient()
      .from("video_messages")
      .select("scan_status, storage_bucket, delivery_condition, title")
      .eq("id", outcome.videoId!)
      .single();
    expect(data).toMatchObject({
      scan_status: "NOT_SCANNED",
      storage_bucket: "videos",
      delivery_condition: "DEAD_MAN_SWITCH",
      title: "For my family",
    });
  });

  it("keeps the stored file private: only a freshly signed URL reads it", async () => {
    const uploadId = await upload(PDF, { name: "private.pdf", mimeType: "application/pdf" });
    await complete(uploadId);
    const key = uploadObjectKey(user.id, uploadId);
    const base = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";

    expect((await fetch(`${base}/storage/v1/object/public/documents/${key}`)).ok).toBe(false);
    expect((await fetch(`${base}/storage/v1/object/documents/${key}`)).ok).toBe(false);

    const signed = await createSignedDownloadUrl(BUCKETS.documents, key, { expiresInSeconds: 60 });
    const response = await fetch(signed.url);
    expect(response.ok).toBe(true);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
  });
});

describe.skipIf(!available)("upload authorization", () => {
  it("refuses to complete or read another user's upload", async () => {
    const uploadId = await upload(PDF, { name: "mine.pdf", mimeType: "application/pdf" });

    await expect(
      uploadService.completeUpload(as("intruder"), uploadId, {}, "test-correlation"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(uploadService.getUploadStatus(as("intruder"), uploadId)).rejects.toMatchObject({
      status: 404,
    });

    // The intruder's attempt changed nothing; the owner can still finish it.
    expect(await sessionStatus(uploadId)).toBe("PENDING");
    expect((await complete(uploadId)).status).toBe("PROMOTED");
  });

  it("refuses a new version of, or a folder belonging to, another user", async () => {
    const theirs = await complete(
      await upload(PDF, { name: "owner-only.pdf", mimeType: "application/pdf" }),
    );

    await expect(
      uploadService.createUploadSession(
        as("intruder"),
        {
          kind: "DOCUMENT_VERSION",
          documentId: theirs.documentId,
          name: "replacement.pdf",
          mimeType: "application/pdf",
          sizeBytes: PDF.byteLength,
        },
        "test-correlation",
      ),
    ).rejects.toMatchObject({ status: 404 });

    const { data: folder } = await createServiceScopedClient()
      .from("folders")
      .insert({ user_id: user.id, name: `Private ${crypto.randomUUID()}` })
      .select("id")
      .single();
    await expect(
      uploadService.createUploadSession(
        as("intruder"),
        {
          kind: "DOCUMENT",
          folderId: (folder as { id: string }).id,
          name: "sneaky.pdf",
          mimeType: "application/pdf",
          sizeBytes: PDF.byteLength,
        },
        "test-correlation",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an account that is scheduled for deletion", async () => {
    await expect(
      uploadService.createUploadSession(
        { ...as("owner"), deletionRequestedAt: new Date().toISOString() },
        { kind: "DOCUMENT", name: "late.pdf", mimeType: "application/pdf", sizeBytes: 10 },
        "test-correlation",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses an undeclared type or an oversized declaration before any URL is issued", async () => {
    await expect(
      uploadService.createUploadSession(
        as("owner"),
        { kind: "DOCUMENT", name: "tool.exe", mimeType: "application/x-msdownload", sizeBytes: 10 },
        "test-correlation",
      ),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });

    await expect(
      uploadService.createUploadSession(
        as("owner"),
        { kind: "DOCUMENT", name: "huge.pdf", mimeType: "application/pdf", sizeBytes: 52_428_801 },
        "test-correlation",
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe.skipIf(!available)("rejections, retries and races", () => {
  it("rejects an executable renamed to .pdf and deletes its bytes", async () => {
    const executable = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const uploadId = await upload(executable, { name: "deed.pdf", mimeType: "application/pdf" });

    const outcome = await complete(uploadId);

    expect(outcome).toMatchObject({ status: "REJECTED", retryable: false });
    expect(outcome.rejectionReason).toMatch(/do not match/);
    expect(await statObject(BUCKETS.documents, uploadObjectKey(user.id, uploadId))).toBeNull();
    expect(await auditActions(uploadId)).toContainEqual({
      action: "upload.rejected",
      outcome: "FAILURE",
    });
    await expect(complete(uploadId)).rejects.toMatchObject({ status: 409 });
  });

  it("is refused by the bucket when more arrives than its limit, and never promoted", async () => {
    const ticket = await uploadService.createUploadSession(
      as("owner"),
      { kind: "DOCUMENT", name: "small.pdf", mimeType: "application/pdf", sizeBytes: 1_024 },
      "test-correlation",
    );
    const big = new Uint8Array(51 * 1_048_576);
    big.set(PDF);
    expect((await put(ticket.uploadUrl, big, "application/pdf")).ok).toBe(false);

    const outcome = await complete(ticket.uploadId);
    expect(outcome.status).toBe("REJECTED");
    expect(outcome.rejectionReason).toMatch(/No file was uploaded/);
  }, 120_000);

  it("runs the pipeline once when two completions race", async () => {
    const name = `race-${crypto.randomUUID()}.pdf`;
    const uploadId = await upload(PDF, { name, mimeType: "application/pdf" });

    const settled = await Promise.allSettled([complete(uploadId), complete(uploadId)]);
    const outcomes = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => (result as PromiseFulfilledResult<{ status: string }>).value);

    // Exactly one promotion; the other either saw it in progress or was refused.
    expect(outcomes.filter((outcome) => outcome.status === "PROMOTED")).toHaveLength(1);
    const { count } = await createServiceScopedClient()
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("name", name);
    expect(count).toBe(1);
  });

  it("reports a completion abandoned mid-way as retryable, and lets a retry reclaim it", async () => {
    const uploadId = await upload(PDF, { name: "stuck.pdf", mimeType: "application/pdf" });
    // A request died after claiming the session.
    await createServiceScopedClient()
      .from("upload_sessions")
      .update({ status: "VALIDATING" })
      .eq("id", uploadId);

    // Fresh, it is someone else's work in progress — not retryable yet.
    expect(await uploadService.getUploadStatus(as("owner"), uploadId)).toMatchObject({
      inProgress: true,
      retryable: false,
    });
    expect(await complete(uploadId)).toMatchObject({ inProgress: true });

    // Once it has been silent past the staleness window, it is reclaimable.
    // Only `Date` moves; timers and I/O stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + uploadService.STALE_IN_PROGRESS_MS + 60_000);
      expect(await uploadService.getUploadStatus(as("owner"), uploadId)).toMatchObject({
        inProgress: false,
        retryable: true,
      });
      expect((await complete(uploadId)).status).toBe("PROMOTED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the bytes and offers a retry when promotion itself fails", async () => {
    const target = await complete(
      await upload(PDF, { name: "versioned.pdf", mimeType: "application/pdf" }),
    );
    const uploadId = await upload(PDF, {
      name: "versioned-v2.pdf",
      mimeType: "application/pdf",
      kind: "DOCUMENT_VERSION",
      documentId: target.documentId,
    });
    // The target disappears between the session and its completion.
    await createServiceScopedClient()
      .from("documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", target.documentId!);

    await expect(complete(uploadId)).rejects.toBeTruthy();

    expect(await sessionStatus(uploadId)).toBe("UPLOADED");
    expect(await uploadService.getUploadStatus(as("owner"), uploadId)).toMatchObject({
      retryable: true,
      inProgress: false,
    });
    // Held privately, unpromoted: no version points at it.
    const key = uploadObjectKey(user.id, uploadId);
    expect(await statObject(BUCKETS.documents, key)).not.toBeNull();
    const { count } = await createServiceScopedClient()
      .from("document_versions")
      .select("id", { count: "exact", head: true })
      .eq("storage_key", key);
    expect(count).toBe(0);
  });

  it("expires a stale session, removes its bytes and refuses to complete it", async () => {
    const uploadId = await upload(PDF, { name: "late.pdf", mimeType: "application/pdf" });
    await createServiceScopedClient()
      .from("upload_sessions")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", uploadId);

    await expect(complete(uploadId)).rejects.toMatchObject({ status: 409 });

    expect(await sessionStatus(uploadId)).toBe("EXPIRED");
    expect(await statObject(BUCKETS.documents, uploadObjectKey(user.id, uploadId))).toBeNull();
    expect(await uploadService.getUploadStatus(as("owner"), uploadId)).toMatchObject({
      status: "EXPIRED",
      retryable: false,
      inProgress: false,
    });
  });
});

describe.skipIf(!available)("daily sweep of abandoned uploads", () => {
  const service = () => createServiceScopedClient();

  async function backdate(uploadId: string) {
    const past = new Date(Date.now() - 7 * 3_600_000).toISOString();
    await service().from("upload_sessions").update({ created_at: past }).eq("id", uploadId);
  }

  /** The sweep handles 200 sessions per pass; older local runs may queue more. */
  async function sweepUntilClosed(uploadIds: string[]) {
    for (let pass = 0; pass < 20; pass += 1) {
      const summary = await runHousekeeping(service() as never);
      const statuses = await Promise.all(uploadIds.map(sessionStatus));
      if (summary.uploadsExpired === 0 || statuses.every((status) => status === "EXPIRED")) return;
    }
  }

  it("removes the bytes of an abandoned upload and never touches a promoted file", async () => {
    const abandoned = await upload(PDF, { name: "abandoned.pdf", mimeType: "application/pdf" });
    const promotedUpload = await upload(PDF, { name: "kept.pdf", mimeType: "application/pdf" });
    expect((await complete(promotedUpload)).status).toBe("PROMOTED");

    // A session that claims to be unfinished although a row points at its
    // object: the sweep closes it but must keep the bytes.
    const inconsistent = await upload(PDF, { name: "guarded.pdf", mimeType: "application/pdf" });
    expect((await complete(inconsistent)).status).toBe("PROMOTED");
    await service().from("upload_sessions").update({ status: "VALIDATED" }).eq("id", inconsistent);

    for (const id of [abandoned, promotedUpload, inconsistent]) await backdate(id);
    await sweepUntilClosed([abandoned, inconsistent]);

    expect(await sessionStatus(abandoned)).toBe("EXPIRED");
    expect(await statObject(BUCKETS.documents, uploadObjectKey(user.id, abandoned))).toBeNull();

    expect(await sessionStatus(promotedUpload)).toBe("PROMOTED");
    expect(
      await statObject(BUCKETS.documents, uploadObjectKey(user.id, promotedUpload)),
    ).not.toBeNull();

    expect(await sessionStatus(inconsistent)).toBe("EXPIRED");
    expect(
      await statObject(BUCKETS.documents, uploadObjectKey(user.id, inconsistent)),
    ).not.toBeNull();
  }, 120_000);
});
