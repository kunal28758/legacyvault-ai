import { beforeAll, describe, expect, it } from "vitest";

import {
  BUCKETS,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  readObjectHead,
  removeObject,
  statObject,
  uploadBucketFor,
  uploadObjectKey,
} from "@/lib/storage/storage";

import { createServiceScopedClient, isLocalStackAvailable } from "../helpers/db";

/**
 * Private storage against the real local Supabase stack (ADR-005).
 *
 * The properties asserted here are the ones the upload pipeline depends on:
 * the buckets are private, a signed URL is the only way in or out, the bucket
 * itself refuses a type outside its allow-list, and the object that arrives can
 * be measured and sniffed without downloading it whole.
 */
const available = await isLocalStackAvailable();

if (!available) {
  console.warn(
    "[storage] local Supabase stack unreachable — start it with `pnpm db:start`. Storage assertions are SKIPPED, not passed.",
  );
}

const OWNER = "00000000-0000-4000-8000-00000000st01";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x41]);

beforeAll(async () => {
  if (!available) return;
  // The migration creates them; this asserts the deployment actually ran it.
  const service = createServiceScopedClient();
  const { data, error } = await service.storage.listBuckets();
  if (error) throw error;
  const names = new Set((data ?? []).map((bucket) => bucket.name));
  for (const bucket of Object.values(BUCKETS)) {
    if (!names.has(bucket)) {
      throw new Error(`bucket ${bucket} is missing — apply supabase/migrations/0004`);
    }
  }
}, 60_000);

describe.skipIf(!available)("storage buckets", () => {
  it("keeps every bucket private, including the retired quarantine bucket", async () => {
    const service = createServiceScopedClient();
    const { data } = await service.storage.listBuckets();
    expect(data?.length).toBeGreaterThan(0);
    for (const bucket of data ?? []) expect(bucket.public).toBe(false);
  });

  it("derives an owner-prefixed key that a filename cannot escape", () => {
    const key = uploadObjectKey(OWNER, "11111111-1111-4111-8111-111111111111");
    expect(key).toBe(`${OWNER}/11111111-1111-4111-8111-111111111111`);
    expect(key).not.toContain("..");
  });

  it("sends each upload kind to its own private bucket", () => {
    expect(uploadBucketFor("DOCUMENT")).toBe(BUCKETS.documents);
    expect(uploadBucketFor("DOCUMENT_VERSION")).toBe(BUCKETS.documents);
    expect(uploadBucketFor("VIDEO")).toBe(BUCKETS.videos);
  });
});

describe.skipIf(!available)("upload, read and delete", () => {
  it("round-trips an object through private storage", async () => {
    const uploadId = crypto.randomUUID();
    const key = uploadObjectKey(OWNER, uploadId);

    // 1. A signed URL is the only way to put bytes in.
    const upload = await createSignedUploadUrl(BUCKETS.documents, key);
    expect(upload.url).toContain("/object/upload/sign/");

    const put = await fetch(upload.url, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: PDF_BYTES,
    });
    expect(put.ok).toBe(true);

    // 2. The object is measured as stored, not as declared.
    const stat = await statObject(BUCKETS.documents, key);
    expect(stat?.sizeBytes).toBe(PDF_BYTES.byteLength);

    // 3. Only the leading bytes are read, for the magic-byte check.
    const head = await readObjectHead(BUCKETS.documents, key, 8);
    expect(Array.from(head.subarray(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);

    // 4. Reading it back needs a fresh signed URL.
    const download = await createSignedDownloadUrl(BUCKETS.documents, key, {
      expiresInSeconds: 60,
    });
    const fetched = await fetch(download.url);
    expect(fetched.ok).toBe(true);
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(PDF_BYTES);
    expect(Date.parse(download.expiresAt)).toBeGreaterThan(Date.now());

    // 5. Deletion actually removes the bytes.
    await removeObject(BUCKETS.documents, key);
    expect(await statObject(BUCKETS.documents, key)).toBeNull();
  }, 60_000);

  it("refuses, at the bucket, a content type outside its allow-list", async () => {
    const key = uploadObjectKey(OWNER, crypto.randomUUID());
    const upload = await createSignedUploadUrl(BUCKETS.documents, key);
    const put = await fetch(upload.url, {
      method: "PUT",
      headers: { "content-type": "application/x-msdownload" },
      body: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
    });
    expect(put.ok).toBe(false);
    expect(await statObject(BUCKETS.documents, key)).toBeNull();
  }, 60_000);

  it("refuses an unsigned request to a private object", async () => {
    const key = uploadObjectKey(OWNER, crypto.randomUUID());
    const upload = await createSignedUploadUrl(BUCKETS.documents, key);
    await fetch(upload.url, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: PDF_BYTES,
    });

    // Neither the public endpoint nor an unauthenticated read may serve it.
    const base = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
    const direct = await fetch(`${base}/storage/v1/object/public/${BUCKETS.documents}/${key}`);
    expect(direct.ok).toBe(false);
    const unsigned = await fetch(`${base}/storage/v1/object/${BUCKETS.documents}/${key}`);
    expect(unsigned.ok).toBe(false);

    await removeObject(BUCKETS.documents, key);
  }, 60_000);

  it("reports a missing object rather than throwing", async () => {
    expect(await statObject(BUCKETS.documents, `${OWNER}/does-not-exist`)).toBeNull();
  });
});
