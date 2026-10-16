import { NextResponse } from "next/server";

import { withApi } from "@/lib/api/with-api";
import { accountSheets } from "@/lib/export/account-sheets";
import { buildCsvZip, buildXlsx } from "@/lib/export/spreadsheet";
import * as accountService from "@/lib/services/account.service";
import { exportQuerySchema, type ExportQuery } from "@/lib/validators/user.validators";

/**
 * Exports everything the account holds (api-contracts.md § Users).
 *
 * This is the one read that returns the decrypted sensitive fields in bulk, so
 * it is re-verified, rate-limited as a sensitive operation and audited with
 * counts only — never with the values.
 *
 * `?format=xlsx` is an Excel workbook, `?format=csv` a ZIP of one CSV per
 * sheet, and the default stays the JSON envelope API callers already use.
 * Files are built in memory and sent as attachments; `withApi` marks every
 * response `private, no-store`.
 */
/**
 * A full export reads every table the account owns and decrypts its sensitive fields.
 *
 * The platform default is far shorter than this work can take, and a
 * truncated run is worse than a slow one.
 */
export const maxDuration = 120;

const FILES = {
  xlsx: {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    suffix: ".xlsx",
  },
  csv: { type: "application/zip", suffix: "-csv.zip" },
} as const;

export const GET = withApi<undefined, ExportQuery>(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "strict",
    schema: { query: exportQuerySchema },
  },
  async ({ user, correlationId, query }) => {
    const data = await accountService.exportData(user, correlationId, query.format);
    if (query.format === "json") return data;

    const { sheets, readme } = accountSheets(data);
    const exportedAt = new Date(data.exportedAt);
    const bytes =
      query.format === "xlsx"
        ? buildXlsx(sheets, exportedAt)
        : buildCsvZip(sheets, readme, exportedAt);
    const file = FILES[query.format];
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": file.type,
        "Content-Disposition": `attachment; filename="legacyvault-export-${data.exportedAt.slice(0, 10)}${file.suffix}"`,
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
