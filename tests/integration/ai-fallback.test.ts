import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setAIProviderForTesting } from "@/lib/ai";
import { ndjsonStreamResponse } from "@/lib/api/ndjson-stream";
import { ApiError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { resetEnvGroupCache } from "@/lib/config/env";
import * as assistant from "@/lib/services/ai/assistant.service";
import * as documentAi from "@/lib/services/ai/document-ai.service";
import { pingScanner } from "@/lib/services/malware-scanner";
import * as uploadService from "@/lib/services/upload.service";
import { BUCKETS } from "@/lib/storage/storage";

import {
  createServiceScopedClient,
  createUserScopedClient,
  ensureTestUser,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * Provider failover through the real assistant path: the real service, the
 * real database (usage records), the real upload pipeline with ClamAV for the
 * attachment, and the real Gemini and OpenAI-compatible adapters with their
 * SDKs. Only the vendors' HTTP endpoints are scripted — every other request
 * (Supabase) goes to the real local stack.
 *
 * These are deterministic failure-path tests: quota exhaustion, transient
 * errors, timeouts and a stream cut off mid-answer. They are NOT evidence that
 * OpenRouter or Groq work for real; no key for either exists here.
 */
const SUBJECT = "user_ai_fallback";

const clients = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/server")>();
  return { ...actual, createUserClient: async () => clients.current };
});

const available =
  (await isLocalStackAvailable()) &&
  process.env.MALWARE_SCANNER_PROVIDER === "clamav" &&
  (await pingScanner()).status === "ok";
if (!available) {
  console.warn(
    "[ai-fallback] local stack or ClamAV unreachable — assertions are SKIPPED, not passed.",
  );
}

type Vendor = "gemini" | "openrouter" | "groq";
type Script = (url: string, body: string) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
const scripts: Partial<Record<Vendor, Script>> = {};
const hits: { vendor: Vendor; body: string }[] = [];

function vendorOf(url: string): Vendor | null {
  if (url.includes("generativelanguage.googleapis.com")) return "gemini";
  if (url.includes("openrouter.ai")) return "openrouter";
  if (url.includes("api.groq.com")) return "groq";
  return null;
}

const GEMINI_DAILY_QUOTA = () =>
  new Response(
    JSON.stringify({
      error: {
        code: 429,
        message: "You exceeded your current quota … (vendor text that must never be logged)",
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              { quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" },
            ],
          },
        ],
      },
    }),
    { status: 429, headers: { "Content-Type": "application/json" } },
  );

function chatStream(parts: string[], finished = true) {
  const events = parts.map(
    (content, index) =>
      `data: ${JSON.stringify({
        id: "c",
        object: "chat.completion.chunk",
        created: 1,
        model: "m",
        choices: [
          {
            index: 0,
            delta: { content },
            finish_reason: finished && index === parts.length - 1 ? "stop" : null,
          },
        ],
      })}\n\n`,
  );
  return new Response(events.join("") + (finished ? "data: [DONE]\n\n" : ""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const overloaded = () =>
  new Response(JSON.stringify({ error: { message: "overloaded", code: null } }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });

let user: AppUser;
let imageId = "";

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

function configure(documents?: string) {
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  vi.stubEnv("OPENROUTER_MODEL", "qwen/qwen3.8-27b:free");
  vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-120b");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AI_PROVIDER_ORDER", "gemini,openrouter,groq");
  vi.stubEnv("AI_DOCUMENT_PROVIDERS", documents ?? "");
  resetEnvGroupCache();
}

async function reply(attachmentIds: string[] = [], message = "What is 2 + 2?") {
  const { stream, onComplete } = await assistant.streamAssistantReply(
    user,
    { message, history: [], attachmentIds },
    "test-correlation",
  );
  let text = "";
  for await (const delta of stream.deltas) text += delta;
  await onComplete((await stream.result).usage);
  return { text, provider: stream.provider, model: stream.model };
}

async function latestUsage() {
  const { data } = await createServiceScopedClient()
    .from("ai_interactions")
    .select("provider, model, input_summary")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data;
}

beforeAll(async () => {
  if (!available) return;
  setAIProviderForTesting(null);
  const service = createServiceScopedClient();
  const id = await ensureTestUser(service, SUBJECT);
  user = {
    id,
    clerkUserId: SUBJECT,
    email: `${SUBJECT}@example.com`,
    emailVerified: true,
    name: SUBJECT,
    mfaEnabled: false,
    role: "USER",
    onboardingCompletedAt: new Date().toISOString(),
    deletionRequestedAt: null,
  };
  clients.current = await createUserScopedClient(SUBJECT);

  // A real photo through the real pipeline, before any vendor is scripted.
  const ticket = await uploadService.createUploadSession(
    user,
    { kind: "DOCUMENT", name: "notice.png", mimeType: "image/png", sizeBytes: PNG.byteLength },
    "test",
  );
  await realFetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: PNG as Uint8Array<ArrayBuffer>,
  });
  const outcome = await uploadService.completeUpload(user, ticket.uploadId, {}, "test");
  expect(outcome).toMatchObject({ status: "PROMOTED", scan: { provider: "clamav" } });
  imageId = outcome.documentId!;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const vendor = vendorOf(url);
    if (!vendor) return realFetch(input, init);
    const body = typeof init?.body === "string" ? init.body : "";
    hits.push({ vendor, body });
    const script = scripts[vendor];
    if (!script) throw new Error(`unscripted call to ${vendor}`);
    return script(url, body);
  });
}, 120_000);

