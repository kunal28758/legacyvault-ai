import "server-only";

import { NextResponse } from "next/server";

import { AIProviderError, type AIStream, type AIUsage } from "@/lib/ai/provider";
import { logger } from "@/lib/observability/logger";
import { toAIApiError } from "@/lib/services/ai/errors";
import type { ChatStreamEvent } from "@/lib/types/ai";

/**
 * Streams model output as newline-delimited JSON (`application/x-ndjson`).
 *
 * One `ChatStreamEvent` per line: `delta` events carry text as it arrives, and
 * the stream always ends with exactly one `done` or `error` event, so the
 * browser never has to guess whether an answer finished. A provider failure
 * mid-answer becomes an `error` event with a safe message; the vendor's text
 * never reaches the client. `withApi()` adds the correlation id and no-store
 * headers to the response.
 */
export function ndjsonStreamResponse(
  stream: AIStream,
  onComplete: (usage: AIUsage) => Promise<void>,
): NextResponse {
  const encoder = new TextEncoder();
  const line = (event: ChatStreamEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const text of stream.deltas) {
          controller.enqueue(line({ type: "delta", text }));
        }
        const { usage, truncated } = await stream.result;
        controller.enqueue(
          line({ type: "done", truncated, provider: stream.provider, model: stream.model }),
        );
        await onComplete(usage);
      } catch (cause) {
        const cancelled = cause instanceof AIProviderError && cause.kind === "CANCELLED";
        if (!cancelled) logger.warn({ err: cause }, "AI stream failed");
        const error = toAIApiError(cause);
        try {
          controller.enqueue(line({ type: "error", code: error.code, message: error.message }));
        } catch {
          // The client has gone; there is nobody to tell.
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a cancelled client.
        }
      }
    },
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      // Proxies must not buffer a streamed answer.
      "X-Accel-Buffering": "no",
    },
  });
}
