import "server-only";

import { strToU8, zipSync, type Zippable } from "fflate";

/**
 * Spreadsheet files for the account export: an Excel workbook (.xlsx) and a
 * ZIP of CSV files, one per sheet. Pure functions over plain rows, so every
 * escaping and safety rule is unit-tested.
 *
 * The workbook is minimal SpreadsheetML (ECMA-376): inline strings, a styles
 * part for the bold header and date formats, a frozen header row. Strings are
 * always written as text cells, never as formulas, so a value such as
 * `=HYPERLINK(...)` is shown, not run. CSV has no cell types, so a text value
 * that a spreadsheet would start evaluating (= + - @, tab, carriage return) is
 * prefixed with an apostrophe (OWASP CSV-injection guidance).
 */

/** A calendar date with no time of day (e.g. a date of birth). */
export interface Day {
  day: string; // YYYY-MM-DD
}

export type Cell = string | number | boolean | Date | Day | null;

export interface Sheet {
  name: string;
  columns: string[];
  rows: Cell[][];
}

/* ── Values ───────────────────────────────────────────────────────────────── */

const MAX_CELL_TEXT = 32_767; // Excel's limit for one cell
const TRUNCATED = "… [truncated]";

function isDay(value: Cell): value is Day {
  return typeof value === "object" && value !== null && !(value instanceof Date) && "day" in value;
}

function clip(text: string): string {
  return text.length <= MAX_CELL_TEXT
    ? text
    : text.slice(0, MAX_CELL_TEXT - TRUNCATED.length) + TRUNCATED;
}

/** `YYYY-MM-DD HH:MM:SS` in UTC — what Excel and LibreOffice parse as a date-time. */
export function formatTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function excelSerial(date: Date): number {
  return date.getTime() / 86_400_000 + 25_569;
}

/* ── CSV ──────────────────────────────────────────────────────────────────── */

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field, quoted, with the formula-injection guard applied to text. */
export function csvField(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return formatTimestamp(value);
  if (isDay(value)) return value.day;
  const text = clip(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** RFC 4180 CSV with a UTF-8 byte-order mark so Excel reads Unicode correctly. */
export function toCsv(sheet: Sheet): string {
  const lines = [sheet.columns, ...sheet.rows].map((row) =>
    sheet.columns.map((_, index) => csvField(row[index] ?? null)).join(","),
  );
  return `﻿${lines.join("\r\n")}\r\n`;
}

/* ── XLSX ─────────────────────────────────────────────────────────────────── */

/** Characters XML 1.0 forbids, including lone surrogates. */
const XML_INVALID =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function xml(text: string): string {
  return text
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

// Style indexes in styles.xml (cellXfs).
const STYLE_HEADER = 1;
const STYLE_DATETIME = 2;
const STYLE_DAY = 3;

function xlsxCell(value: Cell, ref: string, header: boolean): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : "";
  }
  if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : `<c r="${ref}" s="${STYLE_DATETIME}"><v>${excelSerial(value)}</v></c>`;
  }
  if (isDay(value)) {
    const date = new Date(`${value.day}T00:00:00Z`);
    return Number.isNaN(date.getTime())
      ? xlsxCell(value.day, ref, header)
      : `<c r="${ref}" s="${STYLE_DAY}"><v>${excelSerial(date)}</v></c>`;
  }
  const style = header ? ` s="${STYLE_HEADER}"` : "";
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(clip(value))}</t></is></c>`;
}

function displayLength(value: Cell): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return 16;
  if (isDay(value)) return 10;
  return String(value).split("\n")[0]!.length;
}

function worksheetXml(sheet: Sheet): string {
  const all = [sheet.columns, ...sheet.rows];
  const widths = sheet.columns.map((_, column) =>
    Math.min(60, Math.max(10, ...all.map((row) => displayLength(row[column] ?? null) + 2))),
  );
  const cols = widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");
  const rows = all
    .map((row, rowIndex) => {
      const cells = sheet.columns
        .map((_, column) =>
          xlsxCell(row[column] ?? null, `${columnName(column)}${rowIndex + 1}`, rowIndex === 0),
        )
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rows}</sheetData>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/>` +
  `<numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** Excel's sheet-name rules: ≤ 31 characters, none of : \ / ? * [ ], unique. */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base =
      raw
        .replace(/[:\\/?*[\]]/g, " ")
        .replace(/^'+|'+$/g, "")
        .trim()
        .slice(0, 31) || "Sheet";
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** A valid .xlsx workbook, one worksheet per sheet, in the given order. */
export function buildXlsx(sheets: Sheet[], modified = new Date()): Uint8Array {
  const names = sheetNames(sheets.map((sheet) => sheet.name));
  const sheetEntries = sheets.map((_, index) => `xl/worksheets/sheet${index + 1}.xml`);
  const files: Zippable = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheetEntries
          .map(
            (entry) =>
              `<Override PartName="/${entry}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        `</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${names
          .map(
            (name, index) =>
              `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
          )
          .join("")}</sheets>` +
        `</workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheetEntries
          .map(
            (_, index) =>
              `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
    "xl/styles.xml": strToU8(STYLES_XML),
  };
  sheets.forEach((sheet, index) => {
    files[sheetEntries[index]!] = strToU8(worksheetXml(sheet));
  });
  return zipSync(files, { level: 6, mtime: modified });
}

/** A ZIP of UTF-8 CSV files, one per sheet, numbered to keep their order, plus a README. */
export function buildCsvZip(sheets: Sheet[], readme: string, modified = new Date()): Uint8Array {
  const files: Zippable = { "README.txt": strToU8(readme.replace(/\r?\n/g, "\r\n")) };
  sheets.forEach((sheet, index) => {
    const slug =
      sheet.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "sheet";
    files[`${String(index + 1).padStart(2, "0")}-${slug}.csv`] = strToU8(toCsv(sheet));
  });
  return zipSync(files, { level: 6, mtime: modified });
}
