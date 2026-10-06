import { describe, expect, it } from "vitest";

import { lifeEventSteps, readLifeEvents } from "@/lib/legacy-plan/life-events";
import { lifeEventsSchema } from "@/lib/validators/life-event.validators";
import { preferencesSchema } from "@/lib/validators/user.validators";

const event = {
  id: "evt-abc12345",
  type: "MARRIAGE",
  occurredOn: "2026-09-12",
  recordedAt: "2026-10-01T10:00:00.000Z",
  done: [],
};

describe("life events storage", () => {
  it("accepts a well-formed event in preferences and rejects foreign fields", () => {
    expect(preferencesSchema.safeParse({ lifeEvents: [event] }).success).toBe(true);
    expect(lifeEventsSchema.safeParse([{ ...event, type: "LOTTERY_WIN" }]).success).toBe(false);
    expect(lifeEventsSchema.safeParse([{ ...event, note: "<script>" }]).success).toBe(false);
    expect(lifeEventsSchema.safeParse([{ ...event, id: "Robert'); DROP" }]).success).toBe(false);
  });

  it("reads stored events defensively in the browser", () => {
    expect(readLifeEvents({ lifeEvents: [event] })).toHaveLength(1);
    expect(readLifeEvents({ lifeEvents: [{ ...event, type: "NOPE" }] })).toEqual([]);
    expect(readLifeEvents({ lifeEvents: "not-a-list" })).toEqual([]);
    expect(readLifeEvents(null)).toEqual([]);
  });

  it("completes steps only from evidence after the event, or from the owner", () => {
    const steps = lifeEventSteps(
      { ...event, type: "MARRIAGE", done: ["store-certificate"] } as never,
      {
        beneficiariesSince: () => 0,
        assetsSince: () => 0,
        documentsInCategory: () => 0,
        planTouchedSince: () => true,
      },
    );
    expect(steps.map((s) => [s.id, s.complete, s.completedBy])).toEqual([
      ["add-spouse", false, null],
      ["review-will", true, "state"],
      ["store-certificate", true, "owner"],
    ]);
  });
});
