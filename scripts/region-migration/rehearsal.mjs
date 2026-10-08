#!/usr/bin/env node
/**
 * Tokyo → Mumbai migration REHEARSAL (see ./README.md for order and prerequisites).
 *
 * Safety model, enforced in code, not by convention:
 *  • Tokyo (the source) is only ever READ. No command here writes to it, and
 *    source reads first assert that the CLI link is exactly Tokyo's ref.
 *  • The target is explicit: REHEARSAL_TARGET_REF + REHEARSAL_TARGET_DB_URL
 *    (an ap-south-1 pooler URL for that ref). Never the linked project, never
 *    Tokyo, never `db reset`.
 *  • Anything that writes (migrate, restore, storage --copy, canary, scheduler
 *    --arm/--fire/--disarm) is a dry run unless `--execute` is passed AND the
 *    operator types the target ref at an interactive prompt.
 *  • Secrets come from `.env.rehearsal` (git-ignored). They are passed to child
 *    processes through the environment or stdin, never argv where avoidable,
 *    and every line printed is redacted. Production values from `.env.local`
 *    are read only to refuse them.
 *  • Dumps live only under REHEARSAL_DUMP_DIR, which must be outside the git
 *    work tree.
 *  • Nothing is deleted except rehearsal-only objects this script created
 *    (the canary schema, rehearsal Vault secrets, probe records).
 *
 * Usage: node scripts/region-migration/rehearsal.mjs <command> [--execute] [options]
 */
import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL = path.join(ROOT, "scripts/region-migration/sql");
const TOKYO_REF = "zlgmthrdoxyfkldeaxyl";
const TOKYO_API = `https://${TOKYO_REF}.supabase.co`;
const PRODUCTION_APP = "https://legacyvault-ai-uh7s.vercel.app";
const LOCAL_DB_CONTAINER = "supabase_db_legacyvault-ai";
const BUCKETS = ["documents", "quarantine", "videos"];
const require = createRequire(import.meta.url);
const SUPABASE_CLI = path.join(
  path.dirname(require.resolve("supabase/package.json")),
  "dist/supabase.js",
);

// ── Environment, secrets and redaction ──────────────────────────────────────
const ENV_FILE = path.join(ROOT, ".env.rehearsal");
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const production = existsSync(path.join(ROOT, ".env.local"))
  ? parseEnv(readFileSync(path.join(ROOT, ".env.local"), "utf8"))
  : {};

const SECRETS = new Set();
function remember(value) {
  if (value && value.length >= 6) SECRETS.add(value);
  return value;
}
for (const name of ["CRON_SECRET", "ENCRYPTION_KEY", "CLERK_SECRET_KEY", "SUPABASE_SECRET_KEY"]) {
  remember(production[name]);
}
function redact(text) {
  let out = String(text ?? "");
  for (const value of SECRETS) out = out.split(value).join("[redacted]");
  return out.replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/g, "$1[redacted]@");
}
const say = (...parts) => console.log(redact(parts.join(" ")));
function fail(message) {
  console.error(redact(`✖ ${message}`));
  process.exit(1);
}
function env(name, { secret = false, optional = false } = {}) {
  const value = process.env[name]?.trim();
  if (!value) {
    if (optional) return undefined;
    fail(`${name} is not set (add it to .env.rehearsal, which git ignores).`);
  }
  return secret ? remember(value) : value;
}

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const EXECUTE = flag("--execute");

// ── Guards ──────────────────────────────────────────────────────────────────
function assertLinkedTokyo() {
  const file = path.join(ROOT, "supabase/.temp/project-ref");
  const linked = existsSync(file) ? readFileSync(file, "utf8").trim() : "(none)";
  if (linked !== TOKYO_REF) {
    fail(
      `The CLI is linked to ${linked}, not the Tokyo source. Source reads need that exact link.`,
    );
  }
}

function target() {
  const ref = env("REHEARSAL_TARGET_REF");
  if (!/^[a-z]{20}$/.test(ref)) fail("REHEARSAL_TARGET_REF must be a 20-letter project ref.");
  if (ref === TOKYO_REF) fail("REHEARSAL_TARGET_REF is the Tokyo production project. Refusing.");
  const dbUrl = env("REHEARSAL_TARGET_DB_URL", { secret: true });
  let url;
  try {
    url = new URL(dbUrl);
  } catch {
    fail("REHEARSAL_TARGET_DB_URL is not a URL.");
  }
  remember(decodeURIComponent(url.password));
  if (!/^postgres(ql)?:$/.test(url.protocol))
    fail("REHEARSAL_TARGET_DB_URL must be postgresql://.");
  if (dbUrl.includes(TOKYO_REF) || url.hostname.includes("ap-northeast-1")) {
    fail("REHEARSAL_TARGET_DB_URL points at Tokyo. Refusing.");
  }
  if (decodeURIComponent(url.username) !== `postgres.${ref}`) {
    fail("REHEARSAL_TARGET_DB_URL must be the session-pooler URL for REHEARSAL_TARGET_REF.");
  }
  if (!/\.pooler\.supabase\.com$/.test(url.hostname) || !url.hostname.includes("ap-south-1")) {
    fail("REHEARSAL_TARGET_DB_URL must be an ap-south-1 (Mumbai) pooler host.");
  }
  const apiUrl = env("REHEARSAL_TARGET_API_URL", { optional: true });
  if (apiUrl && apiUrl.replace(/\/$/, "") !== `https://${ref}.supabase.co`) {
    fail("REHEARSAL_TARGET_API_URL does not belong to REHEARSAL_TARGET_REF.");
  }
  return { ref, dbUrl, apiUrl: `https://${ref}.supabase.co` };
}

