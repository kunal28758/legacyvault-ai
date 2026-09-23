/**
 * Promotes the `ADMIN_EMAIL` account to SUPER_ADMIN (task T033).
 *
 * `users.role` is the source of truth for authorization and is deliberately
 * unreachable from any `authenticated`-callable path (ADR-004 § 6 —
 * `protect_identity_columns` refuses the column, and no guarded function
 * changes a role). Promotion therefore happens out of band, through the
 * service role, and is audited.
 *
 * No credentials are seeded: Clerk owns those (ADR-003). The Clerk account must
 * already exist — sign up first, then run this.
 *
 *   pnpm seed:admin
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../lib/types/database";

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  ADMIN_EMAIL: z.email(),
});

async function main(): Promise<void> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Names only — never values.
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    console.error(`✖ Missing or invalid configuration: ${missing}`);
    console.error("  See .env.example and docs/DEPLOYMENT.md.");
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_EMAIL } = parsed.data;
  const email = ADMIN_EMAIL.toLowerCase();
  const db = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: user, error } = await db
    .from("users")
    .select("id, role, email")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error(`✖ Could not read the users table: ${error.code ?? "unknown error"}`);
    process.exit(1);
  }

  if (!user) {
    console.error(`✖ No application user exists for ${email}.`);
    console.error(
      "  Sign up through the app first — Clerk owns the credentials, this only sets the role.",
    );
    process.exit(1);
  }

  if (user.role === "SUPER_ADMIN") {
    console.log(`✔ ${email} is already SUPER_ADMIN — nothing to do.`);
    return;
  }

  const { error: updateError } = await db
    .from("users")
    .update({ role: "SUPER_ADMIN" })
    .eq("id", user.id);
  if (updateError) {
    console.error(`✖ Promotion failed: ${updateError.code ?? "unknown error"}`);
    process.exit(1);
  }

  const { error: auditError } = await db.from("audit_log").insert({
    actor_id: user.id,
    actor_role: "SUPER_ADMIN",
    action: "admin.role_seeded",
    resource_type: "users",
    resource_id: user.id,
    outcome: "SUCCESS",
    metadata: { previousRole: user.role, newRole: "SUPER_ADMIN", source: "scripts/seed-admin" },
  });
  if (auditError) {
    console.error(
      `✖ Promoted, but the audit row failed to write: ${auditError.code ?? "unknown error"}`,
    );
    process.exit(1);
  }

  console.log(`✔ ${email} promoted to SUPER_ADMIN (audited as admin.role_seeded).`);
}

main().catch((cause: unknown) => {
  console.error("✖ seed-admin failed:", cause instanceof Error ? cause.message : "unknown error");
  process.exit(1);
});
