// Compares a restored database's per-table checksums with the source database,
// measured just before and just after the dump (scripts/backup/backup-verify.sh).
//
// A live database keeps writing during a backup, so the source is not one
// fixed state:
//  - a table identical before and after the dump was stable while it ran, so
//    the restore must match it exactly;
//  - a table that changed during that window cannot be proven exactly. It is
//    reported by name so the owner can re-run at a quieter time; it never
//    turns a mismatch into a pass.
// Input and output carry table names, row counts and md5s only, never data.
import { readFileSync } from "node:fs";

/** @param {Record<string, {rows: string|number, md5: string}>} before */
export function compareChecksums(before, after, restored) {
  const tables = [
    ...new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(restored)]),
  ].sort();
  const mismatched = [];
  const changedDuringBackup = [];
  let rows = 0;
  for (const table of tables) {
    const b = before[table];
    const a = after[table];
    const r = restored[table];
    if (!b || !a || !r) {
      mismatched.push(table);
      continue;
    }
    rows += Number(r.rows);
    const stable = String(b.rows) === String(a.rows) && b.md5 === a.md5;
    if (!stable) changedDuringBackup.push(table);
    else if (String(r.rows) !== String(b.rows) || r.md5 !== b.md5) mismatched.push(table);
  }
  return {
    tables: tables.length,
    rows,
    mismatched,
    changedDuringBackup,
    pass: mismatched.length === 0,
  };
}

const invokedDirectly = (process.argv[1] ?? "")
  .replace(/\\/g, "/")
  .endsWith("scripts/backup/compare-checksums.mjs");
if (invokedDirectly) {
  const [before, after, restored] = process.argv
    .slice(2, 5)
    .map((file) => JSON.parse(readFileSync(file, "utf8")));
  const result = compareChecksums(before, after, restored);
  if (!result.pass) {
    console.log(`FAIL: restored tables differ from the source: ${result.mismatched.join(", ")}`);
    process.exit(1);
  }
  const exact = result.tables - result.changedDuringBackup.length;
  console.log(
    `PASS: ${exact} of ${result.tables} public tables match exactly (${result.rows} rows restored)`,
  );
  if (result.changedDuringBackup.length) {
    console.log(
      `NOTE: changed while the backup ran, so not provable exactly: ${result.changedDuringBackup.join(", ")}. ` +
        "Re-run at a quieter time if any of these must be covered.",
    );
  }
}
