import type { LegacySnapshotInput } from "@/lib/client/legacy-snapshot";
import { ASSET_SLUG_BY_KIND, type AssetKind } from "@/lib/types/asset";

/**
 * The Legacy Relationship Graph: typed edges between the owner's records.
 *
 *   user ─owns→ asset / document
 *   document ─documents→ asset                    (document_attachments)
 *   asset ─assigned_to→ beneficiary                (beneficiary_assignments, with allocation)
 *   beneficiary ─nominee_of→ asset                 (asset profile nominee)
 *   asset / document / beneficiary ─referenced_by→ will   (Will sections)
 *   asset / document ─protected_by→ switch / emergency    (release scopes)
 *   switch / emergency ─released_to→ beneficiary           (trusted / emergency contacts)
 *   asset / document ─expires_on / reviewed_on→ date       (profiles)
 *
 * `beneficiary_of` is the reverse of `assigned_to` — read it with `in()`.
 *
 * Built only from data the owner's own authorized API calls returned, so it can
 * never contain another user's records. A reference to a record that is not in
 * the data is kept in `dangling` — but only when the list it would be in is
 * known to be complete; a record merely beyond the first page is not "missing".
 * Pure: no fetching, so it is deterministic and testable.
 */
export type NodeKind =
  "user" | "asset" | "document" | "beneficiary" | "will" | "switch" | "emergency" | "date";

export type EdgeType =
  | "owns"
  | "documents"
  | "assigned_to"
  | "nominee_of"
  | "referenced_by"
  | "protected_by"
  | "released_to"
  | "expires_on"
  | "reviewed_on";

export interface GraphNode {
  key: string;
  kind: NodeKind;
  id: string;
  label: string;
  href: string;
}

export interface GraphEdge {
  type: EdgeType;
  from: string;
  to: string;
  /** assigned_to: the allocation, when one was set. */
  allocation?: number | null;
  /** documents: the attachment row, so the link can be removed. */
  attachmentId?: string;
}

/** An edge whose other end is not among the owner's live records. */
export interface DanglingReference {
  type: EdgeType;
  from: string;
  to: string;
}

export interface LegacyGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  dangling: DanglingReference[];
  out(key: string, type?: EdgeType): GraphEdge[];
  in(key: string, type?: EdgeType): GraphEdge[];
}

export const USER = "user";
export const WILL = "will";
export const SWITCH = "switch";
export const assetKey = (id: string) => `asset:${id}`;
export const documentKey = (id: string) => `document:${id}`;
export const beneficiaryKey = (id: string) => `beneficiary:${id}`;
export const emergencyKey = (id: string) => `emergency:${id}`;
const dateKey = (day: string) => `date:${day}`;

export function assetHref(kind: AssetKind, id: string): string {
  return `/assets/${ASSET_SLUG_BY_KIND[kind]}/${id}`;
}

