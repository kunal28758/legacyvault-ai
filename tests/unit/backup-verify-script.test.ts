// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { compareChecksums } from "@/scripts/backup/compare-checksums.mjs";
import { queryValue } from "@/scripts/backup/query-value.mjs";

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

// The two JSON shapes `supabase db query --output-format json` prints: a bare
// array in a normal terminal, an object with `rows` when it detects an agent.
const CHECKSUMS = '{\\"users\\":{\\"rows\\":1,\\"md5\\":\\"x\\"}}';
const ARRAY_SHAPE = `[{"checksums":"${CHECKSUMS}"}]`;
const AGENT_SHAPE = `{"boundary":"b","rows":[{"checksums":"${CHECKSUMS}"}],"warning":"w"}`;
// Like the real CLI: a text table unless JSON is asked for explicitly.
const query = (json: string) =>
  `case "$*" in *"--output-format json"*) printf '%s' '${json}' ;; *) printf '%s\\n' '| checksums |' '| {} |' ;; esac`;

describe("backup-verify.sh never reports a broken backup as a success", SPAWN_TIMEOUT, () => {
  const checksumsJson = query(ARRAY_SHAPE);

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

  it.each([
    ["the bare array a normal terminal gets", ARRAY_SHAPE],
    ["the object an agent gets", AGENT_SHAPE],
  ])("asks for JSON and reads the checksums from %s", (_label, shape) => {
    const fake = fakeSupabase(`case "$*" in
  *"--data-only"*) exit 1 ;;
  *"db dump"*) printf -- '-- PostgreSQL database dump complete\\n' ;;
  *"db query"*) ${query(shape)} ;;
esac`);
    const dest = freshDir();
    const result = run([dest], { LV_BACKUP_SUPABASE_BIN: fake });
    // It gets past the checksums and stops at the (failing) data dump.
    expect(result.out).toContain("FAIL: dumping data-public.sql.gpg failed");
    expect(result.out).not.toContain("reading the source checksums");
    expect(JSON.parse(readFileSync(path.join(dest, "checksums-before.json"), "utf8"))).toEqual({
      users: { rows: 1, md5: "x" },
    });
  });

  it.each([
    [
      "a text table (the CLI's default)",
      `printf '%s\\n' '| checksums |' '| {} |'`,
      "not valid JSON",
    ],
    ["malformed JSON", `printf '%s' '[{"checksums":'`, "not valid JSON"],
    ["no output", `true`, "printed nothing"],
    ["an empty checksum set", `printf '%s' '[{"checksums":"{}"}]'`, "is empty"],
  ])("refuses %s as the source checksums", (_label, output, reason) => {
    const fake = fakeSupabase(`case "$*" in
  *"db dump"*) printf -- '-- PostgreSQL database dump complete\\n' ;;
  *"db query"*) ${output} ;;
esac`);
    const result = run([freshDir()], { LV_BACKUP_SUPABASE_BIN: fake });
    expect(result.status).toBe(1);
    expect(result.out).toContain(
      "FAIL: reading the source checksums (checksums-before.json) failed",
    );
    expect(result.out).toContain(reason);
    expect(result.out).not.toContain("PASS");
  });

  it("fails clearly when the migration version cannot be read", () => {
    const fake = fakeSupabase(`case "$*" in
  *"--data-only"*) printf 'COPY x FROM stdin;\\nRESET ALL;\\n' ;;
  *"db dump"*) printf -- '-- PostgreSQL database dump complete\\n' ;;
  *"max(version)"*) printf '%s\\n' '| v |' '| 0014 |' ;;
  *"db query"*) ${checksumsJson} ;;
esac`);
    const result = run([freshDir()], { LV_BACKUP_SUPABASE_BIN: fake });
    expect(result.status).toBe(1);
    expect(result.out).toContain("FAIL: reading the database migration version failed");
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

describe("queryValue", () => {
  const row = { checksums: '{"users":{"rows":1,"md5":"x"}}' };

  it.each([
    ["a bare array", JSON.stringify([row])],
    ["an object with rows", JSON.stringify({ boundary: "b", rows: [row], warning: "w" })],
    ["output after a CLI notice", `Initialising login role...\n${JSON.stringify([row])}`],
  ])("reads the value from %s", (_label, text) => {
    expect(queryValue(text, "checksums", { jsonObject: true })).toBe(row.checksums);
  });

  it("reads a scalar value", () => {
    expect(queryValue('[{"v":"0014"}]', "v")).toBe("0014");
  });

  it.each([
    ["", "printed nothing"],
    ["| checksums |\n| {} |", "not valid JSON"],
    ["no json here", "not JSON"],
    ['{"error":"boom"}', "has no rows"],
    ["[]", "exactly one row, got 0"],
    ['[{"v":"1"},{"v":"2"}]', "exactly one row, got 2"],
    ['[{"other":"x"}]', 'no value for "v"'],
  ])("refuses %j", (text, reason) => {
    expect(() => queryValue(text, "v")).toThrow(reason);
  });

  it("refuses checksums that are not a non-empty JSON object", () => {
    for (const value of ["{}", "[1]", "nope"]) {
      expect(() => queryValue(JSON.stringify([{ c: value }]), "c", { jsonObject: true })).toThrow();
    }
  });

  it("never quotes the output in its reason, which can hold query results", () => {
    const secret = "row-content-that-must-not-leak";
    for (const text of [`| ${secret} |`, `[{"${secret}":1}]`, `[{"v":"a"},{"v":"${secret}"}]`]) {
      // Must throw first, or the message check would pass without a message.
      expect(() => queryValue(text, "v")).toThrow();
      let message = "";
      try {
        queryValue(text, "v");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(secret);
    }
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
