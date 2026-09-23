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
  lastCheckInAt: string | null;
  nextCheckInAt: string | null;
  currentEscalationStep: number;
  pausedAt: string | null;
  releaseScope: AccessScope;
  contacts: DmsContact[];
  events: DmsEvent[];
  createdAt: string;
  updatedAt: string;
}
