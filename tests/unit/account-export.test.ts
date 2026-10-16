// @vitest-environment node
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { accountSheets } from "@/lib/export/account-sheets";
import type { Cell } from "@/lib/export/spreadsheet";
import { setRateLimitStore } from "@/lib/security/rate-limit";
import type { AccountExport } from "@/lib/services/account.service";

import { GET as exportRoute } from "@/app/api/v1/users/me/export/route";

/**
 * The account export in its three formats, through the real `withApi()`
 * pipeline. Only the session lookup, Clerk's step-up check, the audit sink, the
 * limiter's store and the data read are replaced. Asserted: no file without a
 * session and a fresh re-verification; the files are
 * what their headers say and are never cacheable; the readable sheets carry
 * names instead of ids, leave out deleted rows, and never storage locations.
 */
const session = vi.hoisted(() => ({ user: null as AppUser | null, fresh: true }));
const reads = vi.hoisted(() => [] as { userId: string; format: string }[]);
const fixture = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/auth/require-user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/require-user")>();
  return {
    ...actual,
    requireUser: async () => {
      if (!session.user) throw ApiError.unauthenticated();
      return session.user;
    },
  };
});
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ has: () => session.fresh }),
}));
vi.mock("@/lib/audit/audit.service", () => ({
  audit: { log: async () => undefined, diff: () => ({}), redact: (value: unknown) => value },
  recordAudit: async () => undefined,
}));
vi.mock("@/lib/services/account.service", () => ({
  exportData: async (user: AppUser, _correlationId: string, format: string) => {
    reads.push({ userId: user.id, format });
    return fixture.current;
  },
}));

const OWNER: AppUser = {
  id: "11111111-1111-4111-8111-111111111111",
  clerkUserId: "user_owner",
  email: "owner@example.com",
  emailVerified: true,
  name: "Owner",
  mfaEnabled: true,
  role: "USER",
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  deletionRequestedAt: null,
};

const T = "2026-03-04T05:06:07.000Z";
const STORAGE_KEY = "users/11111111/documents/secret-object-key";
const BEN = "aaaaaaaa-0000-4000-8000-000000000001";
const GONE = "aaaaaaaa-0000-4000-8000-000000000002";
const BANK = "bbbbbbbb-0000-4000-8000-000000000001";
const DOC = "cccccccc-0000-4000-8000-000000000001";
const PARENT = "dddddddd-0000-4000-8000-000000000001";
const CHILD = "dddddddd-0000-4000-8000-000000000002";
const PLAN = "eeeeeeee-0000-4000-8000-000000000001";
const CONFIG = "ffffffff-0000-4000-8000-000000000001";

