import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { AccessScope, DeadManSwitch, DmsContact, DmsEvent } from "@/lib/types/dms";
import type { Database } from "@/lib/types/database";

/**
 * Dead Man's Switch data access (FR-I001–I012).
 *
 * The switch, its contacts and its event log are all Class B: `authenticated`
 * may read them and nothing more. Every state change runs inside
 * `dms_configure()`, `dms_check_in()`, `dms_pause()`, `dms_resume()`,
 * `dms_disable()`, `dms_cancel_escalation()` or — for the timed transitions —
 * `dms_transition()`, which only the service role may call.
 */
export type DmsRow = Database["public"]["Tables"]["dead_man_switches"]["Row"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asScope(value: unknown): AccessScope {
  const scope = asRecord(value);
  return {
    documents: Array.isArray(scope.documents) ? (scope.documents as string[]) : [],
    assets: Array.isArray(scope.assets) ? (scope.assets as AccessScope["assets"]) : [],
    videos: Array.isArray(scope.videos) ? (scope.videos as string[]) : [],
    planSections: Array.isArray(scope.planSections)
      ? (scope.planSections as AccessScope["planSections"])
      : [],
  };
}

export async function findForUser(db: TypedSupabaseClient, userId: string): Promise<DmsRow | null> {
  const { data, error } = await db
    .from("dead_man_switches")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listContacts(
  db: TypedSupabaseClient,
  userId: string,
  switchId: string,
): Promise<DmsContact[]> {
  const { data, error } = await db
    .from("dead_man_switch_contacts")
    .select("beneficiary_id, notify_order")
    .eq("dead_man_switch_id", switchId)
    .order("notify_order", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const { data: beneficiaries, error: beneficiaryError } = await db
    .from("beneficiaries")
    .select("id, name")
    .eq("user_id", userId)
    .in(
      "id",
      data.map((row) => row.beneficiary_id),
    );
  if (beneficiaryError) throw beneficiaryError;

  const names = new Map((beneficiaries ?? []).map((row) => [row.id, row.name]));
  return data.map((row) => ({
    beneficiaryId: row.beneficiary_id,
    beneficiaryName: names.get(row.beneficiary_id) ?? "Beneficiary",
    notifyOrder: row.notify_order,
  }));
}

export async function listEvents(
  db: TypedSupabaseClient,
  switchId: string,
  limit = 25,
): Promise<DmsEvent[]> {
  const { data, error } = await db
    .from("dead_man_switch_events")
    .select("id, event_type, previous_state, new_state, metadata, created_at")
    .eq("dead_man_switch_id", switchId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    previousState: row.previous_state,
    newState: row.new_state,
    createdAt: row.created_at,
    metadata: asRecord(row.metadata),
  }));
}

export function toDeadManSwitch(
  row: DmsRow,
  contacts: DmsContact[],
  events: DmsEvent[],
): DeadManSwitch {
  return {
    id: row.id,
    status: row.status,
    inactivityPeriodDays: row.inactivity_period_days,
    checkInFrequencyDays: row.check_in_frequency_days,
    escalationDelayHours: row.escalation_delay_hours,
    lastCheckInAt: row.last_check_in_at,
    nextCheckInAt: row.next_check_in_at,
    currentEscalationStep: row.current_escalation_step,
    pausedAt: row.paused_at,
    releaseScope: asScope(row.release_scope),
    contacts,
    events,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Switches whose next scheduled action is due (service role only).
 *
 * PAUSED, INACTIVE and RELEASED switches are excluded: a paused switch has no
 * deadline, and a released one has already done everything it can do.
 */
export async function listDue(serviceDb: TypedSupabaseClient, now: Date): Promise<DmsRow[]> {
  const { data, error } = await serviceDb
    .from("dead_man_switches")
    .select("*")
    .in("status", ["ACTIVE", "REMINDER_SENT", "GRACE_PERIOD", "ESCALATING", "RELEASING"])
    .lte("next_check_in_at", now.toISOString())
    .order("next_check_in_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}
