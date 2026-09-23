import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Integration workers read the same `.env.local` the application does, so the
 * database assertions actually run against the local Supabase stack instead of
 * silently skipping for want of configuration (see `tests/helpers/db.ts`).
 *
 * Parsed explicitly rather than through `@next/env`, whose module-level cache
 * does not reliably populate a Vitest worker process.
 */
function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!key || key in process.env) continue; // a real environment variable always wins

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

const root = process.cwd();
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));
