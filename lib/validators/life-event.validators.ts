import { z } from "zod";

import { LIFE_EVENT_TYPES, type StoredLifeEvent } from "@/lib/legacy-plan/life-events";

/**
 * Server-side validation for life events stored in `users.preferences.lifeEvents`
 * (see lib/legacy-plan/life-events for the model and catalogue).
 */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const storedLifeEventSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{6,40}$/),
    type: z.enum(LIFE_EVENT_TYPES),
    occurredOn: isoDay.nullable(),
    recordedAt: z.iso.datetime(),
    done: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(20),
  })
  .strict() satisfies z.ZodType<StoredLifeEvent>;

export const lifeEventsSchema = z.array(storedLifeEventSchema).max(50);
