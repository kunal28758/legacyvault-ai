// Reads one value from `supabase db query --output-format json` output
// (scripts/backup/backup-verify.sh).
//
// The CLI's JSON shape depends on where it runs: a bare array of rows in a
// normal terminal, an object with `rows` when it detects an AI agent. Without
// `--output-format json` a terminal even gets a text table. Both JSON shapes
// are accepted; anything else is refused with a reason that never quotes the
// output, because in production it can hold query results.

/**
 * @param {string} text   the CLI's stdout
 * @param {string} column the one column to read from the one row
 * @param {{ jsonObject?: boolean }} [options] the value must be a non-empty JSON object
 * @returns {string}
 */
export function queryValue(text, column, { jsonObject = false } = {}) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) throw new Error("the query printed nothing");
  const start = trimmed.search(/[[{]/);
  if (start < 0) throw new Error("the query output is not JSON (pass --output-format json)");
  let parsed;
  try {
    parsed = JSON.parse(trimmed.slice(start));
  } catch {
    throw new Error("the query output is not valid JSON");
  }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : null;
  if (!rows) throw new Error("the query output has no rows");
  if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}`);
  const value = rows[0]?.[column];
  if (value === null || value === undefined || value === "") {
    throw new Error(`the row has no value for "${column}"`);
  }
  const result = typeof value === "string" ? value : JSON.stringify(value);
  if (jsonObject) {
    let object;
    try {
      object = JSON.parse(result);
    } catch {
      throw new Error(`"${column}" is not valid JSON`);
    }
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      throw new Error(`"${column}" is not a JSON object`);
    }
    if (Object.keys(object).length === 0) throw new Error(`"${column}" is empty`);
  }
  return result;
}

const invokedDirectly = (process.argv[1] ?? "")
  .replace(/\\/g, "/")
  .endsWith("scripts/backup/query-value.mjs");
if (invokedDirectly) {
  // query-value.mjs <column> [--json-object] < output
  const [column, flag] = process.argv.slice(2);
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => {
    try {
      process.stdout.write(queryValue(text, column, { jsonObject: flag === "--json-object" }));
    } catch (error) {
      console.error(`query output rejected: ${error.message}`);
      process.exit(1);
    }
  });
}
