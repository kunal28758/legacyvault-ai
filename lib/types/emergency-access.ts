import type { Database } from "@/lib/types/database";
import type { AccessScope } from "@/lib/types/dms";

/** Emergency access (FR-J001–J010). */
export type EaOnTimeout = Database["public"]["Enums"]["ea_on_timeout"];
export type EaRequestStatus = Database["public"]["Enums"]["ea_request_status"];
export type EaConfigStatus = Database["public"]["Enums"]["ea_config_status"];

export interface EmergencyContact {
  id: string;
  beneficiaryId: string;
  beneficiaryName: string;
  beneficiaryEmail: string;
  accessScope: AccessScope;
  onTimeout: EaOnTimeout;
  timeoutHours: number | null;
  requestExpiryHours: number;
  accessDurationHours: number;
  status: EaConfigStatus;
  lastDesignationSentAt: string | null;
  createdAt: string;
}

export interface EmergencyRequest {
  id: string;
  configId: string;
  beneficiaryName: string;
  requesterEmail: string;
  status: EaRequestStatus;
  requestExpiresAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Set while a timeout auto-grant waits for the owner's alert to be confirmed delivered. */
  autoGrantHeldAt: string | null;
}

export interface EmergencyAccessOverview {
  contacts: EmergencyContact[];
  requests: EmergencyRequest[];
}
