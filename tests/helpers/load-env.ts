import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Loads `.env.local` (then `.env`) into `process.env` for test processes.
 *
 * Next.js does this for the application, but Vitest workers and the Playwright
 * runner are separate processes that never see it — which is how a suite ends up
 * skipping its own assertions while still reporting green. Parsed explicitly
 * rather than through `@next/env`, whose module-level cache does not reliably
 * populate a worker process.
 *
 * A real environment variable always wins, so CI stays authoritative.
 */
export function loadEnvFile(file: string): void {
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

/** Loads the project's local environment files, in Next.js precedence order. */
export function loadLocalEnv(root = process.cwd()): void {
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, ".env"));
}
