import type { Database } from "@/lib/types/database";

/** One row of the caller's own audit trail, as the Security Center renders it. */
export type AuditOutcome = Database["public"]["Enums"]["audit_outcome"];

export interface ActivityEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: AuditOutcome;
  ipAddress: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface ActivityListResult {
  items: ActivityEntry[];
  total: number;
  page: number;
  limit: number;
}
