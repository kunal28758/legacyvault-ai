import "server-only";

import type { Json } from "@/lib/types/database";
import { ASSET_STATUS_LABELS, type AssetProfile } from "@/lib/types/asset-profile";
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/lib/types/document-profile";
import { PLAN_STEPS } from "@/lib/legacy-plan/steps";
import type { AccountExport, ExportedAsset } from "@/lib/services/account.service";

import type { Cell, Sheet } from "./spreadsheet";
import { formatTimestamp } from "./spreadsheet";

/**
 * The account export as human-readable sheets: one per kind of record, fixed
 * column order, labels instead of enum codes, names instead of ids.
 *
 * Left out on purpose: internal ids, storage locations, encryption key ids and
 * other system fields (the JSON export keeps the raw rows), and the contents of
 * files — documents and videos are listed, not attached.
 */

const when = (iso: string | null | undefined): Cell => (iso ? new Date(iso) : null);
const day = (value: string | null | undefined): Cell =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? { day: value } : (value ?? null);

const LABELS: Record<string, string> = {
  IN_APP: "In-app",
  EMAIL_OTP: "Email code",
  DEAD_MAN_SWITCH: "Dead Man's Switch",
  AUTO_GRANT: "Grant access",
  WAIT: "Keep waiting",
  DENY: "Deny access",
  WILL_DRAFT: "Will draft",
  NOT_SCANNED: "Not scanned",
  OCR: "Text recognition (OCR)",
  DIRECT_SHARE: "Shared directly",
  DMS_RELEASE: "Dead Man's Switch release",
};

/** `BANK_ACCOUNT` → `Bank account`. */
export function label(code: string | null | undefined): string | null {
  if (!code) return null;
  if (LABELS[code]) return LABELS[code];
  const words = code.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `dateOfBirth` / `personal-details` → `Date of birth` / `Personal details`. */
function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Nested JSON as field/value pairs, ids resolved to names where known.
 * `{ children: [{ name: "A" }] }` → `["Children 1 · Name", "A"]`.
 */
function flatten(
  value: unknown,
  path: string[],
  names: Map<string, string>,
  out: [string, Cell][],
) {
  if (value === null || value === undefined || value === "") return;
  const field = path.join(" · ");
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== "object")) {
      const items = value.filter((item) => item !== null && item !== "");
      if (items.length)
        out.push([field, items.map((item) => names.get(String(item)) ?? String(item)).join(", ")]);
      return;
    }
    value.forEach((item, index) =>
      flatten(item, [...path.slice(0, -1), `${path.at(-1) ?? "Item"} ${index + 1}`], names, out),
    );
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, [...path, humanize(key)], names, out);
    }
    return;
  }
  if (typeof value === "string") out.push([field, names.get(value) ?? day(value)]);
  else if (typeof value === "number" || typeof value === "boolean") out.push([field, value]);
}

function pairs(value: Json | Record<string, unknown> | null | undefined, prefix: string): Cell[][] {
  const out: [string, Cell][] = [];
  flatten(value, [prefix], new Map(), out);
  return out;
}

function nominee(profile: AssetProfile | null): string | null {
  const person = profile?.nominee;
  if (!person?.name) return null;
  return person.relationship ? `${person.name} (${person.relationship})` : person.name;
}

function profileCells(asset: ExportedAsset): Cell[] {
  const profile = asset.profile;
  return [
    ASSET_STATUS_LABELS[profile?.status ?? "ACTIVE"],
    day(profile?.acquiredOn),
    day(profile?.expiresOn),
    day(profile?.reviewOn),
    day(profile?.lastReviewedOn),
    nominee(profile),
    profile?.instructions ?? null,
  ];
}

const PROFILE_COLUMNS = [
  "Status",
  "Acquired on",
  "Expires or renews on",
  "Review on",
  "Last reviewed on",
  "Nominee",
  "Instructions",
];

function documentCategory(metadata: Json | null): string | null {
  const category = (metadata as { profile?: { category?: string } } | null)?.profile?.category;
  return category ? (DOCUMENT_CATEGORY_LABELS[category as DocumentCategory] ?? category) : null;
}

function documentDate(metadata: Json | null, key: "expiresOn" | "reviewOn"): Cell {
  return day((metadata as { profile?: Record<string, string> } | null)?.profile?.[key]);
}

const live = <T extends { deleted_at: string | null }>(rows: T[]) =>
  rows.filter((row) => !row.deleted_at);

