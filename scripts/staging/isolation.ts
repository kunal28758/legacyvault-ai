/**
 * What makes a configuration unable to reach production (docs/DEPLOYMENT.md
 * § 7g). Pure, so it is unit-tested; `check-isolation.ts` is the CLI.
 *
 * The production identifiers below are public (they appear in production's
 * Content-Security-Policy header) and are not secrets.
 */
export const PRODUCTION = {
  supabaseRef: "zlgmthrdoxyfkldeaxyl",
  clerkFrontendApi: "needed-turkey-5633.clerk.accounts.dev",
  appHosts: ["legacyvault-ai-uh7s.vercel.app"],
};

export interface IsolationReport {
  failures: string[];
  warnings: string[];
  /** Hostnames only — safe to print. */
  facts: Record<string, string>;
}

type Env = Record<string, string | undefined>;

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

/** The Frontend API host a Clerk publishable key encodes (`pk_<env>_<base64(host$)>`). */
export function clerkHostOf(publishableKey: string | undefined): string | null {
  const encoded = publishableKey?.match(/^pk_(?:test|live)_(.+)$/)?.[1];
  if (!encoded) return null;
  const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  return /^[a-z0-9.-]+$/i.test(host) ? host : null;
}

export function isolationProblems(env: Env): IsolationReport {
  const failures: string[] = [];
  const warnings: string[] = [];

  const publicDb = hostOf(env.NEXT_PUBLIC_SUPABASE_URL);
  const serverDb = hostOf(env.SUPABASE_URL);
  if (!publicDb || !serverDb)
    failures.push("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL must both be set");
  else if (publicDb !== serverDb)
    failures.push("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL point at different projects");
  for (const host of [publicDb, serverDb]) {
    if (host?.includes(PRODUCTION.supabaseRef))
      failures.push("Supabase points at the PRODUCTION project");
  }

  const clerk = clerkHostOf(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (!clerk) failures.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing or not a Clerk key");
  else if (clerk === PRODUCTION.clerkFrontendApi)
    failures.push("Clerk is the instance PRODUCTION uses — create a separate Clerk application");
  if (!env.CLERK_SECRET_KEY) failures.push("CLERK_SECRET_KEY is missing");
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET)
    failures.push("CLERK_WEBHOOK_SIGNING_SECRET is missing (staging must verify its own webhooks)");

  const app = hostOf(env.APP_URL);
  if (!app) failures.push("APP_URL is missing");
  else if (PRODUCTION.appHosts.includes(app)) failures.push("APP_URL is the PRODUCTION host");

  if (env.BREVO_API_KEY) warnings.push("BREVO_API_KEY is set: staging will send real email");
  const mail = hostOf(env.RESEND_BASE_URL);
  if (env.RESEND_API_KEY && !(mail && /^(127\.0\.0\.1|localhost)(:|$)/.test(mail)))
    warnings.push(
      "RESEND_API_KEY is set without a local RESEND_BASE_URL: staging will send real email",
    );

  const facts = {
    supabase: serverDb ?? "(unset)",
    clerk: clerk ?? "(unset)",
    app: app ?? "(unset)",
  };
  return { failures, warnings, facts };
}
