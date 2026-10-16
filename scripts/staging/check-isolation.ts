/**
 * `pnpm staging:check` — refuses a configuration that could reach production
 * (docs/DEPLOYMENT.md § 7g). Prints hostnames and PASS/FAIL only, never values.
 *
 *   node --env-file=<staging env file> node_modules/tsx/dist/cli.mjs scripts/staging/check-isolation.ts
 *     — a local staging file; Next's loader never overrides variables already
 *       set, so anything the file leaves out falls back to .env.local and is
 *       checked too.
 *   pnpm staging:check && pnpm build
 *     — as the staging Vercel project's build command, so a staging
 *       deployment pointed at production does not build.
 *
 * It also proves, over the network and read-only, that CLERK_SECRET_KEY
 * belongs to the same Clerk instance as the publishable key: the secret key is
 * what deletes users (`delete-now`), so a staging publishable key paired with
 * another instance's secret key would delete there. `--offline` skips that
 * proof and says so.
 */
import { readFileSync } from "node:fs";

import { loadEnvConfig } from "@next/env";

import { clerkHostOf, isolationProblems, PRODUCTION } from "./isolation";

loadEnvConfig(process.cwd(), false);

const report = isolationProblems(process.env);
console.log(`Supabase: ${report.facts.supabase}`);
console.log(`Clerk:    ${report.facts.clerk}`);
console.log(`App URL:  ${report.facts.app}`);

async function kids(url: string, init?: RequestInit): Promise<string[]> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { keys?: { kid?: string }[] };
  return (body.keys ?? [])
    .map((key) => key.kid ?? "")
    .filter(Boolean)
    .sort();
}

/** True when CLERK_SECRET_KEY signs for the publishable key's instance. */
async function sameClerkInstance(host: string, secretKey: string): Promise<boolean> {
  const [instance, secret] = await Promise.all([
    kids(`https://${host}/.well-known/jwks.json`),
    kids("https://api.clerk.com/v1/jwks", { headers: { Authorization: `Bearer ${secretKey}` } }),
  ]);
  return instance.length > 0 && instance.join() === secret.join();
}

async function main(): Promise<void> {
  const clerkHost = clerkHostOf(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (process.argv.includes("--offline")) {
    report.warnings.push("--offline: the Clerk secret key's instance was NOT verified");
  } else if (clerkHost && process.env.CLERK_SECRET_KEY) {
    try {
      if (await sameClerkInstance(clerkHost, process.env.CLERK_SECRET_KEY))
        console.log("Clerk secret key: belongs to the publishable key's instance");
      else
        report.failures.push(
          "CLERK_SECRET_KEY belongs to a different Clerk instance than the publishable key",
        );
    } catch (cause) {
      report.failures.push(
        `could not verify the Clerk secret key's instance (${(cause as Error).message})`,
      );
    }
  }

  try {
    if (readFileSync("supabase/.temp/project-ref", "utf8").trim() === PRODUCTION.supabaseRef) {
      report.warnings.push(
        "this checkout's Supabase CLI is linked to PRODUCTION: use --project-ref <staging ref>, never --linked, for staging",
      );
    }
  } catch {
    // Not linked: nothing to warn about.
  }

  for (const warning of report.warnings) console.log(`WARN  ${warning}`);
  for (const failure of report.failures) console.log(`FAIL  ${failure}`);
  console.log(report.failures.length === 0 ? "PASS  isolated from production" : "NOT ISOLATED");
  process.exitCode = report.failures.length === 0 ? 0 : 1;
}

void main();
