import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Frontend / backend boundary checks (constitution I, VIII; ADR-001).
 *
 * The repository is one Next.js application, so the boundary between browser
 * and server code is a rule about imports rather than a folder split. These
 * tests read the source and enforce that rule on every run:
 *
 *  1. Every `lib/` module is server-only (and says so on its first import)
 *     unless it lives in the short browser-safe list below.
 *  2. No browser-safe module and no `"use client"` file can reach a
 *     server-only module through its imports — directly or transitively.
 *  3. Browser code never reads a non-public environment variable.
 *  4. The RLS-bypassing service client is only used on the server paths
 *     ADR-004 allows.
 *
 * `next build` also refuses `server-only` in a client bundle; these catch the
 * mistake earlier, name the file, and cover code the build does not reach.
 */
const ROOT = path.resolve(__dirname, "../..");

/** Browser-safe: isomorphic types, schemas and pure helpers, plus browser runtime code. */
const BROWSER_SAFE = [
  "lib/client/",
  "lib/types/",
  "lib/validators/",
  "lib/uploads/",
  "lib/legacy-plan/",
  "lib/assets/",
  "lib/config/env.schema.ts",
  "lib/config/public-env.ts",
  "lib/format.ts",
  "lib/utils.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const source = new Map<string, string>();
const read = (file: string) => {
  if (!source.has(file)) source.set(file, readFileSync(file, "utf8"));
  return source.get(file)!;
};

const isServerOnly = (file: string) => /^import "server-only";/m.test(read(file));
const isClient = (file: string) => /^\s*["']use client["'];?/.test(read(file));
const isBrowserSafe = (file: string) => BROWSER_SAFE.some((prefix) => rel(file).startsWith(prefix));

/** Resolves `@/…` and relative runtime imports (type-only imports are erased and skipped). */
function runtimeImports(file: string): string[] {
  const text = read(file);
  const found: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const match of text.matchAll(pattern)) {
    const specifier = match[1]!;
    let base: string | null = null;
    if (specifier.startsWith("@/")) base = path.join(ROOT, specifier.slice(2));
    else if (specifier.startsWith(".")) base = path.resolve(path.dirname(file), specifier);
    if (!base) continue;
    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      if (existsSync(candidate)) {
        found.push(candidate);
        break;
      }
    }
  }
  return found;
}

/** The first server-only module reachable from `file`, with the path taken. */
function reachesServerOnly(file: string): string[] | null {
  const seen = new Set<string>([file]);
  const queue: string[][] = [[file]];
  while (queue.length) {
    const trail = queue.shift()!;
    for (const next of runtimeImports(trail[trail.length - 1]!)) {
      if (seen.has(next)) continue;
      seen.add(next);
      const nextTrail = [...trail, next];
      if (isServerOnly(next)) return nextTrail.map(rel);
      queue.push(nextTrail);
    }
  }
  return null;
}

const libFiles = walk(path.join(ROOT, "lib"));
const uiFiles = ["app", "components", "hooks"].flatMap((dir) => walk(path.join(ROOT, dir)));
const clientFiles = [...uiFiles, ...libFiles].filter(isClient);

describe("server / browser boundary", () => {
  it("marks every server module in lib/ as server-only", () => {
    const unmarked = libFiles
      .filter((file) => !isBrowserSafe(file) && !isServerOnly(file))
      .map(rel);
    expect(
      unmarked,
      'add `import "server-only";` or move the module to a browser-safe folder',
    ).toEqual([]);
  });

  it("keeps browser-safe modules free of server-only code", () => {
    const leaks = libFiles
      .filter((file) => isBrowserSafe(file))
      .map((file) => {
        if (isServerOnly(file)) return [rel(file)];
        return reachesServerOnly(file);
      })
      .filter((trail): trail is string[] => trail !== null);
    expect(leaks).toEqual([]);
  });

  it("never lets a client component reach a server-only module", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    const leaks = clientFiles
      .map(reachesServerOnly)
      .filter((trail): trail is string[] => trail !== null);
    expect(leaks).toEqual([]);
  });

  it("never reads a secret environment variable in browser code", () => {
    const offenders = clientFiles
      .map((file) => ({
        file: rel(file),
        names: [...read(file).matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]!),
      }))
      .filter(({ names }) =>
        names.some((name) => !name.startsWith("NEXT_PUBLIC_") && name !== "NODE_ENV"),
      );
    expect(offenders).toEqual([]);
  });

  it("uses the RLS-bypassing service client only on allowed server paths", () => {
    const allowed = [
      "lib/db/",
      "lib/services/",
      "lib/repositories/",
      "lib/jobs/",
      "lib/audit/",
      "lib/security/",
      "lib/storage/",
      "lib/observability/",
      "lib/auth/",
      "app/api/",
    ];
    const users = [...libFiles, ...uiFiles]
      .filter((file) => /\bcreateServiceClient\s*\(/.test(read(file)))
      .map(rel)
      .filter((file) => !allowed.some((prefix) => file.startsWith(prefix)));
    expect(users).toEqual([]);
  });

  it("keeps secrets out of the NEXT_PUBLIC_ namespace everywhere in the code", () => {
    const names = new Set<string>();
    for (const file of [...libFiles, ...uiFiles]) {
      for (const match of read(file).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) names.add(match[0]);
    }
    const suspicious = [...names].filter(
      (name) =>
        /SECRET|PRIVATE|PASSWORD|TOKEN|SERVICE_ROLE|_KEY$/.test(name) &&
        !["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].includes(
          name,
        ),
    );
    expect(suspicious).toEqual([]);
  });
});

describe("debug and diagnostic code", () => {
  it("ships no debug routes", () => {
    const routes = walk(path.join(ROOT, "app", "api")).map(rel);
    expect(routes.filter((route) => /\/(debug|test|probe|db-test)\//.test(route))).toEqual([]);
  });

  it("has no hard-coded user or upload ids in application code", () => {
    const uuid =
      /["'`][0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}["'`]/i;
    const offenders = [...libFiles, ...uiFiles].filter((file) => uuid.test(read(file))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("does not log with console in server application code", () => {
    const offenders = [...libFiles, ...walk(path.join(ROOT, "app", "api"))]
      .filter((file) => /\bconsole\.(log|debug|info)\(/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
