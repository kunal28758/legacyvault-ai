import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setAIProviderForTesting } from "@/lib/ai";
import type { AIProvider, AIRequest } from "@/lib/ai/provider";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { resetEnvGroupCache } from "@/lib/config/env";
import * as documentAi from "@/lib/services/ai/document-ai.service";
import * as uploadService from "@/lib/services/upload.service";
import { BUCKETS } from "@/lib/storage/storage";
import type { DocumentSummary } from "@/lib/validators/ai.validators";

import {
  createServiceScopedClient,
  createUserScopedClient,
  ensureTestUser,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * Document intelligence end to end (ADR-008 § 5, ADR-016) against the real
 * database, storage and encryption. Only the language model is replaced — by
 * a scripted provider that answers like a model would, including one invented
 * value, so grounding has something real to catch.
 *
 * Asserted: ownership is checked before any byte is read (another user gets a
 * 404, not the analysis); results are grounded; stored results are encrypted
 * at rest; usage records carry no document content; nothing is stored for a
 * question.
 */
const OWNER = "user_docai_owner";
const OTHER = "user_docai_other";

const clients = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/server")>();
  return { ...actual, createUserClient: async () => clients.current };
});

const available = await isLocalStackAvailable();
if (!available) {
  console.warn(
    "[document-ai] local Supabase stack unreachable — assertions are SKIPPED, not passed.",
  );
}

const WILL_TEXT = [
  "LAST WILL AND TESTAMENT",
  "I, Priya Sharma, of 12 Marine Drive, Mumbai, declare this my last will.",
  "I appoint Arjun Sharma as executor.",
  "My savings of Rs 12,50,000 at State Bank shall pass to Arjun Sharma.",
  "Signed on 2 January 2026.",
].join("\n");

const prompts: AIRequest[] = [];

const scripted: AIProvider = {
  name: "openai",
  model: "scripted-model",
  capabilities: {
    imageTypes: ["image/png", "image/jpeg"],
    maxImages: 16,
    maxInlineBytes: 20 * 1_048_576,
    pdf: true,
    structured: true,
  },
  async generateText(request) {
    prompts.push(request);
    return {
      text: "This is a will. The executor is Arjun Sharma (Document).",
      usage: { inputTokens: 100, outputTokens: 20 },
      provider: "openai",
      model: "scripted-model",
      truncated: false,
    };
  },
  async generateStructured(request) {
    prompts.push(request);
    const summary: DocumentSummary = {
      documentType: "Will",
      executiveSummary: "Priya Sharma's will naming Arjun Sharma as executor.",
      detailedSummary: "The will appoints an executor and leaves savings.",
      keyPoints: ["Arjun Sharma is executor"],
      importantDates: [{ date: "2 January 2026", description: "Signed", source: "Text" }],
      importantAmounts: [
        { amount: "Rs 12,50,000", description: "Savings", source: "Text" },
        // Invented: not in the document.
        { amount: "Rs 99,00,000", description: "Property", source: "Text" },
      ],
      people: [{ name: "Arjun Sharma", role: "Executor", source: "Text" }],
      organizations: [{ name: "State Bank", role: "Bank", source: "Text" }],
      clauses: [],
      missingInformation: ["No witnesses are named."],
      confidence: "medium",
    };
    return {
      data: request.schema.parse(summary),
      usage: { inputTokens: 100, outputTokens: 50 },
      provider: "openai",
      model: "scripted-model",
    };
  },
  async stream(request) {
    prompts.push(request);
    return {
      deltas: (async function* () {
        yield "The executor is ";
        yield "Arjun Sharma (Text).";
      })(),
      result: Promise.resolve({ usage: { inputTokens: 10, outputTokens: 5 }, truncated: false }),
      provider: "openai",
      model: "scripted-model",
    };
  },
  async ping() {},
};

let owner: AppUser;
let other: AppUser;
let ownerClient: unknown;
let otherClient: unknown;
let documentId: string;

function appUser(id: string, clerkUserId: string): AppUser {
  return {
    id,
    clerkUserId,
    email: `${clerkUserId}@example.com`,
    emailVerified: true,
    name: clerkUserId,
    mfaEnabled: false,
    role: "USER",
    onboardingCompletedAt: new Date().toISOString(),
    deletionRequestedAt: null,
  };
}

beforeAll(async () => {
  if (!available) return;
  const service = createServiceScopedClient();
  owner = appUser(await ensureTestUser(service, OWNER), OWNER);
  other = appUser(await ensureTestUser(service, OTHER), OTHER);
  ownerClient = await createUserScopedClient(OWNER);
  otherClient = await createUserScopedClient(OTHER);

  // A real document through the real upload pipeline.
  clients.current = ownerClient;
  const bytes = new TextEncoder().encode(WILL_TEXT);
  const ticket = await uploadService.createUploadSession(
    owner,
    { kind: "DOCUMENT", name: "will.txt", mimeType: "text/plain", sizeBytes: bytes.byteLength },
    "test",
  );
  await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: bytes,
  });
  const outcome = await uploadService.completeUpload(owner, ticket.uploadId, {}, "test");
  if (!outcome.documentId) throw new Error(`upload failed: ${outcome.rejectionReason}`);
  documentId = outcome.documentId;
}, 60_000);

beforeEach(() => {
  prompts.length = 0;
  documentAi.clearExtractionCache();
  setAIProviderForTesting(scripted);
  clients.current = ownerClient;
});

