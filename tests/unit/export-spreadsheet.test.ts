// @vitest-environment node
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildCsvZip,
  buildXlsx,
  csvField,
  sheetNames,
  toCsv,
  type Sheet,
} from "@/lib/export/spreadsheet";

/**
 * The export file builders. Asserted: the workbook is a well-formed OOXML
 * package; text is always a text cell, never a formula; CSV text a spreadsheet
 * would evaluate is neutralised; Unicode survives both formats; empty sheets
 * keep their header row.
 */
const SHEET: Sheet = {
  name: "Assets",
  columns: ["Name", "Value", "Added", "Born", "Active"],
  rows: [
    ["Café ☕ 中文 👪", 1250.5, new Date("2026-01-02T03:04:05Z"), { day: "1980-07-15" }, true],
    ['=HYPERLINK("http://evil","x")', -42, null, null, false],
    ['<tag> & "quotes"\nsecond line', 0, null, null, null],
  ],
};

function unzipText(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

describe("csvField", () => {
  it.each([
    ["=1+1", `"'=1+1"`],
    ["+44 20", `"'+44 20"`],
    ["-cmd", `"'-cmd"`],
    ["@SUM(A1)", `"'@SUM(A1)"`],
    ["\tx", `"'\tx"`],
    ["\rx", `"'\rx"`],
  ])("neutralises formula-like text %j", (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });

  it("leaves numbers, booleans and ordinary text as they are", () => {
    expect(csvField(-42)).toBe("-42");
    expect(csvField(1250.5)).toBe("1250.5");
    expect(csvField(true)).toBe("TRUE");
    expect(csvField(null)).toBe("");
    expect(csvField(Number.NaN)).toBe("");
    expect(csvField("plain")).toBe(`"plain"`);
    expect(csvField('say "hi"')).toBe(`"say ""hi"""`);
  });

  it("writes dates in UTC as text Excel parses", () => {
    expect(csvField(new Date("2026-01-02T03:04:05.678Z"))).toBe("2026-01-02 03:04:05");
    expect(csvField({ day: "1980-07-15" })).toBe("1980-07-15");
  });

  it("caps a cell at Excel's 32,767 characters", () => {
    const field = csvField("x".repeat(40_000));
    expect(field.length).toBe(32_767 + 2);
    expect(field).toContain("[truncated]");
  });
});

describe("toCsv", () => {
  it("is UTF-8 with a BOM, CRLF rows and a header first", () => {
    const csv = toCsv(SHEET);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(`"Name","Value","Added","Born","Active"`);
    expect(lines[1]).toBe(`"Café ☕ 中文 👪",1250.5,2026-01-02 03:04:05,1980-07-15,TRUE`);
    expect(lines[2]).toBe(`"'=HYPERLINK(""http://evil"",""x"")",-42,,,FALSE`);
    // An embedded newline stays inside its quoted field.
    expect(csv).toContain(`"<tag> & ""quotes""\nsecond line",0,,,\r\n`);
  });

  it("writes only the header for an empty sheet", () => {
    expect(toCsv({ name: "Empty", columns: ["A", "B"], rows: [] })).toBe(`﻿"A","B"\r\n`);
  });
});

describe("sheetNames", () => {
  it("applies Excel's rules and keeps names unique", () => {
    const names = sheetNames([
      "A very long sheet name that exceeds the limit",
      "A very long sheet name that exceeds the limit",
      "Bad:/\\?*[]chars",
      "",
      "assets",
      "Assets",
    ]);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/[:\\/?*[\]]/);
    }
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(names[3]).toBe("Sheet");
  });
});

describe("buildXlsx", () => {
  const files = unzipText(
    buildXlsx(
      [SHEET, { name: "Empty", columns: ["Only"], rows: [] }],
      new Date("2026-10-16T00:00:00Z"),
    ),
  );

  it("is a complete SpreadsheetML package with one worksheet per sheet, in order", () => {
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(files["xl/workbook.xml"]).toMatch(
      /<sheet name="Assets" sheetId="1" r:id="rId1"\/><sheet name="Empty" sheetId="2" r:id="rId2"\/>/,
    );
    expect(files["[Content_Types].xml"]).toContain('PartName="/xl/worksheets/sheet2.xml"');
    expect(files["xl/_rels/workbook.xml.rels"]).toContain('Target="styles.xml"');
  });

  it("stores text as text cells only, so nothing is ever evaluated as a formula", () => {
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    expect(sheet).not.toMatch(/<f[ >]/);
    expect(sheet).toContain(
      '<c r="A3" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://evil&quot;,&quot;x&quot;)</t></is></c>',
    );
  });

  it("escapes XML and keeps Unicode", () => {
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain("&lt;tag&gt; &amp; &quot;quotes&quot;\nsecond line");
    expect(sheet).toContain("Café ☕ 中文 👪");
  });

  it("writes numbers, booleans and dates as typed cells with a bold frozen header", () => {
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('<c r="B2"><v>1250.5</v></c>');
    expect(sheet).toContain('<c r="B3"><v>-42</v></c>');
    expect(sheet).toContain('<c r="E2" t="b"><v>1</v></c>');
    // 2026-01-02T03:04:05Z as an Excel serial with the date-time style.
    expect(sheet).toMatch(/<c r="C2" s="2"><v>46024\.127835\d*<\/v><\/c>/);
    expect(sheet).toContain('<c r="D2" s="3"><v>29417</v></c>');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(sheet).toContain('state="frozen"');
  });

  it("drops characters XML cannot hold instead of producing a corrupt file", () => {
    const bad = unzipText(
      buildXlsx([{ name: "S", columns: ["A"], rows: [["ok\u0000\u0007\uD800end"]] }]),
    )["xl/worksheets/sheet1.xml"]!;
    expect(bad).toContain(">okend<");
  });

  it("keeps the header row of an empty sheet", () => {
    expect(files["xl/worksheets/sheet2.xml"]).toContain(
      '<sheetData><row r="1"><c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Only</t></is></c></row></sheetData>',
    );
  });
});

describe("buildCsvZip", () => {
  it("holds a README and one numbered CSV per sheet", () => {
    const zip = buildCsvZip(
      [SHEET, { name: "Dead Man's Switch", columns: ["A"], rows: [] }],
      "Line 1\nLine 2\n",
    );
    const files = unzipText(zip);
    expect(Object.keys(files)).toEqual(["README.txt", "01-assets.csv", "02-dead-man-s-switch.csv"]);
    expect(files["README.txt"]).toBe("Line 1\r\nLine 2\r\n");
    // TextDecoder drops a BOM when decoding, so check the stored bytes for it.
    expect(Array.from(unzipSync(zip)["01-assets.csv"]!.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(files["01-assets.csv"]).toBe(toCsv(SHEET).slice(1));
  });
});
