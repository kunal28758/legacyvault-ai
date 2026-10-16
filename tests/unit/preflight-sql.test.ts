// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The account-deletion preflight runs against production by an operator
 * (docs/DEPLOYMENT.md § 7d-2). It must stay one read-only aggregate query:
 * a write, a second statement, a side-effecting function or a selected
 * personal value would make that run unsafe.
 */
const sql = readFileSync(
  path.resolve(__dirname, "../../scripts/account-deletion/preflight.sql"),
  "utf8",
)
  .replace(/--.*$/gm, "")
  .trim();
// String literals (e.g. the job type 'user.hard-delete') are data, not SQL.
const code = sql.replace(/'[^']*'/g, "''");

/** Index of the parenthesis that closes the one at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")" && --depth === 0) return index;
  }
  return -1;
}

describe("account-deletion preflight", () => {
  it("is a single SELECT statement", () => {
    expect(code).toMatch(/^select\b/i);
    expect(code.replace(/;\s*$/, "")).not.toContain(";");
  });

  it("cannot write, lock or create anything", () => {
    expect(code).not.toMatch(
      /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|copy|call|do|perform|lock|into|share)\b/i,
    );
  });

  it("calls only side-effect-free functions", () => {
    // Every `name(` except a derived-column list (`as v(k)`) and SQL syntax.
    const calls = new Set(
      [...code.matchAll(/(?<!\bas\s)\b([a-z_][a-z0-9_.]*)\s*\(/gi)].map((match) =>
        match[1].toLowerCase(),
      ),
    );
    const syntax = ["filter", "in", "lateral", "values"];
    const functions = ["count", "now", "split_part"];
    expect([...calls].sort()).toEqual([...syntax, ...functions].sort());
  });

  it("selects eleven counts and nothing else", () => {
    const outer = code.slice(code.indexOf("select") + 6, code.lastIndexOf("from public.users"));
    const expressions = outer
      .split(/\bas\s+\w+\s*(?:,|$)/i)
      .map((part) => part.trim())
      .filter(Boolean);
    expect(expressions).toHaveLength(11);
    for (const expression of expressions) {
      if (/^count\(\*\)/i.test(expression)) {
        // `count(*) filter (where …)` and nothing after the filter.
        const open = expression.search(/\bfilter\s*\(/i);
        expect(open, expression).toBeGreaterThan(0);
        const start = expression.indexOf("(", open);
        expect(closing(expression, start), expression).toBe(expression.length - 1);
      } else {
        // `(select count(*) from …)` and nothing outside the sub-select.
        expect(expression).toMatch(/^\(\s*select\s+count\(\*\)\s+from\b/i);
        expect(closing(expression, 0), expression).toBe(expression.length - 1);
      }
    }
  });
});