function exportFixture(): AccountExport {
  const asset = {
    estimatedValue: null,
    currency: "INR",
    notes: null,
    profile: null,
    createdAt: T,
    updatedAt: T,
  };
  return {
    exportedAt: "2026-10-16T08:00:00.000Z",
    profile: {
      id: OWNER.id,
      email: OWNER.email,
      emailVerified: true,
      name: "Asha Rao",
      mfaEnabled: true,
      role: "USER",
      dateOfBirth: "1980-07-15",
      phone: "+91 98765 43210",
      alternateEmail: null,
      address: { line1: "12 MG Road", city: "Pune", country: "IN" },
      familyInfo: { maritalStatus: "married", children: [{ name: "Kiran" }] },
      preferences: { theme: "dark" },
      notificationPreferences: { email: true },
      securityPreferences: {},
      hasIdentificationDetails: true,
      onboardingCompletedAt: T,
      lastLoginAt: T,
      deletionRequestedAt: null,
      createdAt: T,
    },
    beneficiaries: [
      {
        id: BEN,
        user_id: OWNER.id,
        name: "Meera Rao",
        relationship: "Daughter",
        email: "meera@example.com",
        phone: null,
        notes: "=cmd|' /C calc'!A0",
        status: "ACTIVE",
        invited_at: T,
        activated_at: T,
        created_at: T,
        updated_at: T,
        deleted_at: null,
      },
      {
        id: GONE,
        user_id: OWNER.id,
        name: "Removed Person",
        relationship: "Friend",
        email: "gone@example.com",
        phone: null,
        notes: null,
        status: "INACTIVE",
        invited_at: null,
        activated_at: null,
        created_at: T,
        updated_at: T,
        deleted_at: T,
      },
    ],
    assignments: [
      {
        id: "f1",
        user_id: OWNER.id,
        beneficiary_id: BEN,
        resource_id: BANK,
        resource_type: "FINANCIAL_ASSET",
        allocation_percentage: 60,
        created_at: T,
        updated_at: T,
      },
    ],
    assets: {
      FINANCIAL_ASSET: [
        {
          ...asset,
          id: BANK,
          kind: "FINANCIAL_ASSET",
          name: "Savings",
          category: "BANK_ACCOUNT",
          institution: "State Bank",
          hasAccountNumber: true,
          hasPolicyNumber: false,
          estimatedValue: 250000,
          accountNumber: "0012345678",
          policyNumber: null,
        },
      ],
      PHYSICAL_ASSET: [],
      DIGITAL_ASSET: [
        {
          ...asset,
          id: "g1",
          kind: "DIGITAL_ASSET",
          name: "Email",
          category: "ONLINE_ACCOUNT",
          platform: "Mail",
          username: "asha",
          hasCredentials: true,
          hasRecoveryInfo: false,
          credentials: "in my password manager",
          recoveryInfo: null,
        },
      ],
    },
    folders: [
      {
        id: PARENT,
        user_id: OWNER.id,
        name: "Legal",
        parent_id: null,
        created_at: T,
        updated_at: T,
        deleted_at: null,
      },
      {
        id: CHILD,
        user_id: OWNER.id,
        name: "Property",
        parent_id: PARENT,
        created_at: T,
        updated_at: T,
        deleted_at: null,
      },
    ],
    documents: [
      {
        id: DOC,
        user_id: OWNER.id,
        name: "Sale deed.pdf",
        folder_id: CHILD,
        mime_type: "application/pdf",
        size_bytes: 52_431,
        scan_status: "CLEAN",
        storage_bucket: "vault",
        storage_key: STORAGE_KEY,
        encryption_key_id: "kek-1",
        encryption_mode: "APP_ENVELOPE",
        current_version_id: null,
        metadata: { profile: { category: "PROPERTY", expiresOn: "2030-01-01" } },
        created_at: T,
        updated_at: T,
        deleted_at: null,
      },
    ],
    documentVersions: [
      {
        id: "v1",
        document_id: DOC,
        version_number: 1,
        size_bytes: 52_431,
        storage_key: STORAGE_KEY,
        uploaded_by: OWNER.id,
        created_at: T,
      },
    ],
    videos: [],
    legacyPlans: [
      {
        id: PLAN,
        user_id: OWNER.id,
        status: "DRAFT",
        version: 1,
        current_step: 3,
        lock_version: 4,
        confirmed_by: null,
        finalized_at: null,
        completion_status: {},
        steps_data: {
          "personal-details": { fullName: "Asha Rao", dateOfBirth: "1980-07-15" },
          beneficiaries: { beneficiaryIds: [BEN] },
        },
        created_at: T,
        updated_at: T,
        deleted_at: null,
      },
    ],
    legacyPlanVersions: [],
    aiDrafts: [],
    aiAnalyses: [
      {
        draftId: "ai1",
        documentId: DOC,
        versionNumber: 2,
        createdAt: T,
        createdBy: "AI",
        provider: "gemini",
        model: "gemini-2.5-flash",
        action: "summary",
        language: "en",
        data: { summary: "A sale deed for the Pune flat", parties: ["Asha Rao", "Builder Ltd"] },
      },
    ],
    aiInteractions: [
      {
        id: "i1",
        user_id: OWNER.id,
        session_type: "DOCUMENT_ANALYSIS",
        provider: "gemini",
        model: "gemini-2.5-flash",
        prompt_version: "v3",
        token_count: 1200,
        cost_estimate: null,
        draft_id: "ai1",
        input_summary: "pdf, 2 pages",
        output_summary: "summary",
        validation: null,
        created_at: T,
      },
    ],
    deletedAssets: [
      {
        kind: "PHYSICAL_ASSET",
        id: "p-old",
        name: "Old scooter",
        category: "VEHICLE",
        deleted_at: T,
      },
    ],
    documentAttachments: [
      {
        id: "att1",
        user_id: OWNER.id,
        document_id: DOC,
        resource_type: "FINANCIAL_ASSET",
        resource_id: BANK,
        created_at: T,
      },
    ],
    deadManSwitch: null,
    deadManSwitchContacts: [],
    deadManSwitchEvents: [
      {
        id: "ev1",
        dead_man_switch_id: "dms1",
        event_type: "CHECK_IN",
        previous_state: "REMINDER_SENT",
        new_state: "ACTIVE",
        metadata: null,
        created_at: T,
      },
    ],
    emergencyContacts: [
      {
        id: CONFIG,
        user_id: OWNER.id,
        beneficiary_id: BEN,
        status: "ACTIVE",
        verification_method: "EMAIL_OTP",
        request_expiry_hours: 24,
        timeout_hours: 48,
        on_timeout: "WAIT",
        access_duration_hours: 72,
        access_scope: {},
        last_designation_sent_at: null,
        created_at: T,
        updated_at: T,
        deleted_at: null,
      },
    ],
    emergencyRequests: [
      {
        id: "req1",
        config_id: CONFIG,
        requester_email: "meera@example.com",
        status: "DENIED",
        request_expires_at: T,
        decided_by: "OWNER",
        decided_at: T,
        granted_at: null,
        expires_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: T,
      },
    ],
    accessLinks: [
      {
        id: "tok1",
        beneficiary_id: BEN,
        grant_type: "DIRECT_SHARE",
        scope: { documents: [DOC] },
        expires_at: T,
        revoked_at: null,
        revoked_reason: null,
        delivered_at: T,
        used_at: null,
        last_used_at: null,
        created_at: T,
        verified_at: null,
      },
    ],
    notifications: [],
    auditLog: [
      {
        id: "a1",
        actor_id: OWNER.id,
        actor_role: "USER",
        action: "user.data_exported",
        resource_type: "users",
        resource_id: OWNER.id,
        outcome: "SUCCESS",
        ip_address: "203.0.113.9",
        user_agent: "Firefox",
        metadata: null,
        correlation_id: "c1",
        created_at: T,
      },
    ],
  } as AccountExport;
}

