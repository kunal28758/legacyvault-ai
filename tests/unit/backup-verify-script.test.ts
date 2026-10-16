// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { compareChecksums } from "@/scripts/backup/compare-checksums.mjs";

/**
 * scripts/backup/backup-verify.sh must never present a failed, partial or
 * unverifiable backup as a success. The Supabase CLI is replaced through the
 * rehearsal-only test hook, so these tests touch no database and no network;
 * the full rehearsal (real local database, real restore) is run by hand.
 */
const repo = path.resolve(__dirname, "../..");
const script = path.join(repo, "scripts/backup/backup-verify.sh");
const scratch = mkdtempSync(path.join(tmpdir(), "lv-backup-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function fakeSupabase(body: string): string {
  const file = path.join(scratch, `fake-supabase-${++counter}.sh`);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return file;
}

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("bash", [script, ...args], {
    cwd: repo,
    encoding: "utf8",
    input: "",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const freshDir = () => path.join(scratch, `dest-${++counter}`);

// Each case spawns bash (and on Windows, Git Bash) synchronously; under a full
// parallel test run that alone can pass the 5 s default.
const SPAWN_TIMEOUT = { timeout: 30_000 };

describe("backup-verify.sh refuses unsafe invocations", SPAWN_TIMEOUT, () => {
  it.each([
    ["no destination", []],
    ["too many arguments", ["x", "--production", "extra"]],
    ["a destination that looks like an option", ["--production"]],
    ["an unknown mode", ["somewhere", "--prod"]],
  ])("rejects %s", (_label, args) => {
    expect(run(args).status).toBe(2);
  });

  it("rejects a destination inside the repository", () => {
    const result = run([path.join(repo, "tmp-backup-test")]);
    rmSync(path.join(repo, "tmp-backup-test"), { recursive: true, force: true });
    expect(result.status).toBe(1);
    expect(result.out).toContain("outside the repository");
  });

  it("refuses production without a terminal, and never accepts the test hook there", () => {
    expect(run([freshDir(), "--production"]).out).toMatch(/run interactively|not linked/);
    const hooked = run([freshDir(), "--production"], { LV_BACKUP_SUPABASE_BIN: "/bin/true" });
    expect(hooked.status).toBe(1);
    expect(hooked.out).toContain("rehearsals only");
  });
});

describe("backup-verify.sh never reports a broken backup as a success", SPAWN_TIMEOUT, () => {
  const checksumsJson = `printf '%s' '{"rows":[{"checksums":"{}"}]}'`;

  it("fails loudly and leaves no file when a dump dies midway", () => {
    const fake = fakeSupabase(`case "$*" in
  *"--data-only"*) printf 'COPY public.users (id) FROM stdin;\\n'; exit 1 ;;
  *"db dump"*) printf -- '-- PostgreSQL database dump complete\\n' ;;
  *"db query"*) ${checksumsJson} ;;
esac`);
    const dest = freshDir();
    const result = run([dest], { LV_BACKUP_SUPABASE_BIN: fake });
    expect(result.status).toBe(1);
    expect(result.out).toContain("FAIL: dumping data-public.sql.gpg failed");
    expect(result.out).not.toContain("PASS");
    const left = readdirSync(dest);
    expect(left.filter((file) => file.endsWith(".partial"))).toEqual([]);
    expect(left).not.toContain("data-public.sql.gpg");
  });

  it("fails when a dump exits cleanly but is truncated (no completion marker)", () => {
    const fake = fakeSupabase(`case "$*" in
  *"--data-only"*) printf 'COPY x FROM stdin;\\nRESET ALL;\\n' ;;
  *"db dump"*) printf -- 'CREATE TABLE half_written (\\n' ;;
  *"db query"*) ${checksumsJson} ;;
esac`);
    const result = run([freshDir()], { LV_BACKUP_SUPABASE_BIN: fake });
    expect(result.status).toBe(1);
    expect(result.out).toContain("FAIL: schema.sql.gpg is incomplete");
    expect(result.out).not.toContain("PASS");
  });

  it("fails when the source checksums cannot be read", () => {
    const fake = fakeSupabase(`case "$*" in
  *"db dump"*) printf -- '-- PostgreSQL database dump complete\\n' ;;
  *"db query"*) printf '{"_tag":"Error"}'; exit 1 ;;
esac`);
    const result = run([freshDir()], { LV_BACKUP_SUPABASE_BIN: fake });
    expect(result.status).toBe(1);
    expect(result.out).toContain("FAIL: reading the source checksums");
  });
});

describe("compareChecksums", () => {
  const t = (rows: number, md5: string) => ({ rows, md5 });

  it("passes when every stable table matches exactly", () => {
    const state = { users: t(3, "a"), documents: t(5, "b") };
    expect(compareChecksums(state, state, state)).toMatchObject({
      pass: true,
      tables: 2,
      rows: 8,
      mismatched: [],
      changedDuringBackup: [],
    });
  });

  it("fails on any difference in a table that was stable during the dump", () => {
    const source = { users: t(3, "a"), documents: t(5, "b") };
    const restored = { users: t(3, "a"), documents: t(4, "c") };
    expect(compareChecksums(source, source, restored)).toMatchObject({
      pass: false,
      mismatched: ["documents"],
    });
  });

  it("names tables that changed while the dump ran instead of claiming them", () => {
    const before = { users: t(3, "a"), rate_limits: t(10, "x") };
    const after = { users: t(3, "a"), rate_limits: t(12, "y") };
    const restored = { users: t(3, "a"), rate_limits: t(11, "z") };
    expect(compareChecksums(before, after, restored)).toMatchObject({
      pass: true,
      changedDuringBackup: ["rate_limits"],
    });
  });

  it("fails when a table is missing on either side", () => {
    const source = { users: t(3, "a"), documents: t(5, "b") };
    expect(compareChecksums(source, source, { users: t(3, "a") })).toMatchObject({
      pass: false,
      mismatched: ["documents"],
    });
  });
});
