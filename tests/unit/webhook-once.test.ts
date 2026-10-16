// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { TypedSupabaseClient } from "@/lib/db/server";
import { processWebhookOnce } from "@/lib/repositories/webhook.repository";

/** Just enough of the client: record_webhook_event()'s unique record and its removal. */
function fakeDb() {
  const recorded = new Set<string>();
  const db = {
    rpc: async (_name: string, args: { p_provider: string; p_event_id: string }) => {
      const key = `${args.p_provider}:${args.p_event_id}`;
      const isNew = !recorded.has(key);
      recorded.add(key);
      return { data: isNew, error: null };
    },
    from: () => {
      const filters: Record<string, string> = {};
      const chain = {
        delete: () => chain,
        eq: (column: string, value: string) => {
          filters[column] = value;
          if (filters.provider && filters.event_id)
            recorded.delete(`${filters.provider}:${filters.event_id}`);
          return chain;
        },
      };
      return chain;
    },
  };
  return db as unknown as TypedSupabaseClient;
}

const EVENT = { provider: "CLERK", id: "msg_1", type: "user.deleted" } as const;

describe("processWebhookOnce", () => {
  it("processes a delivery once and acknowledges its replay without processing it", async () => {
    const db = fakeDb();
    let runs = 0;
    const handle = async () => ++runs;
    expect(await processWebhookOnce(db, EVENT, handle)).toEqual({ duplicate: false, result: 1 });
    expect(await processWebhookOnce(db, EVENT, handle)).toEqual({ duplicate: true });
    expect(runs).toBe(1);
  });

  it("forgets a delivery whose processing failed, so the provider's retry is processed", async () => {
    const db = fakeDb();
    const failure = new Error("database unavailable");
    await expect(
      processWebhookOnce(db, EVENT, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await processWebhookOnce(db, EVENT, async () => "done")).toEqual({
      duplicate: false,
      result: "done",
    });
  });
});