/** An access link's scope as readable text: `Documents: Will.pdf, Deed.pdf`. */
function scopeText(scope: Json, names: Map<string, string>): string | null {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const parts = Object.entries(scope)
    .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
    .map(
      ([key, ids]) =>
        `${humanize(key)}: ${(ids as unknown[]).map((id) => names.get(String(id)) ?? "(removed item)").join(", ")}`,
    );
  return parts.length ? parts.join("; ") : null;
}

function deleted<T extends { deleted_at: string | null }>(
  rows: T[],
  type: string,
  name: (row: T) => string,
): Cell[][] {
  return rows.filter((row) => row.deleted_at).map((row) => [type, name(row), when(row.deleted_at)]);
}

export interface ExportSummary {
  sheets: Sheet[];
  /** README.txt for the CSV archive; the same text as the "About this export" sheet. */
  readme: string;
}

export function accountSheets(data: AccountExport): ExportSummary {
  const beneficiaries = live(data.beneficiaries);
  const folders = live(data.folders);
  const documents = live(data.documents);
  const videos = live(data.videos);
  const plans = live(data.legacyPlans);
  const contacts = live(data.emergencyContacts);
  const drafts = live(data.aiDrafts);

  // Every id a person might see in plan content or an assignment, with its name.
  const names = new Map<string, string>();
  for (const row of data.beneficiaries) names.set(row.id, row.name);
  for (const row of data.documents) names.set(row.id, row.name);
  for (const row of data.videos) names.set(row.id, row.title);
  for (const kind of Object.values(data.assets))
    for (const row of kind) names.set(row.id, row.name);
  for (const row of data.deletedAssets) names.set(row.id, row.name);
  for (const row of data.legacyPlans) names.set(row.id, `Will plan v${row.version}`);
  const contactOf = new Map(
    data.emergencyContacts.map((row) => [row.id, names.get(row.beneficiary_id) ?? null]),
  );
  const folderById = new Map(data.folders.map((row) => [row.id, row]));
  const folderPath = (id: string | null): string | null => {
    const parts: string[] = [];
    for (let at = id, guard = 0; at && guard < 50; guard++) {
      const folder = folderById.get(at);
      if (!folder) break;
      parts.unshift(folder.name);
      at = folder.parent_id;
    }
    return parts.length ? parts.join(" / ") : null;
  };

  const p = data.profile;
  const address = p.address
    ? Object.values(p.address)
        .filter((part) => typeof part === "string" && part.trim())
        .join(", ") || null
    : null;
  const profile: Sheet = {
    name: "Profile",
    columns: ["Field", "Value"],
    rows: [
      ["Name", p.name],
      ["Email", p.email],
      ["Email verified", p.emailVerified],
      ["Two-step verification", p.mfaEnabled],
      ["Date of birth", day(p.dateOfBirth)],
      ["Phone", p.phone],
      ["Alternate email", p.alternateEmail],
      ["Address", address],
      ...pairs(p.familyInfo, "Family"),
      [
        "Identification details",
        p.hasIdentificationDetails
          ? "On file (encrypted; not included in this export)"
          : "None on file",
      ],
      ...pairs(p.preferences, "Preference"),
      ...pairs(p.notificationPreferences, "Notification preference"),
      ...pairs(p.securityPreferences, "Security preference"),
      ["Onboarding completed", when(p.onboardingCompletedAt)],
      ["Last sign-in", when(p.lastLoginAt)],
      ["Account created", when(p.createdAt)],
      ["Deletion requested", when(p.deletionRequestedAt)],
    ],
  };

  const financial = data.assets.FINANCIAL_ASSET.filter((a) => a.kind === "FINANCIAL_ASSET");
  const physical = data.assets.PHYSICAL_ASSET.filter((a) => a.kind === "PHYSICAL_ASSET");
  const digital = data.assets.DIGITAL_ASSET.filter((a) => a.kind === "DIGITAL_ASSET");

  const itemName = (type: string, id: string) =>
    names.get(id) ?? `(${label(type)?.toLowerCase() ?? "item"} no longer in your vault)`;

  const sheets: Sheet[] = [
    profile,
    {
      name: "Beneficiaries",
      columns: [
        "Name",
        "Relationship",
        "Email",
        "Phone",
        "Status",
        "Notes",
        "Invited",
        "Activated",
        "Added",
        "Updated",
      ],
      rows: beneficiaries.map((b) => [
        b.name,
        b.relationship,
        b.email,
        b.phone,
        label(b.status),
        b.notes,
        when(b.invited_at),
        when(b.activated_at),
        when(b.created_at),
        when(b.updated_at),
      ]),
    },
    {
      name: "Financial assets",
      columns: [
        "Name",
        "Category",
        "Institution",
        "Account number",
        "Policy number",
        "Estimated value",
        "Currency",
        ...PROFILE_COLUMNS,
        "Notes",
        "Added",
        "Updated",
      ],
      rows: financial.map((a) => [
        a.name,
        label(a.category),
        a.institution,
        a.accountNumber ?? null,
        a.policyNumber ?? null,
        a.estimatedValue,
        a.currency,
        ...profileCells(a),
        a.notes,
        when(a.createdAt),
        when(a.updatedAt),
      ]),
    },
    {
      name: "Physical assets",
      columns: [
        "Name",
        "Category",
        "Description",
        "Location",
        "Ownership details",
        "Estimated value",
        "Currency",
        ...PROFILE_COLUMNS,
        "Notes",
        "Added",
        "Updated",
      ],
      rows: physical.map((a) => [
        a.name,
        label(a.category),
        a.description,
        a.location,
        a.ownershipDetails,
        a.estimatedValue,
        a.currency,
        ...profileCells(a),
        a.notes,
        when(a.createdAt),
        when(a.updatedAt),
      ]),
    },
    {
      name: "Digital assets",
      columns: [
        "Name",
        "Category",
        "Platform",
        "Username",
        "Credentials",
        "Recovery information",
        "Estimated value",
        "Currency",
        ...PROFILE_COLUMNS,
        "Notes",
        "Added",
        "Updated",
      ],
      rows: digital.map((a) => [
        a.name,
        label(a.category),
        a.platform,
        a.username,
        a.credentials ?? null,
        a.recoveryInfo ?? null,
        a.estimatedValue,
        a.currency,
        ...profileCells(a),
        a.notes,
        when(a.createdAt),
        when(a.updatedAt),
      ]),
    },
    {
      name: "Assignments",
      columns: ["Beneficiary", "Item type", "Item", "Allocation (%)", "Assigned"],
      rows: data.assignments.map((row) => [
        names.get(row.beneficiary_id) ?? "(removed beneficiary)",
        label(row.resource_type),
        itemName(row.resource_type, row.resource_id),
        row.allocation_percentage,
        when(row.created_at),
      ]),
    },
    {
      name: "Documents",
      columns: [
        "Name",
        "Folder",
        "Category",
        "Expires on",
        "Review on",
        "File type",
        "Size (bytes)",
        "Virus scan",
        "Added",
        "Updated",
      ],
      rows: documents.map((d) => [
        d.name,
        folderPath(d.folder_id),
        documentCategory(d.metadata),
        documentDate(d.metadata, "expiresOn"),
        documentDate(d.metadata, "reviewOn"),
        d.mime_type,
        d.size_bytes,
        label(d.scan_status),
        when(d.created_at),
        when(d.updated_at),
      ]),
    },
    {
      name: "Document versions",
      columns: ["Document", "Version", "Size (bytes)", "Uploaded"],
      rows: data.documentVersions
        .filter((v) => documents.some((d) => d.id === v.document_id))
        .map((v) => [
          names.get(v.document_id) ?? null,
          v.version_number,
          v.size_bytes,
          when(v.created_at),
        ]),
    },
    {
      name: "Document attachments",
      columns: ["Document", "Attached to", "Item", "Attached"],
      rows: data.documentAttachments.map((row) => [
        names.get(row.document_id) ?? "(removed document)",
        label(row.resource_type),
        itemName(row.resource_type, row.resource_id),
        when(row.created_at),
      ]),
    },
    {
      name: "Folders",
      columns: ["Name", "Path", "Created"],
      rows: folders.map((f) => [f.name, folderPath(f.id), when(f.created_at)]),
    },
    {
      name: "Video messages",
      columns: [
        "Title",
        "Description",
        "Delivered",
        "File type",
        "Size (bytes)",
        "Added",
        "Updated",
      ],
      rows: videos.map((v) => [
        v.title,
        v.description,
        label(v.delivery_condition),
        v.mime_type,
        v.size_bytes,
        when(v.created_at),
        when(v.updated_at),
      ]),
    },
    {
      name: "Will plans",
      columns: ["Version", "Status", "Current step", "Finalized", "Created", "Updated"],
      rows: plans.map((plan) => [
        plan.version,
        label(plan.status),
        PLAN_STEPS.find((step) => step.step === plan.current_step)?.title ?? plan.current_step,
        when(plan.finalized_at),
        when(plan.created_at),
        when(plan.updated_at),
      ]),
    },
    {
      name: "Will plan content",
      columns: ["Plan version", "Plan status", "Section", "Field", "Value"],
      rows: plans.flatMap((plan) =>
        PLAN_STEPS.flatMap((step) => {
          const section = (plan.steps_data as Record<string, unknown> | null)?.[step.key];
          const out: [string, Cell][] = [];
          if (section && typeof section === "object") {
            for (const [key, value] of Object.entries(section))
              flatten(value, [humanize(key)], names, out);
          }
          return out.map(([field, value]) => [
            plan.version,
            label(plan.status),
            step.title,
            field,
            value,
          ]);
        }),
      ),
    },
    {
      name: "Will plan history",
      columns: [
        "Version",
        "Finalized",
        "Finalized with incomplete sections",
        "Incomplete sections",
      ],
      rows: data.legacyPlanVersions.map((v) => [
        v.version_number,
        when(v.finalized_at),
        v.acknowledged_incomplete,
        v.incomplete_sections
          .map((key) => PLAN_STEPS.find((s) => s.key === key)?.title ?? key)
          .join(", ") || null,
      ]),
    },
    {
      name: "Dead Man's Switch",
      columns: ["Field", "Value"],
      rows: data.deadManSwitch
        ? [
            ["Status", label(data.deadManSwitch.status)],
            ["Check in every (days)", data.deadManSwitch.check_in_frequency_days],
            ["Inactivity period (days)", data.deadManSwitch.inactivity_period_days],
            ["Escalation delay (hours)", data.deadManSwitch.escalation_delay_hours],
            ["Last check-in", when(data.deadManSwitch.last_check_in_at)],
            ["Next check-in due", when(data.deadManSwitch.next_check_in_at)],
            ["Paused", when(data.deadManSwitch.paused_at)],
            ["Set up", when(data.deadManSwitch.created_at)],
            ...[...data.deadManSwitchContacts]
              .sort((a, b) => a.notify_order - b.notify_order)
              .map((c, i): Cell[] => [
                `Notifies (${i + 1})`,
                names.get(c.beneficiary_id) ?? "(removed beneficiary)",
              ]),
          ]
        : [],
    },
    {
      name: "Check-in history",
      columns: ["When", "Event", "From", "To"],
      rows: data.deadManSwitchEvents.map((e) => [
        when(e.created_at),
        label(e.event_type),
        label(e.previous_state),
        label(e.new_state),
      ]),
    },
    {
      name: "Emergency contacts",
      columns: [
        "Contact",
        "Status",
        "Verification",
        "Request expires after (hours)",
        "Your response window (hours)",
        "If you don't respond",
        "Access lasts (hours)",
        "Added",
      ],
      rows: contacts.map((c) => [
        names.get(c.beneficiary_id) ?? "(removed beneficiary)",
        label(c.status),
        label(c.verification_method),
        c.request_expiry_hours,
        c.timeout_hours,
        label(c.on_timeout),
        c.access_duration_hours,
        when(c.created_at),
      ]),
    },
    {
      name: "Emergency requests",
      columns: [
        "Requested",
        "Contact",
        "Requester email",
        "Status",
        "Decided",
        "Decided by",
        "Access granted",
        "Access expires",
        "Revoked",
        "Revoked by",
      ],
      rows: data.emergencyRequests.map((r) => [
        when(r.created_at),
        contactOf.get(r.config_id) ?? "(removed contact)",
        r.requester_email,
        label(r.status),
        when(r.decided_at),
        label(r.decided_by),
        when(r.granted_at),
        when(r.expires_at),
        when(r.revoked_at),
        label(r.revoked_by),
      ]),
    },
    {
      name: "Access links",
      columns: [
        "Created",
        "Beneficiary",
        "Kind",
        "Covers",
        "Expires",
        "Delivered",
        "Verified",
        "First used",
        "Last used",
        "Revoked",
        "Revoked because",
      ],
      rows: data.accessLinks.map((l) => [
        when(l.created_at),
        names.get(l.beneficiary_id) ?? "(removed beneficiary)",
        label(l.grant_type),
        scopeText(l.scope, names),
        when(l.expires_at),
        when(l.delivered_at),
        when(l.verified_at),
        when(l.used_at),
        when(l.last_used_at),
        when(l.revoked_at),
        label(l.revoked_reason),
      ]),
    },
    {
      name: "AI analyses",
      columns: [
        "Document",
        "Analysis",
        "Version",
        "Language",
        "Created",
        "Model",
        "Field",
        "Value",
      ],
      rows: data.aiAnalyses.flatMap((a) => {
        const out: [string, Cell][] = [];
        flatten(a.data, [], names, out);
        if (out.length === 0) out.push(["", null]);
        return out.map(([field, value]) => [
          a.documentId ? (names.get(a.documentId) ?? "(removed document)") : null,
          label(a.action?.toUpperCase()),
          a.versionNumber,
          a.language,
          when(a.createdAt),
          [a.provider, a.model].filter(Boolean).join(" · ") || null,
          field || null,
          value,
        ]);
      }),
    },
    {
      name: "AI drafts",
      columns: ["Kind", "Status", "Confidence", "Confirmed", "Created", "Updated"],
      rows: drafts.map((d) => [
        label(d.kind),
        label(d.status),
        d.overall_confidence,
        when(d.confirmed_at),
        when(d.created_at),
        when(d.updated_at),
      ]),
    },
    {
      name: "AI usage",
      columns: [
        "When",
        "Feature",
        "Provider",
        "Model",
        "Tokens",
        "Input (summary)",
        "Output (summary)",
      ],
      rows: data.aiInteractions.map((i) => [
        when(i.created_at),
        label(i.session_type),
        i.provider,
        i.model,
        i.token_count,
        i.input_summary,
        i.output_summary,
      ]),
    },
    {
      name: "Notifications",
      columns: ["Sent", "Title", "Message", "Type", "Channel", "Delivery", "Read"],
      rows: data.notifications.map((n) => [
        when(n.created_at),
        n.title,
        n.content,
        n.type,
        label(n.channel),
        label(n.delivery_status),
        when(n.read_at),
      ]),
    },
    {
      name: "Account activity",
      columns: ["When", "Action", "Record type", "Outcome", "IP address", "Device"],
      rows: data.auditLog.map((a) => [
        when(a.created_at),
        a.action,
        a.resource_type,
        label(a.outcome),
        a.ip_address,
        a.user_agent,
      ]),
    },
    {
      name: "Deleted items",
      columns: ["Type", "Name", "Deleted"],
      rows: [
        ...deleted(data.beneficiaries, "Beneficiary", (r) => r.name),
        ...data.deletedAssets.map((a): Cell[] => [
          label(a.kind),
          `${a.name} (${label(a.category)?.toLowerCase()})`,
          when(a.deleted_at),
        ]),
        ...deleted(data.documents, "Document", (r) => r.name),
        ...deleted(data.folders, "Folder", (r) => r.name),
        ...deleted(data.videos, "Video message", (r) => r.title),
        ...deleted(data.legacyPlans, "Will plan", (r) => `Version ${r.version}`),
        ...deleted(
          data.emergencyContacts,
          "Emergency contact",
          (r) => names.get(r.beneficiary_id) ?? "(removed beneficiary)",
        ),
        ...deleted(data.aiDrafts, "AI draft", (r) => label(r.kind) ?? "AI draft"),
      ],
    },
  ];

  const lines = [
    "LegacyVault — your account export",
    `Exported: ${formatTimestamp(new Date(data.exportedAt))} UTC (all times in this export are UTC).`,
    `Account: ${p.email}`,
    "",
    "Contents",
    ...sheets.map(
      (sheet) =>
        `• ${sheet.name}: ${sheet.rows.length} ${sheet.rows.length === 1 ? "row" : "rows"}`,
    ),
    "",
    "Not included",
    "• The files themselves. Documents and video messages are listed with their details; download the files from your vault.",
    "• Identification details: they are stored encrypted and, by design, can only be written, never read back — not even here.",
    "• Internal ids, storage locations, encryption keys, and the secret parts of access links and emergency requests.",
    "• AI chat conversations: they are never stored.",
    "",
    "Deleted items still inside their retention period are listed on the Deleted items sheet with their name and date;",
    "the JSON export holds their full records. Will plan version snapshots are also in the JSON export only:",
    "each finalized plan's content is on the Will plan content sheet.",
    "",
    "Keep this file safe",
    "It contains decrypted account numbers, policy numbers, credentials and recovery information you saved.",
    "Store it encrypted and delete copies you no longer need.",
    "",
    "Text that begins with = + - or @ is kept as text: in the Excel file it is stored as a text cell;",
    "in the CSV files it starts with an apostrophe (') so a spreadsheet does not run it as a formula.",
  ];

  const about: Sheet = {
    name: "About this export",
    columns: ["About this export"],
    rows: lines.slice(1).map((line) => [line]),
  };
  return { sheets: [about, ...sheets], readme: lines.join("\n") + "\n" };
}
