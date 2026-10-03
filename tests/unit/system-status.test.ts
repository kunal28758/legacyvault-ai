import { describe, expect, it, vi } from "vitest";

import type { ServiceStatus } from "@/lib/types/system-status";

vi.mock("@/lib/ai", () => ({ getAIConfiguration: vi.fn(), getAIProvider: vi.fn() }));

const { overallOf } = await import("@/lib/observability/system-status");

/**
 * The overall state behind the "System online" indicator. Green only when
 * every service is actually operational; red when a core dependency is down.
 */
function service(id: ServiceStatus["id"], state: ServiceStatus["state"]): ServiceStatus {
  return { id, label: id, state, message: "" };
}

const ALL_OK: ServiceStatus[] = [
  service("application", "operational"),
  service("database", "operational"),
  service("storage", "operational"),
  service("authentication", "operational"),
  service("ai", "operational"),
  service("jobs", "operational"),
];

describe("overall system state", () => {
  it("is operational only when everything is", () => {
    expect(overallOf(ALL_OK)).toBe("operational");
  });

  it("is degraded, not green, when a service is not configured", () => {
    const services = ALL_OK.map((s) => (s.id === "ai" ? service("ai", "not_configured") : s));
    expect(overallOf(services)).toBe("degraded");
  });

  it("is degraded, not down, when a non-core service is down", () => {
    const services = ALL_OK.map((s) => (s.id === "jobs" ? service("jobs", "down") : s));
    expect(overallOf(services)).toBe("degraded");
  });

  it("is down when a core dependency is down", () => {
    const services = ALL_OK.map((s) => (s.id === "database" ? service("database", "down") : s));
    expect(overallOf(services)).toBe("down");
  });
});
