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
  crossFieldIssues,
  describeIssues,
  groupSchema,
  serverEnvGroups,
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

/**
 * Everything else: each one gates a feature and is reported, not enforced.
 * `configured` tells a group that merely validates (every variable optional)
 * apart from one that is actually set up — an empty Sentry DSN must not be
 * reported as working.
 */
const OPTIONAL_LOCALLY: {
  group: ServerEnvGroupName;
  feature: string;
  without: string;
  configured?: (values: Record<string, unknown>) => boolean;
}[] = [
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
    configured: (values) => Boolean(values.SENTRY_DSN),
  },
  {
    group: "operations",
    feature: "`pnpm seed:admin`",
    without: "no account can be promoted to Super Admin",
  },
  {
    group: "ai",
    feature: "the AI assistant and document intelligence",
    without: 'no provider key — AI panels report "not configured"; everything else works',
    configured: (values) =>
      Boolean(
        values.OPENAI_API_KEY ||
        values.GEMINI_API_KEY ||
        values.OPENROUTER_API_KEY ||
        values.GROQ_API_KEY ||
        values.CEREBRAS_API_KEY ||
        values.HF_TOKEN,
      ),
  },
];

function checkGroup(name: ServerEnvGroupName): {
  missing: string[];
  values: Record<string, unknown>;
} {
  const result = groupSchema(name).safeParse(process.env);
  if (result.success) return { missing: [], values: result.data as Record<string, unknown> };
  return {
    missing: result.error.issues.map((issue) => issue.path.map(String).join(".") || "(root)"),
    values: {},
  };
}

let failed = false;

if (strict) {
  // "Is this deployable?" is a production question, so the production-only
  // rules (Sentry DSN, an AI key) are always applied.
  const server = validateServerEnv({ ...process.env, NODE_ENV: "production" });
  if (server.ok) {
    console.log("✔ server environment valid for production (full schema)");
  } else {
    failed = true;
    // Zod skips cross-field rules while any field is missing, so they are
    // evaluated here on whatever does parse — one run lists every gap.
    const parsed = Object.assign(
      {},
      ...(Object.keys(serverEnvGroups) as ServerEnvGroupName[]).map(
        (group) => checkGroup(group).values,
      ),
      { NODE_ENV: "production" },
    );
    const reported = new Set(server.issues.map((issue) => issue.path));
    const issues = [
      ...server.issues,
      ...crossFieldIssues(parsed).filter((issue) => !reported.has(issue.path)),
    ];
    console.error("✖ not deployable to production yet:\n" + describeIssues(issues));
  }
} else {
  console.log("Required to run locally");
  for (const { group, why } of REQUIRED_LOCALLY) {
    const { missing } = checkGroup(group);
    if (missing.length === 0) {
      console.log(`  ✔ ${group} — ${why}`);
    } else {
      failed = true;
      console.error(`  ✖ ${group} — ${why}: missing ${missing.join(", ")}`);
    }
  }

  console.log("\nOptional locally (each one gates a feature)");
  for (const { group, feature, without, configured } of OPTIONAL_LOCALLY) {
    const { missing, values } = checkGroup(group);
    if (missing.length === 0 && (configured?.(values) ?? true)) {
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