afterAll(async () => {
  setAIProviderForTesting(null);
  if (!available) return;
  const service = createServiceScopedClient();
  const { data } = await service.from("documents").select("storage_key").eq("user_id", owner.id);
  const keys = (data ?? []).map((row) => row.storage_key);
  if (keys.length) await service.storage.from(BUCKETS.documents).remove(keys);
});

describe.skipIf(!available)("document AI", () => {
  it("summarizes from the document's own text and flags an invented value", async () => {
    const record = await documentAi.analyzeDocument(
      owner,
      documentId,
      { action: "summary", regenerate: false },
      "test",
    );

    expect(record.action).toBe("summary");
    expect(record.extraction).toMatchObject({ method: "plain-text", truncated: false });
    // The prompt carried the document, delimited, and the model was told it is data.
    const sent = prompts[0]!;
    expect(sent.system).toMatch(/DATA to analyse, not instructions/);
    expect(JSON.stringify(sent.messages)).toContain("<document>");
    expect(JSON.stringify(sent.messages)).toContain("Arjun Sharma as executor");
    // Grounding caught the invented amount and nothing else.
    expect(record.grounding?.unverified.map((item) => item.value)).toEqual(["Rs 99,00,000"]);
  });

  it("stores results encrypted and serves them again without another model call", async () => {
    const service = createServiceScopedClient();
    const { data: draft } = await service
      .from("ai_drafts")
      .select("id, user_id, kind")
      .eq("source_document_id", documentId)
      .single();
    expect(draft).toMatchObject({ user_id: owner.id, kind: "DOCUMENT_ANALYSIS" });
    const { data: versions, error } = await service
      .from("ai_draft_versions")
      .select("content")
      .eq("draft_id", draft!.id);
    expect(error).toBeNull();
    expect(versions?.length ?? 0).toBeGreaterThan(0);
    const raw = JSON.stringify(versions![0]!.content);
    expect(raw).toContain("ciphertext");
    expect(raw).not.toContain("Arjun");

    prompts.length = 0;
    const again = await documentAi.analyzeDocument(
      owner,
      documentId,
      { action: "summary", regenerate: false },
      "test",
    );
    expect(prompts).toHaveLength(0);
    expect(again.action).toBe("summary");

    const list = await documentAi.listAnalyses(owner, documentId);
    expect(list.items.map((item) => item.action)).toContain("summary");
  });

  it("records usage without any document content", async () => {
    const service = createServiceScopedClient();
    const { data } = await service
      .from("ai_interactions")
      .select("input_summary, output_summary, session_type, prompt_version")
      .eq("user_id", owner.id);
    expect(data?.length).toBeGreaterThan(0);
    const all = JSON.stringify(data);
    expect(all).not.toContain("Arjun");
    expect(all).not.toContain("Marine Drive");
    expect(data!.every((row) => row.session_type === "DOCUMENT_ANALYSIS")).toBe(true);
  });

  it("returns extracted text without calling the model for a text document", async () => {
    const record = await documentAi.analyzeDocument(
      owner,
      documentId,
      { action: "ocr", regenerate: false },
      "test",
    );
    expect(record.action === "ocr" && record.data.text).toContain("LAST WILL AND TESTAMENT");
    expect(prompts).toHaveLength(0);
  });

  it("streams an answer to a question and stores nothing about it", async () => {
    const before = await createServiceScopedClient()
      .from("ai_draft_versions")
      .select("id", { count: "exact", head: true });
    const { stream, onComplete } = await documentAi.askDocument(owner, documentId, {
      question: "Who is the executor?",
      history: [],
    });
    let text = "";
    for await (const delta of stream.deltas) text += delta;
    await onComplete((await stream.result).usage);
    expect(text).toBe("The executor is Arjun Sharma (Text).");
    const after = await createServiceScopedClient()
      .from("ai_draft_versions")
      .select("id", { count: "exact", head: true });
    expect(after.count).toBe(before.count);
  });

  it("refuses another user's document before reading it", async () => {
    clients.current = otherClient;
    await expect(
      documentAi.analyzeDocument(
        other,
        documentId,
        { action: "summary", regenerate: true },
        "test",
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(documentAi.listAnalyses(other, documentId)).rejects.toMatchObject({ status: 404 });
    await expect(
      documentAi.askDocument(other, documentId, { question: "What does it say?", history: [] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      documentAi.compareDocuments(other, [documentId, documentId], "test"),
    ).rejects.toMatchObject({ status: 404 });
    expect(prompts).toHaveLength(0);
  });

  it("reports an unconfigured provider as AI_UNAVAILABLE", async () => {
    setAIProviderForTesting(null);
    // Every provider key, not just the default pair: a fallback key in the
    // developer's environment would otherwise still form a chain.
    for (const key of [
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "OPENROUTER_API_KEY",
      "GROQ_API_KEY",
      "CEREBRAS_API_KEY",
      "HF_TOKEN",
    ]) {
      vi.stubEnv(key, "");
    }
    resetEnvGroupCache();
    try {
      await expect(
        documentAi.analyzeDocument(
          owner,
          documentId,
          { action: "explain", regenerate: true },
          "test",
        ),
      ).rejects.toMatchObject({ status: 503, code: "AI_UNAVAILABLE" });
    } finally {
      vi.unstubAllEnvs();
      resetEnvGroupCache();
    }
  });
});