const WILL_ASSET_SECTIONS: Record<AssetKind, string> = {
  FINANCIAL_ASSET: "financial-assets",
  PHYSICAL_ASSET: "physical-assets",
  DIGITAL_ASSET: "digital-assets",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** What the current Will says, read defensively from its saved sections. */
export interface WillReferences {
  beneficiaryIds: string[];
  documentIds: string[];
  assets: Record<AssetKind, { ids: string[]; none: boolean; touched: boolean }>;
}

export function readWillReferences(stepsData: Record<string, unknown> | undefined): WillReferences {
  const data = stepsData ?? {};
  const section = (kind: AssetKind) => {
    const raw = asRecord(data[WILL_ASSET_SECTIONS[kind]]);
    const list = ids(raw.assetIds);
    return { ids: list, none: raw.none === true, touched: list.length > 0 || raw.none === true };
  };
  return {
    beneficiaryIds: ids(asRecord(data.beneficiaries).beneficiaryIds),
    documentIds: ids(asRecord(data["document-attachments"]).documentIds),
    assets: {
      FINANCIAL_ASSET: section("FINANCIAL_ASSET"),
      PHYSICAL_ASSET: section("PHYSICAL_ASSET"),
      DIGITAL_ASSET: section("DIGITAL_ASSET"),
    },
  };
}

export interface GraphCompleteness {
  assets: boolean;
  documents: boolean;
  beneficiaries: boolean;
}

/** Whether each list holds every record (totals from the APIs vs what was loaded). */
export function completeness(input: LegacySnapshotInput): GraphCompleteness {
  return {
    assets: (input.assetTotal ?? input.assets.length) <= input.assets.length,
    documents: input.documentTotal <= input.documents.length,
    beneficiaries:
      (input.beneficiaryTotal ?? input.beneficiaries.length) <= input.beneficiaries.length,
  };
}

export function buildLegacyGraph(input: LegacySnapshotInput): LegacyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const dangling: DanglingReference[] = [];
  const complete = completeness(input);
  const kindComplete: Partial<Record<NodeKind, boolean>> = {
    asset: complete.assets,
    document: complete.documents,
    beneficiary: complete.beneficiaries,
  };

  const node = (key: string, kind: NodeKind, id: string, label: string, href: string) =>
    nodes.set(key, { key, kind, id, label, href });
  const link = (edge: GraphEdge) => {
    const missing = [edge.from, edge.to].find((key) => !nodes.has(key));
    if (!missing) {
      edges.push(edge);
      return;
    }
    // Only a complete list can prove a record is gone.
    if (kindComplete[missing.split(":")[0] as NodeKind]) {
      dangling.push({ type: edge.type, from: edge.from, to: edge.to });
    }
  };
  const dated = (from: string, type: "expires_on" | "reviewed_on", day?: string | null) => {
    if (!day) return;
    if (!nodes.has(dateKey(day))) node(dateKey(day), "date", day, day, "");
    link({ type, from, to: dateKey(day) });
  };

  node(USER, "user", "me", "You", "/settings");

  for (const person of input.beneficiaries) {
    const href = `/beneficiaries?q=${encodeURIComponent(person.name)}`;
    node(beneficiaryKey(person.id), "beneficiary", person.id, person.name, href);
  }
  for (const { asset } of input.assets) {
    node(assetKey(asset.id), "asset", asset.id, asset.name, assetHref(asset.kind, asset.id));
  }
  for (const document of input.documents) {
    const href = `/documents?q=${encodeURIComponent(document.name)}`;
    node(documentKey(document.id), "document", document.id, document.name, href);
  }

  const plan = input.planOverview?.current ?? null;
  if (plan) node(WILL, "will", plan.id, "Your Will", "/legacy-plan");
  if (input.dms) node(SWITCH, "switch", input.dms.id, "Dead Man’s Switch", "/dead-man-switch");
  for (const contact of input.emergency?.contacts ?? []) {
    const label = `Emergency access · ${contact.beneficiaryName}`;
    node(emergencyKey(contact.id), "emergency", contact.id, label, "/emergency-access");
  }

  // ── Ownership, assignments, nominees, dates ────────────────────────────────
  for (const { asset, assignments } of input.assets) {
    const key = assetKey(asset.id);
    link({ type: "owns", from: USER, to: key });
    for (const assignment of assignments) {
      link({
        type: "assigned_to",
        from: key,
        to: beneficiaryKey(assignment.beneficiaryId),
        allocation: assignment.allocationPercentage,
      });
    }
    const nominee = asset.profile?.nominee?.beneficiaryId;
    if (nominee) link({ type: "nominee_of", from: beneficiaryKey(nominee), to: key });
    dated(key, "expires_on", asset.profile?.expiresOn);
    dated(key, "reviewed_on", asset.profile?.reviewOn);
  }

  for (const document of input.documents) {
    const key = documentKey(document.id);
    link({ type: "owns", from: USER, to: key });
    for (const attachment of document.attachments ?? []) {
      if (attachment.resourceType === "LEGACY_PLAN") {
        if (plan) link({ type: "referenced_by", from: key, to: WILL });
        continue;
      }
      link({
        type: "documents",
        from: key,
        to: assetKey(attachment.resourceId),
        attachmentId: attachment.id,
      });
    }
    dated(key, "expires_on", document.profile?.expiresOn);
    dated(key, "reviewed_on", document.profile?.reviewOn);
  }

  // ── What the Will references ───────────────────────────────────────────────
  if (plan) {
    const will = readWillReferences(plan.stepsData as Record<string, unknown>);
    for (const id of will.beneficiaryIds) {
      link({ type: "referenced_by", from: beneficiaryKey(id), to: WILL });
    }
    for (const id of will.documentIds) {
      if (!edges.some((e) => e.from === documentKey(id) && e.to === WILL)) {
        link({ type: "referenced_by", from: documentKey(id), to: WILL });
      }
    }
    for (const kind of Object.keys(will.assets) as AssetKind[]) {
      for (const id of will.assets[kind].ids) {
        link({ type: "referenced_by", from: assetKey(id), to: WILL });
      }
    }
  }

  // ── Release scopes and the people they release to ──────────────────────────
  const scoped = (
    target: string,
    scope: { documents: string[]; assets: { id: string }[] } | undefined,
  ) => {
    for (const id of scope?.documents ?? []) {
      link({ type: "protected_by", from: documentKey(id), to: target });
    }
    for (const asset of scope?.assets ?? []) {
      link({ type: "protected_by", from: assetKey(asset.id), to: target });
    }
  };
  if (input.dms) {
    scoped(SWITCH, input.dms.releaseScope);
    for (const contact of input.dms.contacts) {
      link({ type: "released_to", from: SWITCH, to: beneficiaryKey(contact.beneficiaryId) });
    }
  }
  for (const contact of input.emergency?.contacts ?? []) {
    const key = emergencyKey(contact.id);
    scoped(key, contact.accessScope);
    link({ type: "released_to", from: key, to: beneficiaryKey(contact.beneficiaryId) });
  }

  const byFrom = new Map<string, GraphEdge[]>();
  const byTo = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    byFrom.set(edge.from, [...(byFrom.get(edge.from) ?? []), edge]);
    byTo.set(edge.to, [...(byTo.get(edge.to) ?? []), edge]);
  }
  const pick = (list: GraphEdge[] | undefined, type?: EdgeType) =>
    (list ?? []).filter((edge) => !type || edge.type === type);

  return {
    nodes,
    edges,
    dangling,
    out: (key, type) => pick(byFrom.get(key), type),
    in: (key, type) => pick(byTo.get(key), type),
  };
}
