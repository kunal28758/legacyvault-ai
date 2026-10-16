import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { Database } from "@/lib/types/database";

type WebhookProvider = Database["public"]["Enums"]["webhook_provider"];

/**
 * Runs `handle` once per provider delivery id. A replay of a delivery that was
 * processed returns `{ duplicate: true }` without calling `handle`.
 *
 * The id is recorded before processing (`record_webhook_event()`), so if
 * `handle` throws, the record is removed again before the error propagates:
 * the provider's retry is then processed instead of being ignored as a
 * duplicate. Handlers must therefore be idempotent (at-least-once delivery).
 */
export async function processWebhookOnce<T>(
  db: TypedSupabaseClient,
  event: { provider: WebhookProvider; id: string; type: string },
  handle: () => Promise<T>,
): Promise<{ duplicate: true } | { duplicate: false; result: T }> {
  const { data: isNew, error } = await db.rpc("record_webhook_event", {
    p_provider: event.provider,
    p_event_id: event.id,
    p_event_type: event.type,
  });
  if (error) throw error;
  if (!isNew) return { duplicate: true };

  try {
    return { duplicate: false, result: await handle() };
  } catch (cause) {
    await db
      .from("processed_webhook_events")
      .delete()
      .eq("provider", event.provider)
      .eq("event_id", event.id);
    throw cause;
  }
}