beforeEach(() => {
  session.user = OWNER;
  session.fresh = true;
  reads.length = 0;
  fixture.current = exportFixture();
  setRateLimitStore({ hit: async () => ({ allowed: true, count: 1 }) });
});

function get(query = "") {
  return exportRoute(
    new Request(`http://localhost:3000/api/v1/users/me/export${query}`, {
      headers: { "sec-fetch-site": "same-origin" },
    }),
  );
}

function unzipped(bytes: ArrayBuffer): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(bytes))).map(([name, data]) => [name, strFromU8(data)]),
  );
}

describe("GET /users/me/export", () => {
  it("sends an Excel workbook as a private, uncacheable attachment", async () => {
    const response = await get("?format=xlsx");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="legacyvault-export-2026-10-16.xlsx"',
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const files = unzipped(await response.arrayBuffer());
    expect(files["xl/workbook.xml"]).toContain('<sheet name="About this export"');
    expect(Object.keys(files).filter((name) => name.startsWith("xl/worksheets/"))).toHaveLength(26);
    expect(Object.values(files).join("")).not.toContain(STORAGE_KEY);
    expect(reads).toEqual([{ userId: OWNER.id, format: "xlsx" }]);
  });

  it("sends CSV files in a ZIP", async () => {
    const response = await get("?format=csv");
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain(
      "legacyvault-export-2026-10-16-csv.zip",
    );
    const files = unzipped(await response.arrayBuffer());
    expect(Object.keys(files)[0]).toBe("README.txt");
    expect(files["02-profile.csv"]).toContain('"Email","owner@example.com"');
    // The beneficiary note that would run as a formula is kept as text.
    expect(files["03-beneficiaries.csv"]).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(Object.values(files).join("")).not.toContain(STORAGE_KEY);
  });

  it("keeps the JSON envelope as the default for API callers", async () => {
    const response = await get();
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      success: true,
      data: { exportedAt: "2026-10-16T08:00:00.000Z" },
    });
    expect(reads).toEqual([{ userId: OWNER.id, format: "json" }]);
  });

  it.each([["?format=pdf"], ["?format=xlsx&userId=22222222-2222-4222-8222-222222222222"]])(
    "refuses an unknown format or extra parameter: %s",
    async (query) => {
      const response = await get(query);
      expect(response.status).toBe(422);
      expect(reads).toEqual([]);
    },
  );

  it("refuses without a session or without a fresh re-verification", async () => {
    session.user = null;
    expect((await get("?format=xlsx")).status).toBe(401);
    session.user = OWNER;
    session.fresh = false;
    const stale = await get("?format=xlsx");
    expect(stale.status).toBe(403);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe(
      "REVERIFICATION_REQUIRED",
    );
    expect(reads).toEqual([]);
  });
});

