// @vitest-environment node
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  decodeText,
  decodeXmlEntities,
  extractDocumentText,
  readZipParts,
  wordXmlToText,
} from "@/lib/ai/documents/extract-text";
import { sectionsFromOcr } from "@/lib/services/ai/document-ai.service";

/**
 * Document text extraction (ADR-008 § 5), on real file structures built in the
 * test: Office Open XML containers, a text-layer PDF and a scan-like PDF.
 */
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** A minimal, valid single-page PDF; `text` null gives a page with no text layer. */
function pdf(text: string | null): Uint8Array {
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(body);
}

describe("plain text", () => {
  it("decodes UTF-8 with or without a BOM, and UTF-16 by its BOM", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe("hi");
    expect(decodeText(strToU8("namaste"))).toBe("namaste");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe("hi");
  });
});

describe("Office Open XML", () => {
  it("reads Word paragraphs, tabs and breaks in order", () => {
    const xml =
      '<w:body><w:p><w:r><w:t>Last Will</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Executor:</w:t><w:tab/><w:t>A &amp; B</w:t></w:r><w:br/><w:r><w:t>Line two</w:t></w:r></w:p></w:body>';
    expect(wordXmlToText(xml)).toBe("Last Will\nExecutor:\tA & B\nLine two");
  });

  it("decodes XML entities including numeric ones", () => {
    expect(decodeXmlEntities("&lt;a&gt; &#8377;100 &#x20B9;5 &quot;x&quot;")).toBe(
      '<a> ₹100 ₹5 "x"',
    );
  });

  it("extracts a .docx", async () => {
    const file = zipSync({
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>Deed of Gift</w:t></w:r></w:p></w:body></w:document>",
      ),
      "word/styles.xml": strToU8("<ignored/>"),
    });
    const result = await extractDocumentText(file, DOCX);
    expect(result.method).toBe("office-xml");
    expect(result.sections[0]).toEqual({ label: "Document", text: "Deed of Gift" });
  });

  it("extracts an .xlsx sheet as rows with shared strings resolved", async () => {
    const file = zipSync({
      "xl/workbook.xml": strToU8(
        '<workbook><sheets><sheet name="Assets" sheetId="1"/></sheets></workbook>',
      ),
      "xl/sharedStrings.xml": strToU8(
        "<sst><si><t>Account</t></si><si><t>Balance</t></si><si><t>Savings, main</t></si></sst>",
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>125000</v></c></row></sheetData></worksheet>',
      ),
    });
    const result = await extractDocumentText(file, XLSX);
    expect(result.sections).toEqual([
      { label: "Sheet: Assets", text: 'Account,Balance\n"Savings, main",,125000' },
    ]);
  });

  it("extracts .pptx slides in order with speaker notes", async () => {
    const file = zipSync({
      "ppt/slides/slide2.xml": strToU8("<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>"),
      "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>"),
      "ppt/notesSlides/notesSlide1.xml": strToU8(
        "<p:notes><a:p><a:r><a:t>Say hello</a:t></a:r></a:p></p:notes>",
      ),
    });
    const result = await extractDocumentText(file, PPTX);
    expect(result.sections.map((s) => s.label)).toEqual(["Slide 1", "Slide 2"]);
    expect(result.sections[0]!.text).toBe("First\n\nSpeaker notes:\nSay hello");
  });

  it("refuses a part that inflates past the limit (zip bomb)", () => {
    const huge = new Uint8Array(26 * 1_048_576); // compresses to almost nothing
    const file = zipSync({ "word/document.xml": huge });
    expect(() => readZipParts(file, () => true)).toThrow(/too large/);
  });
});

describe("PDF", () => {
  it("reads the text layer page by page", async () => {
    const result = await extractDocumentText(
      pdf("This Last Will and Testament is made by Priya Sharma of Mumbai on this day"),
      "application/pdf",
    );
    expect(result.method).toBe("pdf-text");
    expect(result.unitCount).toBe(1);
    expect(result.sections[0]!.label).toBe("Page 1");
    expect(result.sections[0]!.text).toContain("Priya Sharma");
  });

  it("marks a PDF without a text layer for OCR", async () => {
    const result = await extractDocumentText(pdf(null), "application/pdf");
    expect(result).toMatchObject({ method: "needs-ocr", sections: [], unitCount: 1 });
  });
});

describe("other types", () => {
  it("sends images to OCR and refuses legacy binary Office files", async () => {
    expect(
      (await extractDocumentText(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).method,
    ).toBe("needs-ocr");
    expect(
      (await extractDocumentText(new Uint8Array([0xd0, 0xcf]), "application/msword")).method,
    ).toBe("unsupported");
  });

  it("splits OCR output on its page markers", () => {
    expect(sectionsFromOcr("[Page 1]\nHello\n[Page 2]\nWorld")).toEqual([
      { label: "Page 1", text: "Hello" },
      { label: "Page 2", text: "World" },
    ]);
    expect(sectionsFromOcr("Just text")).toEqual([{ label: "Page 1", text: "Just text" }]);
  });
});
