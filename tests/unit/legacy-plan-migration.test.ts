import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeWizardStep } from "@/lib/legacy-plan/steps";

const migration = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/0015_seven_step_legacy_plan.sql"),
  "utf8",
);

describe("seven-step legacy plan migration", () => {
  it("maps only old draft cursors without rewriting finalized history", () => {
    expect(migration).toContain("where status = 'DRAFT'");
    expect(migration).toMatch(
      /when 5 then 4[\s\S]*when 6 then 4[\s\S]*when 7 then 4[\s\S]*when 8 then 4[\s\S]*when 9 then 5[\s\S]*when 10 then 6[\s\S]*when 11 then 7/,
    );
    expect(migration).not.toContain("where current_step > 7");
  });

  it("keeps the application cursor mapping aligned with the migration", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(normalizeWizardStep)).toEqual([
      1, 2, 3, 4, 4, 4, 4, 4, 5, 6, 7,
    ]);
  });

  it("filters finalized snapshot records to the plan references", () => {
    expect(migration).toContain("b.id = any(v_beneficiary_ids)");
    expect(migration).toContain("a.id = any(v_financial_asset_ids)");
    expect(migration).toContain("da.document_id = any(v_document_ids)");
  });
});