describe("accountSheets", () => {
  const { sheets, readme } = accountSheets(exportFixture());
  const sheet = (name: string) => sheets.find((s) => s.name === name)!;
  const value = (name: string, field: string): Cell | undefined =>
    sheet(name).rows.find((row) => row[0] === field)?.[1];

  it("has one sheet per category, in a fixed order", () => {
    expect(sheets.map((s) => s.name)).toEqual([
      "About this export",
      "Profile",
      "Beneficiaries",
      "Financial assets",
      "Physical assets",
      "Digital assets",
      "Assignments",
      "Documents",
      "Document versions",
      "Document attachments",
      "Folders",
      "Video messages",
      "Will plans",
      "Will plan content",
      "Will plan history",
      "Dead Man's Switch",
      "Check-in history",
      "Emergency contacts",
      "Emergency requests",
      "Access links",
      "AI analyses",
      "AI drafts",
      "AI usage",
      "Notifications",
      "Account activity",
      "Deleted items",
    ]);
    for (const s of sheets) for (const row of s.rows) expect(row).toHaveLength(s.columns.length);
  });

  it("writes readable values: labels, dates, joined addresses, flattened family details", () => {
    expect(value("Profile", "Date of birth")).toEqual({ day: "1980-07-15" });
    expect(value("Profile", "Address")).toBe("12 MG Road, Pune, IN");
    expect(value("Profile", "Family · Marital status")).toBe("married");
    expect(value("Profile", "Family · Children 1 · Name")).toBe("Kiran");
    expect(value("Profile", "Identification details")).toMatch(/not included/);
    expect(value("Profile", "Account created")).toEqual(new Date(T));
    expect(sheet("Financial assets").rows[0]).toEqual(
      expect.arrayContaining([
        "Savings",
        "Bank account",
        "State Bank",
        "0012345678",
        250000,
        "Active",
      ]),
    );
    expect(sheet("Digital assets").rows[0]).toContain("in my password manager");
  });

  it("resolves ids to names and folder paths", () => {
    expect(sheet("Assignments").rows).toEqual([
      ["Meera Rao", "Financial asset", "Savings", 60, new Date(T)],
    ]);
    expect(sheet("Documents").rows[0]!.slice(0, 4)).toEqual([
      "Sale deed.pdf",
      "Legal / Property",
      "Property",
      { day: "2030-01-01" },
    ]);
    expect(sheet("Will plan content").rows).toContainEqual([
      1,
      "Draft",
      "Beneficiaries",
      "Beneficiary ids",
      "Meera Rao",
    ]);
    expect(sheet("Will plans").rows[0]).toEqual([
      1,
      "Draft",
      "Beneficiaries",
      null,
      new Date(T),
      new Date(T),
    ]);
  });

  it("moves deleted rows to their own sheet and never includes storage locations", () => {
    expect(sheet("Beneficiaries").rows.map((row) => row[0])).toEqual(["Meera Rao"]);
    expect(sheet("Deleted items").rows).toEqual([
      ["Beneficiary", "Removed Person", new Date(T)],
      ["Physical asset", "Old scooter (vehicle)", new Date(T)],
    ]);
    expect(readme).toContain("• Beneficiaries: 1 row");
    expect(readme).toContain("• Deleted items: 2 rows");
    expect(JSON.stringify(sheets)).not.toContain(STORAGE_KEY);
    expect(JSON.stringify(sheets)).not.toContain("kek-1");
    expect(sheet("Dead Man's Switch").rows).toEqual([]);
  });

  it("covers history: check-ins, emergency requests, access links, attachments", () => {
    expect(sheet("Check-in history").rows).toEqual([
      [new Date(T), "Check in", "Reminder sent", "Active"],
    ]);
    expect(sheet("Emergency requests").rows[0]!.slice(0, 6)).toEqual([
      new Date(T),
      "Meera Rao",
      "meera@example.com",
      "Denied",
      new Date(T),
      "Owner",
    ]);
    expect(sheet("Access links").rows[0]!.slice(1, 4)).toEqual([
      "Meera Rao",
      "Shared directly",
      "Documents: Sale deed.pdf",
    ]);
    expect(sheet("Document attachments").rows).toEqual([
      ["Sale deed.pdf", "Financial asset", "Savings", new Date(T)],
    ]);
  });

  it("writes stored AI analyses field by field, and AI usage without content", () => {
    expect(sheet("AI analyses").rows).toEqual([
      [
        "Sale deed.pdf",
        "Summary",
        2,
        "en",
        new Date(T),
        "gemini · gemini-2.5-flash",
        "Summary",
        "A sale deed for the Pune flat",
      ],
      [
        "Sale deed.pdf",
        "Summary",
        2,
        "en",
        new Date(T),
        "gemini · gemini-2.5-flash",
        "Parties",
        "Asha Rao, Builder Ltd",
      ],
    ]);
    expect(sheet("AI usage").rows[0]).toEqual([
      new Date(T),
      "Document analysis",
      "gemini",
      "gemini-2.5-flash",
      1200,
      "pdf, 2 pages",
      "summary",
    ]);
  });
});