function dumpDir() {
  const dir = path.resolve(env("REHEARSAL_DUMP_DIR"));
  const relative = path.relative(ROOT, dir);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    fail("REHEARSAL_DUMP_DIR is inside the repository. Dumps must never live in git.");
  }
  mkdirSync(dir, { recursive: true });
  const git = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  if (git.status === 0 && git.stdout.trim() === "true") {
    fail("REHEARSAL_DUMP_DIR is inside a git work tree. Choose a private folder outside any repo.");
  }
  return dir;
}

function localApp() {
  const base = env("REHEARSAL_APP_URL");
  const url = new URL(base);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    fail(
      "REHEARSAL_APP_URL must be a local app (localhost). The rehearsal never drives production.",
    );
  }
  return base.replace(/\/$/, "");
}

function rehearsalClerk() {
  const publishable = env("REHEARSAL_CLERK_PUBLISHABLE_KEY");
  const secret = env("REHEARSAL_CLERK_SECRET_KEY", { secret: true });
  const domain = (key) =>
    key ? Buffer.from(key.split("_").pop(), "base64").toString().replace(/\$$/, "") : "";
  if (domain(publishable) === domain(production.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)) {
    fail("The rehearsal Clerk keys are the production instance's. Its webhooks write to Tokyo.");
  }
  if (secret === production.CLERK_SECRET_KEY) fail("REHEARSAL_CLERK_SECRET_KEY is production's.");
  return { publishable, secret, domain: domain(publishable) };
}

async function confirm(what, expected) {
  if (!EXECUTE) {
    say(`DRY RUN — nothing was changed. Re-run with --execute to ${what}.`);
    return false;
  }
  if (!process.stdin.isTTY) fail("--execute needs an interactive terminal to confirm.");
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`About to ${what}. Type "${expected}" to continue: `);
  prompt.close();
  if (answer.trim() !== expected) fail("Confirmation did not match. Nothing was changed.");
  return true;
}

// ── Runners (no shell; secrets via env/stdin; output redacted) ──────────────
function run(cmd, argv, { input, extraEnv } = {}) {
  const result = spawnSync(cmd, argv, {
    cwd: ROOT,
    input,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    shell: false,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) fail(result.error.message);
  return { code: result.status, out: redact(result.stdout), err: redact(result.stderr) };
}
const supabase = (argv) => run(process.execPath, [SUPABASE_CLI, ...argv]);

function cliJson(out) {
  const body = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  if (!body.rows) fail(`CLI query failed: ${JSON.stringify(body).slice(0, 400)}`);
  return JSON.parse(Object.values(body.rows[0])[0]);
}

/** Read-only query against Tokyo through the CLI's own login role. */
function sourceQuery(file) {
  assertLinkedTokyo();
  const result = supabase(["db", "query", "--linked", "-f", path.join(SQL, file)]);
  if (result.code !== 0) fail(`source query ${file} failed: ${result.err || result.out}`);
  return cliJson(result.out);
}

/** psql inside the local DB container; the password travels as PGPASSWORD only. */
function targetPsql(t, psqlArgs, input) {
  const url = new URL(t.dbUrl);
  const password = decodeURIComponent(url.password);
  url.password = "";
  if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
  return run(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      "PGPASSWORD",
      LOCAL_DB_CONTAINER,
      "psql",
      url.toString(),
      "-X",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      ...psqlArgs,
    ],
    { input, extraEnv: { PGPASSWORD: password } },
  );
}
function targetQuery(t, file) {
  const full = path.isAbsolute(file) ? file : path.join(SQL, file);
  const result = targetPsql(t, ["-f", "-"], readFileSync(full, "utf8"));
  if (result.code !== 0) {
    fail(`target query ${path.basename(full)} failed: ${result.err || result.out}`);
  }
  return JSON.parse(result.out.trim().split("\n").pop());
}

const SHARE_LINKS = path.join(ROOT, "scripts/share-links");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const save = (dir, name, value) =>
  writeFileSync(path.join(dir, name), JSON.stringify(value, null, 1));
const load = (dir, name) => {
  const file = path.join(dir, name);
  if (!existsSync(file)) fail(`${name} is missing in REHEARSAL_DUMP_DIR — run the earlier step.`);
  return JSON.parse(readFileSync(file, "utf8"));
};

/** Items a target with migrations 0010–0011 may legitimately add or change vs Tokyo (0009). */
const DELTA_SINCE_0009 =
  /auto_grant_held_at|lv_trigger_scheduler|ea_transition|pg_cron|pg_net|access_tokens_live_share_link_uidx|issue_document_share_token|resend_access_token/;
function diffFingerprints(source, targetFp, allowNewer) {
  let drift = 0;
  for (const category of Object.keys({ ...source, ...targetFp }).sort()) {
    const a = new Set(source[category] ?? []);
    const b = new Set(targetFp[category] ?? []);
    const newer = (x) => allowNewer && DELTA_SINCE_0009.test(x);
    const onlySource = [...a].filter((x) => !b.has(x) && !newer(x));
    const onlyTarget = [...b].filter((x) => !a.has(x) && !newer(x));
    const ok = onlySource.length === 0 && onlyTarget.length === 0;
    say(`${ok ? "MATCH" : "DRIFT"}  ${category.padEnd(22)} source=${a.size} target=${b.size}`);
    for (const item of onlySource.slice(0, 10))
      say(`        - only in source: ${item.slice(0, 160)}`);
    for (const item of onlyTarget.slice(0, 10))
      say(`        + only in target: ${item.slice(0, 160)}`);
    if (!ok) drift += 1;
  }
  return drift;
}

