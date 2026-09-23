import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest configuration (task T015).
 *
 * - `unit`: jsdom + React Testing Library (`pnpm test`)
 * - `integration`: Node environment against the local Supabase stack
 *   (`pnpm test:integration`; suites that need the database skip themselves
 *   when the stack is not running — see tests/helpers/db.ts)
 *
 * `server-only` is aliased to a no-op so server modules can be unit-tested.
 */
const shared = {
  globals: true,
  clearMocks: true,
  setupFiles: [path.resolve(rootDir, "tests/setup.ts")],
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": rootDir,
      "server-only": path.resolve(rootDir, "tests/helpers/server-only.ts"),
    },
  },
  test: {
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts", "components/**/*.tsx", "app/**/*.tsx"],
      exclude: ["lib/types/**", "**/*.d.ts"],
    },
    projects: [
      {
        extends: true,
        test: {
          ...shared,
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          ...shared,
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Loads .env.local into the worker so the local Supabase stack is reachable.
          setupFiles: [
            path.resolve(rootDir, "tests/integration-setup.ts"),
            path.resolve(rootDir, "tests/setup.ts"),
          ],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
