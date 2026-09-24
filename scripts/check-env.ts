/**
 * `pnpm env:check` — validates .env.local / process.env against the T007 schema
 * without starting the app. Prints variable NAMES and messages only, never values.
 *
 * Two modes, because the two questions are different:
 *
 *   pnpm env:check         "can I run this locally?" — checks the groups the
 *                          application actually reads on a local run and reports
 *                          the rest as feature availability. A missing Resend
 *                          key is not a broken checkout.
 *   pnpm env:check --all   "is this deployable?" — the full schema, which is
 *                          also what production start-up enforces. Nothing is
 *                          optional here.
 *
 * `--all` is implied in production so the strict gate can never be skipped.
 */
import { loadEnvConfig } from "@next/env";

import {
  describeIssues,
  groupSchema,
  validatePublicEnv,
  validateServerEnv,
  type ServerEnvGroupName,
} from "../lib/config/env.schema";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const strict = process.argv.includes("--all") || process.env.NODE_ENV === "production";

/** Groups the application reads on any local run. Without these, nothing works. */
const REQUIRED_LOCALLY: { group: ServerEnvGroupName; why: string }[] = [
  { group: "core", why: "app URL used by links and emails" },
  { group: "clerk", why: "authentication" },
  { group: "database", why: "PostgreSQL and Storage" },
  { group: "encryption", why: "encrypted asset fields" },
  { group: "accessCookie", why: "the beneficiary access session" },
];

/** Everything else: each one gates a feature and is reported, not enforced. */
const OPTIONAL_LOCALLY: { group: ServerEnvGroupName; feature: string; without: string }[] = [
  {
    group: "cron",
    feature: "the job runner and scheduled scans",
    without: "the cron endpoints answer 401",
  },
  {
    group: "email",
    feature: "outbound email",
    without: "links and reminders are created but reported as `emailSent: false`",
  },
  {
    group: "clerkWebhook",
    feature: "the Clerk webhook",
    without: "user sync falls back to the lazy path on first request",
  },
  {
    group: "observability",
    feature: "Sentry",
    without: "errors are logged locally only",
  },
  {
    group: "malwareScanner",
    feature: "malware scanning",
    without: "uploads record `performed: false` (production refuses this)",
  },
  {
    group: "operations",
    feature: "`pnpm seed:admin`",
    without: "no account can be promoted to Super Admin",
  },
  { group: "ai", feature: "the AI phase", without: "deliberately deferred — nothing reads these" },
];

function checkGroup(name: ServerEnvGroupName): string[] {
  const result = groupSchema(name).safeParse(process.env);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.map(String).join(".") || "(root)");
}

let failed = false;

if (strict) {
  const server = validateServerEnv(process.env);
  if (server.ok) {
    console.log("✔ server environment valid (full schema)");
  } else {
    failed = true;
    console.error("✖ server environment invalid:\n" + describeIssues(server.issues));
  }
} else {
  console.log("Required to run locally");
  for (const { group, why } of REQUIRED_LOCALLY) {
    const missing = checkGroup(group);
    if (missing.length === 0) {
      console.log(`  ✔ ${group} — ${why}`);
    } else {
      failed = true;
      console.error(`  ✖ ${group} — ${why}: missing ${missing.join(", ")}`);
    }
  }

  console.log("\nOptional locally (each one gates a feature)");
  for (const { group, feature, without } of OPTIONAL_LOCALLY) {
    const missing = checkGroup(group);
    if (missing.length === 0) {
      console.log(`  ✔ ${group} — ${feature}`);
    } else {
      console.log(`  ○ ${group} — not configured: ${without}`);
    }
  }
  console.log("\nRun `pnpm env:check --all` for the strict check production enforces.");
}

const client = validatePublicEnv(process.env);
if (client.ok) {
  console.log("\n✔ public environment valid");
} else {
  failed = true;
  console.error("\n✖ public environment invalid:\n" + describeIssues(client.issues));
}

process.exit(failed ? 1 : 0);
