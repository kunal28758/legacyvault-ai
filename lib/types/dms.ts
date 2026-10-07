import type { AssetKind } from "@/lib/types/asset";
import type { Database } from "@/lib/types/database";
import type { PlanSectionKey } from "@/lib/types/legacy-plan";

/**
 * Dead Man's Switch view models (FR-I001–I012).
 *
 * The state machine lives in the database: `dms_check_in()` and the guarded
 * lifecycle functions move a switch between these states, and the scheduled
 * scan drives the timed transitions through `dms_transition()`. Nothing in the
 * browser decides a state.
 */
export type DmsStatus = Database["public"]["Enums"]["dms_status"];
export type DmsEventType = Database["public"]["Enums"]["dms_event_type"];

export interface DmsEvent {
  id: string;
  eventType: DmsEventType;
  previousState: string;
  newState: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface DmsContact {
  beneficiaryId: string;
  beneficiaryName: string;
  notifyOrder: number;
  /** INACTIVE contacts are skipped at release. */
  status: Database["public"]["Enums"]["beneficiary_status"];
}

/**
 * One release link issued to a trusted contact, as the owner may see it — no
 * secret, no code, only what happened to it.
 */
export interface DmsReleaseAccess {
  tokenId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  issuedAt: string;
  deliveredAt: string | null;
  /** The contact proved control of their email with a one-time code. */
  verifiedAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
}

/**
 * What an access grant covers. The literal types are the ones
 * `lv_validate_scope()` will store — anything else is refused before it is
 * written, so the view model does not have to widen them back to `string`.
 */
export interface AccessScope {
  documents: string[];
  assets: { type: AssetKind; id: string }[];
  videos: string[];
  planSections: PlanSectionKey[];
}

export interface DeadManSwitch {
  id: string;
  status: DmsStatus;
  inactivityPeriodDays: number;
  checkInFrequencyDays: number;
  escalationDelayHours: number;
  /** Escalation steps between "contacts told" and release (default 2). */
  escalationSteps: number;
  lastCheckInAt: string | null;
  nextCheckInAt: string | null;
  currentEscalationStep: number;
  pausedAt: string | null;
  releaseScope: AccessScope;
  /** Scope items that no longer exist (deleted, or a video no longer deliverable on release); skipped at release. */
  unavailableScopeItems: number;
  contacts: DmsContact[];
  /** Release links issued by the most recent releases, newest first. */
  releaseAccess: DmsReleaseAccess[];
  /**
   * Set while the release point was reached but no warning to the owner has
   * been confirmed delivered, so nothing is released (migration 0009).
   */
  releaseHold: { since: string; lastCheckedAt: string | null } | null;
  /** The newest release warning to the owner this cycle, and what became of it. */
  latestWarning: {
    type: string;
    status: Database["public"]["Enums"]["notification_delivery_status"];
    createdAt: string;
  } | null;
  events: DmsEvent[];
  createdAt: string;
  updatedAt: string;
}