beforeEach(() => {
  hits.length = 0;
  for (const key of Object.keys(scripts)) delete scripts[key as Vendor];
  documentAi.clearExtractionCache();
  vi.unstubAllEnvs();
  configure();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetEnvGroupCache();
  if (!available) return;
  const service = createServiceScopedClient();
  const { data } = await service.from("documents").select("storage_key").eq("user_id", user.id);
  const keys = (data ?? []).map((row) => row.storage_key);
  if (keys.length) await service.storage.from(BUCKETS.documents).remove(keys);
  await service.from("rate_limits").delete().like("key", `%${user.id}`);
});

const count = (vendor: Vendor) => hits.filter((hit) => hit.vendor === vendor).length;

describe.skipIf(!available)("AI provider failover", () => {
  it("answers from OpenRouter when Gemini's daily quota is spent — and does not retry the quota", async () => {
    scripts.gemini = GEMINI_DAILY_QUOTA;
    scripts.openrouter = () => chatStream(["2 + 2 ", "= 4."]);

    const answer = await reply();

    expect(answer).toMatchObject({
      text: "2 + 2 = 4.",
      provider: "openrouter",
      model: "qwen/qwen3.8-27b:free",
    });
    expect(count("gemini")).toBe(1);
    expect(count("groq")).toBe(0);
    expect(await latestUsage()).toMatchObject({
      provider: "openrouter",
      model: "qwen/qwen3.8-27b:free",
    });
  });

  it("moves past a provider whose 5xx outlasts its bounded retries", async () => {
    scripts.gemini = GEMINI_DAILY_QUOTA;
    scripts.openrouter = overloaded;
    scripts.groq = () => chatStream(["4"]);

    const answer = await reply();

    expect(answer.provider).toBe("groq");
    expect(count("openrouter")).toBe(3); // bounded: three attempts, then fail over
  }, 60_000);

  it("fails over on a timeout", async () => {
    scripts.gemini = () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    scripts.openrouter = () => chatStream(["4"]);

    const answer = await reply();
    expect(answer.provider).toBe("openrouter");
  }, 60_000);

  it("ends a stream cut off mid-answer with one clear error event, without vendor text", async () => {
    scripts.gemini = GEMINI_DAILY_QUOTA;
    scripts.openrouter = () => chatStream(["The answer is"], false);

    const { stream, onComplete } = await assistant.streamAssistantReply(
      user,
      { message: "Explain", history: [], attachmentIds: [] },
      "test-correlation",
    );
    const body = await ndjsonStreamResponse(stream, onComplete).text();
    const events = body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; message?: string });

    expect(events.map((event) => event.type)).toEqual(["delta", "error"]);
    expect(events[1]?.message).toMatch(/stopped partway/);
    expect(body).not.toContain("vendor text");
  });

  it("reports the honest quota message when every provider is exhausted", async () => {
    scripts.gemini = GEMINI_DAILY_QUOTA;
    scripts.openrouter = () =>
      new Response(
        JSON.stringify({
          error: { code: 429, message: "Rate limit exceeded: free-models-per-day" },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    scripts.groq = () =>
      new Response(JSON.stringify({ error: { message: "limit", code: "rate_limit_exceeded" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "x-ratelimit-remaining-requests": "0" },
      });

    const error = await reply().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toMatch(/usage limit for today/);
    expect([count("gemini"), count("openrouter"), count("groq")]).toEqual([1, 1, 1]);
  });

  it("keeps an attached vault photo away from fallbacks not approved for documents", async () => {
    scripts.gemini = GEMINI_DAILY_QUOTA;
    scripts.openrouter = () => chatStream(["should never be asked"]);
    scripts.groq = () => chatStream(["should never be asked"]);

    const error = await reply([imageId], "Describe this photo").catch((e: unknown) => e);

    expect((error as ApiError).message).toMatch(/usage limit for today/);
    expect(count("gemini")).toBe(1);
    expect(count("openrouter")).toBe(0);
    expect(count("groq")).toBe(0);
  });

  it("sends the photo, as the photo, only to an approved fallback that can read images", async () => {
    configure("gemini,openrouter,groq");
    scripts.gemini = GEMINI_DAILY_QUOTA;
    scripts.openrouter = () => chatStream(["A small image."]);
    scripts.groq = () => chatStream(["text-only model must not be asked"]);

    const answer = await reply([imageId], "Describe this photo");

    expect(answer.provider).toBe("openrouter");
    const sent = hits.find((hit) => hit.vendor === "openrouter")!.body;
    expect(sent).toContain(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
    expect(count("groq")).toBe(0);
    expect((await latestUsage())?.input_summary).toContain("1 attachments (image)");
  });
});