// ── Commands ────────────────────────────────────────────────────────────────
const commands = {
  /** Read-only: tools, configuration and every guard, reported without values. */
  async preflight() {
    const checks = [];
    const check = (name, ok, detail = "") => checks.push({ name, ok, detail });
    check("node ≥ 22", Number(process.versions.node.split(".")[0]) >= 22, process.version);
    check(".env.rehearsal present", existsSync(ENV_FILE));
    check(
      ".env.rehearsal ignored by git",
      spawnSync("git", ["check-ignore", "-q", ".env.rehearsal"], { cwd: ROOT }).status === 0,
    );
    check(
      "local DB container (psql 17)",
      run("docker", ["exec", LOCAL_DB_CONTAINER, "psql", "--version"]).code === 0,
    );
    const linked = existsSync(path.join(ROOT, "supabase/.temp/project-ref"))
      ? readFileSync(path.join(ROOT, "supabase/.temp/project-ref"), "utf8").trim()
      : "(none)";
    check("CLI linked to Tokyo (source reads only)", linked === TOKYO_REF, linked);
    for (const name of [
      "REHEARSAL_TARGET_REF",
      "REHEARSAL_TARGET_DB_URL",
      "REHEARSAL_TARGET_SECRET_KEY",
      "REHEARSAL_TARGET_PUBLISHABLE_KEY",
      "REHEARSAL_SOURCE_SECRET_KEY",
      "REHEARSAL_DUMP_DIR",
      "REHEARSAL_APP_URL",
      "REHEARSAL_CLERK_PUBLISHABLE_KEY",
      "REHEARSAL_CLERK_SECRET_KEY",
      "REHEARSAL_ENCRYPTION_KEY",
      "REHEARSAL_SCHEDULER_TARGET_URL",
      "REHEARSAL_CRON_SECRET",
    ]) {
      check(`${name} set`, Boolean(process.env[name]?.trim()));
    }
    for (const c of checks)
      say(`${c.ok ? "OK  " : "MISS"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
    if (process.env.REHEARSAL_TARGET_REF) {
      const t = target();
      const version = targetPsql(t, ["-c", "show server_version"]);
      say(`OK    target ${t.ref} reachable: ${version.code === 0 ? version.out.trim() : "NO"}`);
    }
    if (process.env.REHEARSAL_DUMP_DIR) say(`OK    dump dir outside git: ${dumpDir()}`);
    if (process.env.REHEARSAL_APP_URL) say(`OK    local app: ${localApp()}`);
    if (process.env.REHEARSAL_CLERK_SECRET_KEY)
      say(`OK    rehearsal Clerk: ${rehearsalClerk().domain}`);
    process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
  },

  /** Read-only: catalog fingerprint of one side, saved for `compare`. */
  async fingerprint() {
    const side = option("--side");
    if (!["source", "target"].includes(side)) fail("--side source|target");
    const dir = dumpDir();
    const fp =
      side === "source"
        ? sourceQuery("catalog-fingerprint.sql")
        : targetQuery(target(), "catalog-fingerprint.sql");
    save(dir, `fingerprint-${side}.json`, fp);
    say(
      `saved fingerprint-${side}.json:`,
      Object.entries(fp)
        .map(([k, v]) => `${k}=${v.length}`)
        .join(" "),
    );
  },

  /** Read-only: drift between the saved source and target fingerprints. */
  async compare() {
    const dir = dumpDir();
    const drift = diffFingerprints(
      load(dir, "fingerprint-source.json"),
      load(dir, "fingerprint-target.json"),
      flag("--after-0009"),
    );
    say(drift === 0 ? "NO DRIFT" : `${drift} categories drifted`);
    process.exitCode = drift === 0 ? 0 : 1;
  },

  /** Applies repo migrations up to --until (0009 before the data, 0010 after) to the target. */
  async migrate() {
    const t = target();
    const until = option("--until");
    if (!["0009", "0010", "0011"].includes(until)) fail("--until 0009|0010|0011");
    const work = mkdtempSync(path.join(tmpdir(), "lv-migrate-"));
    try {
      mkdirSync(path.join(work, "supabase/migrations"), { recursive: true });
      copyFileSync(
        path.join(ROOT, "supabase/config.toml"),
        path.join(work, "supabase/config.toml"),
      );
      const files = readdirSync(path.join(ROOT, "supabase/migrations"))
        .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) <= until)
        .sort();
      for (const f of files) {
        copyFileSync(
          path.join(ROOT, "supabase/migrations", f),
          path.join(work, "supabase/migrations", f),
        );
      }
      say(`migrations staged for ${t.ref}: ${files.join(", ")}`);
      const plan = supabase(["db", "push", "--workdir", work, "--db-url", t.dbUrl, "--dry-run"]);
      say(plan.out || plan.err);
      if (!(await confirm(`apply these migrations to ${t.ref}`, t.ref))) return;
      // The CLI needs the URL (with password) as an argument; it is never printed.
      const applied = supabase(["db", "push", "--workdir", work, "--db-url", t.dbUrl]);
      say(applied.out || applied.err);
      if (applied.code !== 0) fail("db push failed.");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  },

  /** Reads Tokyo: checksums before and after a data-only dump of `public`. */
  async dump() {
    const dir = dumpDir();
    const file = path.join(dir, "data.sql");
    say(`will write ${file} (contains personal data: keep private, delete after the rehearsal)`);
    if (!(await confirm("read Tokyo and write the data dump", "DUMP"))) return;
    save(dir, "fingerprint-source.json", sourceQuery("catalog-fingerprint.sql"));
    save(dir, "source-checksums-before.json", sourceQuery("table-checksums.sql"));
    save(dir, "source-envelopes.json", sourceQuery("envelopes.sql"));
    assertLinkedTokyo();
    const result = supabase([
      "db",
      "dump",
      "--linked",
      "--data-only",
      "--use-copy",
      "--schema",
      "public",
      "-f",
      file,
    ]);
    if (result.code !== 0) fail(`dump failed: ${result.err || result.out}`);
    save(dir, "source-checksums-after.json", sourceQuery("table-checksums.sql"));
    chmodSync(file, 0o600);
    const digest = sha256(readFileSync(file));
    writeFileSync(`${file}.sha256`, digest);
    say(`dump written: ${readFileSync(file).length} bytes, sha256 ${digest}`);
  },

  /** Restores the dump into an EMPTY target, in one transaction, triggers off for that session. */
  async restore() {
    const t = target();
    const dir = dumpDir();
    const file = path.join(dir, "data.sql");
    if (!existsSync(file)) fail("data.sql not found — run `dump` first.");
    if (sha256(readFileSync(file)) !== readFileSync(`${file}.sha256`, "utf8").trim()) {
      fail("data.sql does not match its recorded sha256. Refusing.");
    }
    const fp = targetQuery(t, "catalog-fingerprint.sql");
    if (diffFingerprints(load(dir, "fingerprint-source.json"), fp, false) !== 0) {
      fail(
        "Target schema differs from Tokyo. Apply exactly 0001–0009 first (`migrate --until 0009`).",
      );
    }
    const counts = targetQuery(t, "table-checksums.sql");
    const nonEmpty = Object.entries(counts)
      .filter(([, v]) => v.rows > 0)
      .map(([k]) => k);
    if (nonEmpty.length)
      fail(`Target tables are not empty (${nonEmpty.join(", ")}). Use a fresh project.`);
    if (!(await confirm(`restore ${file} into ${t.ref}`, t.ref))) return;
    const result = targetPsql(
      t,
      ["--single-transaction", "-c", "SET session_replication_role = replica", "-f", "-"],
      readFileSync(file, "utf8"),
    );
    if (result.code !== 0) fail(`restore failed and was rolled back: ${result.err.slice(-2000)}`);
    say("restore committed.");
  },

  /** Read-only on both sides (the audit check's attempted writes run on the target and roll back). */
  async verify() {
    const t = target();
    const dir = dumpDir();
    let failures = 0;
    const before = load(dir, "source-checksums-before.json");
    const after = load(dir, "source-checksums-after.json");
    const restored = targetQuery(t, "table-checksums.sql");
    for (const table of Object.keys(before).sort()) {
      const got = restored[table];
      const same = (x) => x && got && x.rows === got.rows && x.md5 === got.md5;
      const status = same(after[table]) ? "MATCH" : same(before[table]) ? "MATCH(before)" : "DIFF";
      const live =
        before[table].md5 !== after[table].md5 ? " (changed in Tokyo during the dump)" : "";
      if (status === "DIFF") failures += 1;
      say(
        `${status.padEnd(13)} ${table.padEnd(26)} source=${after[table].rows} target=${got?.rows}${live}`,
      );
    }
    const orphans = targetQuery(t, "fk-orphans.sql");
    say(`foreign-key orphans: ${JSON.stringify(orphans)}`);
    if (Object.keys(orphans).length) failures += 1;
    const sourceEnvelopes = load(dir, "source-envelopes.json");
    const targetEnvelopes = targetQuery(t, "envelopes.sql");
    const envelopesSame = JSON.stringify(sourceEnvelopes) === JSON.stringify(targetEnvelopes);
    say(`encrypted envelopes byte-identical: ${envelopesSame} (${targetEnvelopes.length})`);
    if (!envelopesSame) failures += 1;
    const audit = targetPsql(
      t,
      ["-f", "-"],
      readFileSync(path.join(SQL, "audit-integrity.sql"), "utf8"),
    );
    const auditOk = audit.code === 0 && audit.out.includes("AUDIT_OK");
    say(`audit log append-only + RLS: ${auditOk ? "OK" : `FAIL ${audit.err}`}`);
    if (!auditOk) failures += 1;
    const fp = targetQuery(t, "catalog-fingerprint.sql");
    save(dir, "fingerprint-target.json", fp);
    const hasNewer =
      fp.functions.some((f) => f.startsWith("lv_trigger_scheduler(")) ||
      fp.indexes.some((i) => i.includes("access_tokens_live_share_link_uidx"));
    failures += diffFingerprints(load(dir, "fingerprint-source.json"), fp, hasNewer);
    say(failures === 0 ? "VERIFY PASSED" : `VERIFY FAILED (${failures})`);
    process.exitCode = failures === 0 ? 0 : 1;
  },

  /** Lists objects on both sides; --copy --execute copies missing ones (never deletes). */
  async storage() {
    const t = target();
    const { createClient } = await import("@supabase/supabase-js");
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    const source = createClient(
      TOKYO_API,
      env("REHEARSAL_SOURCE_SECRET_KEY", { secret: true }),
      opts,
    );
    const dest = createClient(t.apiUrl, env("REHEARSAL_TARGET_SECRET_KEY", { secret: true }), opts);
    async function list(client, bucket, prefix = "") {
      const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
      if (error) fail(`list ${bucket}/${prefix}: ${error.message}`);
      const out = [];
      for (const item of data) {
        const key = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null) out.push(...(await list(client, bucket, key)));
        else out.push({ key, size: item.metadata?.size ?? null, type: item.metadata?.mimetype });
      }
      return out;
    }
    let missing = 0;
    const plan = [];
    for (const bucket of BUCKETS) {
      const [a, b] = [await list(source, bucket), await list(dest, bucket)];
      const have = new Map(b.map((o) => [o.key, o]));
      const absent = a.filter((o) => !have.has(o.key) || have.get(o.key).size !== o.size);
      say(
        `bucket ${bucket}: source=${a.length} target=${b.length} missing-or-different=${absent.length}`,
      );
      missing += absent.length;
      plan.push(...absent.map((o) => ({ bucket, ...o })));
    }
    if (!flag("--copy") || plan.length === 0) {
      process.exitCode = missing === 0 ? 0 : 1;
      return;
    }
    if (!(await confirm(`copy ${plan.length} objects into ${t.ref}`, t.ref))) return;
    for (const o of plan) {
      const { data, error } = await source.storage.from(o.bucket).download(o.key);
      if (error) fail(`download ${o.bucket}/${o.key}: ${error.message}`);
      const bytes = Buffer.from(await data.arrayBuffer());
      const put = await dest.storage
        .from(o.bucket)
        .upload(o.key, bytes, { contentType: o.type, upsert: false });
      if (put.error) fail(`upload ${o.bucket}/${o.key}: ${put.error.message}`);
      const back = await dest.storage.from(o.bucket).download(o.key);
      const ok =
        !back.error && sha256(Buffer.from(await back.data.arrayBuffer())) === sha256(bytes);
      say(`${ok ? "COPIED" : "MISMATCH"} ${o.bucket}/${o.key} (${bytes.length} bytes)`);
      if (!ok) process.exitCode = 1;
    }
  },

  /** Synthetic encryption canary on the target; real records are compared by hash only. */
  async canary() {
    const t = target();
    const [label, material] = env("REHEARSAL_ENCRYPTION_KEY", { secret: true }).split(":");
    const key = Buffer.from(material ?? "", "base64");
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(label) || key.length !== 32) {
      fail("REHEARSAL_ENCRYPTION_KEY must be <keyId>:<base64 of 32 bytes>, like ENCRYPTION_KEY.");
    }
    const envelopes = targetQuery(t, "envelopes.sql");
    const labels = [...new Set(envelopes.map((e) => /keyId=(\S+)/.exec(e)?.[1]))];
    say(
      `copied envelopes: ${envelopes.length}, key labels: ${labels.join(",") || "-"} (expected ${label})`,
    );
    if (labels.some((l) => l !== label))
      fail("Copied envelopes use a key label this key does not carry.");
    if (!(await confirm(`write and remove a synthetic canary in ${t.ref}`, t.ref))) return;
    const plaintext = `rehearsal-canary-${randomBytes(8).toString("hex")}`;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const envelope = {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      keyId: label,
    };
    const literal = JSON.stringify(envelope).replace(/'/g, "''");
    const result = targetPsql(
      t,
      ["-f", "-"],
      [
        "create schema if not exists rehearsal_canary;",
        "create table if not exists rehearsal_canary.envelopes (id serial primary key, content jsonb not null);",
        `insert into rehearsal_canary.envelopes (content) values ('${literal}'::jsonb);`,
        "select content::text from rehearsal_canary.envelopes order by id desc limit 1;",
        "drop schema rehearsal_canary cascade;",
      ].join("\n"),
    );
    if (result.code !== 0) fail(`canary failed: ${result.err}`);
    const stored = JSON.parse(
      result.out
        .trim()
        .split("\n")
        .find((l) => l.startsWith("{")),
    );
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(stored.iv, "base64"));
    decipher.setAuthTag(Buffer.from(stored.authTag, "base64"));
    const opened = Buffer.concat([
      decipher.update(Buffer.from(stored.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    say(
      `canary round-trip through ${t.ref}: ${opened === plaintext ? "OK" : "FAILED"} (schema removed)`,
    );
    process.exitCode = opened === plaintext ? 0 : 1;
  },

  /** Data API exposure + scheduler boundary + cross-user probes through the LOCAL app. */
  async rls() {
    const t = target();
    const app = localApp();
    const clerkKeys = rehearsalClerk();
    const pub = env("REHEARSAL_TARGET_PUBLISHABLE_KEY");
    const serviceKey = env("REHEARSAL_TARGET_SECRET_KEY", { secret: true });
    const results = [];
    const check = (name, ok, detail = "") => {
      results.push(ok);
      say(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    };
    const rest = (p, headers = {}, init = {}) =>
      fetch(`${t.apiUrl}${p}`, { ...init, headers: { apikey: pub, ...headers, ...init.headers } });

    // 1. Anonymous Data API: no table yields a row.
    const tables = Object.keys(targetQuery(t, "table-checksums.sql"));
    for (const table of tables) {
      const res = await rest(`/rest/v1/${table}?select=*&limit=1`);
      const body = await res.json().catch(() => null);
      check(
        `anon cannot read ${table}`,
        res.status === 401 || (Array.isArray(body) && body.length === 0),
        String(res.status),
      );
    }
    // 2. Scheduler boundary as anon and service_role (authenticated is probed after sign-in).
    for (const [role, key] of [
      ["anon", pub],
      ["service_role", serviceKey],
    ]) {
      const rpc = await rest(
        "/rest/v1/rpc/lv_trigger_scheduler",
        { apikey: key, "Content-Type": "application/json" },
        {
          method: "POST",
          body: JSON.stringify({ p_path: "/api/internal/cron/run-jobs" }),
        },
      );
      check(
        `${role} cannot invoke lv_trigger_scheduler`,
        [401, 403].includes(rpc.status),
        String(rpc.status),
      );
      for (const [schema, table] of [
        ["net", "http_request_queue"],
        ["vault", "decrypted_secrets"],
        ["cron", "job"],
      ]) {
        const res = await rest(`/rest/v1/${table}?select=*&limit=1`, {
          apikey: key,
          "Accept-Profile": schema,
        });
        check(`${role} cannot reach ${schema}.${table}`, res.status === 406, String(res.status));
      }
      const gql = await (
        await rest(
          "/graphql/v1",
          { apikey: key, "Content-Type": "application/json" },
          {
            method: "POST",
            body: JSON.stringify({ query: "{ __schema { types { name } } }" }),
          },
        )
      )
        .json()
        .catch(() => ({}));
      check(`${role}: GraphQL disabled`, gql.data === undefined, JSON.stringify(gql).slice(0, 80));
    }

    // 3. Cross-user probes through the local app, signed in on the REHEARSAL Clerk instance.
    process.env.CLERK_PUBLISHABLE_KEY = clerkKeys.publishable;
    process.env.CLERK_SECRET_KEY = clerkKeys.secret;
    const { chromium } = await import("@playwright/test");
    const { clerkSetup, clerk } = await import("@clerk/testing/playwright");
    await clerkSetup();
    const ensureUser = async (email) => {
      const found = await fetch(
        `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
        {
          headers: { Authorization: `Bearer ${clerkKeys.secret}` },
        },
      ).then((r) => r.json());
      if (Array.isArray(found) && found.length) return;
      const made = await fetch("https://api.clerk.com/v1/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clerkKeys.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email_address: [email], skip_password_requirement: true }),
      });
      if (!made.ok) fail(`could not create rehearsal user ${email}: ${made.status}`);
    };
    const browser = await chromium.launch();
    const session = async (email) => {
      await ensureUser(email);
      const context = await browser.newContext({ baseURL: app });
      const page = await context.newPage();
      await page.goto("/");
      await clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: email } });
      await page.goto("/dashboard");
      if (new URL(page.url()).pathname === "/onboarding") {
        await page.getByRole("button", { name: "Skip for now" }).click();
      }
      return { api: page.request, page };
    };
    const headers = { origin: app };
    const denied = (s) => s === 403 || s === 404;
    const a = await session("rehearsal-a+clerk_test@example.com");
    const b = await session("rehearsal-b+clerk_test@example.com");
    const serviceRest = (p) =>
      fetch(`${t.apiUrl}/rest/v1/${p}`, { headers: { apikey: serviceKey } }).then((r) => r.json());
    const mirror = await serviceRest(
      "users?select=id&email=eq.rehearsal-a%2Bclerk_test%40example.com",
    );
    if (!Array.isArray(mirror) || mirror.length !== 1) {
      fail(
        "The local app is not writing to the rehearsal target (no user mirror there). Check its env.",
      );
    }
    const token = await b.page.evaluate(() => window.Clerk?.session?.getToken());
    const authRpc = await rest(
      "/rest/v1/rpc/lv_trigger_scheduler",
      { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      {
        method: "POST",
        body: JSON.stringify({ p_path: "/api/internal/cron/run-jobs" }),
      },
    );
    check(
      "authenticated cannot invoke lv_trigger_scheduler",
      [401, 403].includes(authRpc.status),
      String(authRpc.status),
    );

    const created = [];
    try {
      const ben = await (
        await a.api.post("/api/v1/beneficiaries", {
          headers,
          data: {
            name: "Rehearsal Probe",
            relationship: "Friend",
            email: `probe-${Date.now()}@example.com`,
          },
        })
      ).json();
      const asset = await (
        await a.api.post("/api/v1/assets/financial", {
          headers,
          data: { name: "Rehearsal Probe", category: "BANK_ACCOUNT", currency: "INR" },
        })
      ).json();
      created.push(["beneficiaries", ben.data?.id], ["assets/financial", asset.data?.id]);
      check("A created probe records", Boolean(ben.data?.id && asset.data?.id));
      const copied = {
        plans: (await serviceRest("legacy_plans?select=id")).map((r) => r.id),
        beneficiaries: (await serviceRest("beneficiaries?select=id"))
          .map((r) => r.id)
          .filter((id) => id !== ben.data?.id),
        documents: (await serviceRest("documents?select=id")).map((r) => r.id),
        tokens: await serviceRest("access_tokens?select=id,beneficiary_id"),
      };
      const probes = [
        ["GET", `/api/v1/beneficiaries/${ben.data?.id}`],
        ["PATCH", `/api/v1/beneficiaries/${ben.data?.id}`, { relationship: "Sibling" }],
        ["DELETE", `/api/v1/beneficiaries/${ben.data?.id}`, { confirmed: true }],
        ["GET", `/api/v1/assets/financial/${asset.data?.id}`],
        ["DELETE", `/api/v1/assets/financial/${asset.data?.id}`, { confirmed: true }],
        ...copied.plans.flatMap((id) => [
          ["GET", `/api/v1/legacy-plans/${id}`],
          ["GET", `/api/v1/legacy-plans/${id}/versions`],
        ]),
        ...copied.beneficiaries.flatMap((id) => [
          ["GET", `/api/v1/beneficiaries/${id}`],
          ["GET", `/api/v1/beneficiaries/${id}/tokens`],
        ]),
        ...copied.documents.flatMap((id) => [
          ["GET", `/api/v1/documents/${id}`],
          ["GET", `/api/v1/documents/${id}/versions`],
          ["GET", `/api/v1/ai/documents/${id}/analyses`],
        ]),
        ...copied.tokens.map((tk) => [
          "DELETE",
          `/api/v1/beneficiaries/${tk.beneficiary_id}/tokens/${tk.id}`,
        ]),
      ];
      for (const [method, p, data] of probes) {
        const res = await b.api.fetch(p, { method, headers, data });
        check(
          `B ${method} ${p.replace(/[0-9a-f-]{36}/g, ":id")}`,
          denied(res.status()),
          String(res.status()),
        );
      }
      const foreign = [
        ben.data?.id,
        asset.data?.id,
        ...copied.plans,
        ...copied.beneficiaries,
        ...copied.documents,
        ...copied.tokens.map((x) => x.id),
      ].filter(Boolean);
      for (const p of [
        "/api/v1/beneficiaries",
        "/api/v1/access-links",
        "/api/v1/notifications",
        "/api/v1/emergency-access/contacts",
        "/api/v1/emergency-access/requests",
        "/api/v1/users/me/activity",
        "/api/v1/legacy-plans",
        "/api/v1/documents",
        "/api/v1/dead-man-switch",
      ]) {
        const res = await b.api.get(p);
        const text = await res.text();
        check(
          `B ${p} leaks nothing foreign`,
          !foreign.some((id) => text.includes(id)),
          String(res.status()),
        );
      }
      for (const p of [
        "/api/v1/admin/users",
        "/api/v1/admin/audit-logs",
        "/api/v1/admin/operations",
      ]) {
        check(`B cannot use ${p}`, denied((await b.api.get(p)).status()));
      }
      const anon = await browser.newContext({ baseURL: app });
      for (const p of [
        "/api/v1/beneficiaries",
        "/api/v1/legacy-plans/current",
        "/api/v1/users/me/activity",
        "/api/v1/access-links",
      ]) {
        const s = (await anon.request.get(p)).status();
        check(`anonymous ${p}`, s === 401 || s === 404, String(s));
      }
      await anon.close();
    } finally {
      for (const [kind, id] of created.filter(([, id]) => id)) {
        await a.api.delete(`/api/v1/${kind}/${id}`, { headers, data: { confirmed: true } });
      }
      await browser.close();
    }
    const failedCount = results.filter((ok) => !ok).length;
    say(`RLS/IDOR: ${results.length - failedCount}/${results.length} passed`);
    process.exitCode = failedCount === 0 ? 0 : 1;
  },

  /** Scheduler state; --arm/--fire/--disarm use a rehearsal-only secret and URL. */
  async scheduler() {
    const t = target();
    let armWith;
    if (flag("--arm")) {
      // Refuse production values before anything touches the network.
      const url = env("REHEARSAL_SCHEDULER_TARGET_URL");
      const secret = env("REHEARSAL_CRON_SECRET", { secret: true });
      if (
        !url.startsWith("https://") ||
        url.startsWith(PRODUCTION_APP) ||
        url.includes(TOKYO_REF)
      ) {
        fail("REHEARSAL_SCHEDULER_TARGET_URL must be https and must not be production.");
      }
      if (secret.length < 32 || secret === production.CRON_SECRET) {
        fail(
          "REHEARSAL_CRON_SECRET must be a fresh ≥32-char value, never production's CRON_SECRET.",
        );
      }
      armWith = { url, secret };
    }
    const state = targetQuery(t, "scheduler-state.sql");
    const allowed =
      /^select public\.lv_trigger_scheduler\('\/api\/internal\/cron\/(run-jobs|dms-scan|housekeeping)'\)$/;
    say(
      `jobs: ${state.jobs.map((j) => `${j.name}@${j.schedule}${allowed.test(j.command) ? "" : " UNEXPECTED COMMAND"}`).join(", ")}`,
    );
    say(`trigger executable by API roles: ${JSON.stringify(state.triggerPrivileges)}`);
    say(`vault secret names: ${JSON.stringify(state.vaultSecretNames)}`);
    say(
      `recent responses: ${JSON.stringify(state.recentResponses.map((r) => r.status ?? r.error))}`,
    );
    const bad = targetPsql(t, ["-c", "select public.lv_trigger_scheduler('/api/v1/users/me')"]);
    say(`unknown route refused: ${bad.code !== 0 && /unknown scheduler route/.test(bad.err)}`);

    if (armWith) {
      const { url, secret } = armWith;
      if (!(await confirm(`store rehearsal scheduler secrets in ${t.ref}'s Vault`, t.ref))) return;
      const literal = (v) => `'${v.replace(/'/g, "''")}'`;
      const upsert = (name, value) =>
        `select case when exists (select 1 from vault.secrets where name = ${literal(name)})
           then (select vault.update_secret(id, ${literal(value)}) from vault.secrets where name = ${literal(name)})::text
           else vault.create_secret(${literal(value)}, ${literal(name)})::text end;`;
      const result = targetPsql(
        t,
        ["-f", "-"],
        `${upsert("legacyvault_app_url", url)}\n${upsert("legacyvault_cron_secret", secret)}`,
      );
      say(result.code === 0 ? "armed (values not shown)" : `arm failed: ${result.err}`);
    }
    if (flag("--fire")) {
      if (!(await confirm(`send one scheduler request from ${t.ref}`, t.ref))) return;
      const fired = targetPsql(t, [
        "-c",
        "select public.lv_trigger_scheduler('/api/internal/cron/run-jobs')",
      ]);
      say(
        `request id: ${fired.out.trim() || "(none: not armed)"}; re-run \`scheduler\` in ~10 s to see its status.`,
      );
    }
    if (flag("--disarm")) {
      if (!(await confirm(`remove the rehearsal Vault secrets from ${t.ref}`, t.ref))) return;
      const removed = targetPsql(t, [
        "-c",
        "delete from vault.secrets where name in ('legacyvault_app_url', 'legacyvault_cron_secret')",
      ]);
      say(
        removed.code === 0
          ? "disarmed: the scheduler is a no-op again"
          : `disarm failed: ${removed.err}`,
      );
    }
  },

  /**
   * Duplicate share links on the TARGET, which migration 0011 refuses: report,
   * and with --cleanup --execute revoke exactly the ids the diagnostic marks
   * (audited, idempotent). Production's cleanup is a separate, approved step.
   */
  async ["share-links"]() {
    const t = target();
    const diag = targetQuery(t, path.join(SHARE_LINKS, "diagnose.sql"));
    say(
      `beneficiaries with duplicate share links: ${diag.beneficiariesAffected}; ` +
        `by action: ${JSON.stringify(diag.byAction)}`,
    );
    for (const link of diag.links) {
      say(
        `  ${link.beneficiaryId.slice(0, 8)} ${link.tokenId} live=${link.live} ` +
          `used=${link.usedAt !== null} → ${link.action}`,
      );
    }
    if (diag.byAction.AMBIGUOUS)
      fail("Ambiguous rows: review them by hand; the cleanup refuses them.");
    if (!flag("--cleanup") || diag.approvedIds.length === 0) return;
    if (
      !(await confirm(`revoke ${diag.approvedIds.length} duplicate share links in ${t.ref}`, t.ref))
    ) {
      return;
    }
    const placeholder = "array[]::uuid[];   -- ← reviewed ids from diagnose.sql";
    const sql = readFileSync(path.join(SHARE_LINKS, "cleanup.sql"), "utf8");
    if (!sql.includes(placeholder)) fail("cleanup.sql no longer has its id placeholder.");
    const ids = diag.approvedIds.map((id) => `'${id.replace(/[^0-9a-f-]/g, "")}'::uuid`).join(", ");
    const result = targetPsql(t, ["-f", "-"], sql.replace(placeholder, `array[${ids}];`));
    if (result.code !== 0) fail(`cleanup failed and was rolled back: ${result.err}`);
    say(
      `${result.err.trim()}\nremaining duplicated beneficiaries: ${result.out.trim().split("\n").pop()}`,
    );
  },

  /** Read-only proof that Tokyo and production were not changed by the rehearsal. */
  async ["rollback-check"]() {
    const checks = [];
    const check = (name, ok, detail = "") => {
      checks.push(ok);
      say(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    };
    assertLinkedTokyo();
    check("CLI still linked to Tokyo", true);
    const fp = sourceQuery("catalog-fingerprint.sql");
    check("Tokyo has no pg_cron/pg_net", !fp.extensions.some((e) => /^pg_(cron|net) /.test(e)));
    check(
      "Tokyo has no lv_trigger_scheduler (0010 not applied)",
      !fp.functions.some((f) => f.startsWith("lv_trigger_scheduler(")),
    );
    check(
      "Tokyo has no one-live-share-link index (0011 not applied)",
      !fp.indexes.some((i) => i.includes("access_tokens_live_share_link_uidx")),
    );
    if (
      process.env.REHEARSAL_DUMP_DIR &&
      existsSync(path.join(dumpDir(), "fingerprint-source.json"))
    ) {
      check(
        "Tokyo catalog unchanged since the dump",
        diffFingerprints(load(dumpDir(), "fingerprint-source.json"), fp, false) === 0,
      );
    }
    const health = await fetch(`${PRODUCTION_APP}/api/v1/health`);
    const body = await health.json().catch(() => ({}));
    const served = health.headers.get("x-vercel-id") ?? "";
    check(
      "production health answers",
      health.ok,
      `${health.status} database=${body?.data?.database ?? body?.database}`,
    );
    check(
      "production still on its current deployment region",
      /::iad1::/.test(served),
      served.split("::").slice(0, 2).join("::"),
    );
    process.exitCode = checks.every(Boolean) ? 0 : 1;
  },
};

if (!command || !commands[command]) {
  say(
    `usage: node scripts/region-migration/rehearsal.mjs <${Object.keys(commands).join("|")}> [--execute]`,
  );
  process.exit(command ? 1 : 0);
}
await commands[command]();
