import "server-only";

import { getAIConfiguration, getAIProvider } from "@/lib/ai";
import { getEnvGroup } from "@/lib/config/env";
import { isClerkConfigured } from "@/lib/config/public-env";
import { checkDatabase, checkStorage, lastFinishedJob } from "@/lib/observability/health";
import { logger } from "@/lib/observability/logger";
import type {
  ServiceId,
  ServiceState,
  ServiceStatus,
  SystemStatus,
} from "@/lib/types/system-status";

/**
 * The status page behind the "System online" indicator.
 *
 * Every entry is a real probe made from this server, never a configured value
 * presented as a result: the database answers a query, storage lists its
 * buckets, Clerk's API answers an authenticated request, and the AI provider
 * answers an authenticated model lookup. A probe that
 * cannot complete in a few seconds counts as failed.
 *
 * Anonymous callers receive only the overall state (the same rule the health
 * endpoint follows: an unauthenticated visitor must not learn which dependency
 * is down). Signed-in users receive the breakdown, with plain explanations and
 * no hostnames, versions or error text.
 */
const PROBE_TIMEOUT_MS = 4_000;
const CACHE_MS = 30_000;
/** The DMS scan runs hourly (one job per hour by key; 0010 ticks at :07 and :37); twice that without a heartbeat is a failure. */
const JOBS_STALE_SECONDS = 2 * 3600;

const LABELS: Record<ServiceId, string> = {
  application: "Application",
  database: "Database",
  storage: "Secure storage",
  authentication: "Authentication",
  ai: "AI services",
  jobs: "Background jobs",
};

function withDeadline<T>(probe: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    probe.catch((cause: unknown) => {
      logger.warn({ err: cause }, "status probe failed");
      return fallback;
    }),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS)),
  ]);
}

function status(id: ServiceId, state: ServiceState, message: string): ServiceStatus {
  return { id, label: LABELS[id], state, message };
}

async function probeDatabase(): Promise<ServiceStatus> {
  const result = await withDeadline(checkDatabase(), "down" as const);
  return result === "ok"
    ? status("database", "operational", "Answering queries normally.")
    : status(
        "database",
        "down",
        "The database is not responding. Your data is safe; saving is paused.",
      );
}

async function probeStorage(): Promise<ServiceStatus> {
  const result = await withDeadline(checkStorage(), "degraded" as const);
  return result === "ok"
    ? status("storage", "operational", "Private file storage is reachable.")
    : status(
        "storage",
        "down",
        "File storage is not responding. Uploads and downloads are paused.",
      );
}

async function probeAuthentication(): Promise<ServiceStatus> {
  if (!isClerkConfigured()) {
    return status(
      "authentication",
      "not_configured",
      "Sign-in is not configured in this environment.",
    );
  }
  let secret: string;
  try {
    secret = getEnvGroup("clerk").CLERK_SECRET_KEY;
  } catch {
    return status("authentication", "not_configured", "Sign-in is not fully configured.");
  }
  const reachable = await withDeadline(
    fetch("https://api.clerk.com/v1/jwks", {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    }).then((response) => response.ok),
    false,
  );
  return reachable
    ? status("authentication", "operational", "The identity provider is responding.")
    : status(
        "authentication",
        "degraded",
        "The identity provider is not responding. Existing sessions keep working; new sign-ins may fail.",
      );
}

async function probeAI(): Promise<ServiceStatus> {
  const configuration = getAIConfiguration();
  if (!configuration.configured) {
    return status(
      "ai",
      "not_configured",
      "No AI provider is configured. Everything else works normally.",
    );
  }
  const reachable = await withDeadline(
    getAIProvider()
      .ping(AbortSignal.timeout(PROBE_TIMEOUT_MS))
      .then(() => true),
    false,
  );
  return reachable
    ? status("ai", "operational", "The AI provider is responding.")
    : status(
        "ai",
        "degraded",
        "The AI provider is not responding. AI answers are paused; nothing else is affected.",
      );
}

async function probeJobs(): Promise<ServiceStatus> {
  const age = await withDeadline(lastFinishedJob("dms.scan"), null);
  if (age === null) {
    return status(
      "jobs",
      "degraded",
      "No scheduled check has completed yet (the Dead Man's Switch scan runs hourly).",
    );
  }
  return age <= JOBS_STALE_SECONDS
    ? status("jobs", "operational", "Scheduled checks are running on time.")
    : status(
        "jobs",
        "down",
        "Scheduled checks are overdue. Dead Man's Switch timing may be delayed.",
      );
}

const CORE: ServiceId[] = ["database", "storage", "authentication"];

export function overallOf(services: ServiceStatus[]): SystemStatus["overall"] {
  if (services.some((service) => CORE.includes(service.id) && service.state === "down"))
    return "down";
  if (services.every((service) => service.state === "operational")) return "operational";
  return "degraded";
}

async function probe(): Promise<SystemStatus & { services: ServiceStatus[] }> {
  const [database, storage, authentication, ai, jobs] = await Promise.all([
    probeDatabase(),
    probeStorage(),
    probeAuthentication(),
    probeAI(),
    probeJobs(),
  ]);
  const services = [
    status("application", "operational", "Responding normally."),
    database,
    storage,
    authentication,
    ai,
    jobs,
  ];
  return {
    overall: overallOf(services),
    checkedAt: new Date().toISOString(),
    services,
  };
}

/**
 * Cached briefly: many open tabs poll this, and each uncached call makes five
 * outbound probes — an amplification an anonymous caller must not be able to
 * buy. Concurrent callers share one in-flight probe.
 */
let cached: { at: number; value: Awaited<ReturnType<typeof probe>> } | null = null;
let inFlight: Promise<Awaited<ReturnType<typeof probe>>> | null = null;

export async function getSystemStatus(audience: "public" | "user"): Promise<SystemStatus> {
  let value: Awaited<ReturnType<typeof probe>>;
  if (cached && Date.now() - cached.at < CACHE_MS) {
    value = cached.value;
  } else {
    inFlight ??= probe().finally(() => {
      inFlight = null;
    });
    value = await inFlight;
    cached = { at: Date.now(), value };
  }
  if (audience === "user") return value;
  return { overall: value.overall, checkedAt: value.checkedAt };
}
