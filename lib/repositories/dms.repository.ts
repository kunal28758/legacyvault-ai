import "server-only";

import { escalationStepCount } from "@/lib/client/dms-presentation";
import type { TypedSupabaseClient } from "@/lib/db/server";
import type {
  AccessScope,
  DeadManSwitch,
  DmsContact,
  DmsEvent,
  DmsReleaseAccess,
} from "@/lib/types/dms";
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

export function asScope(value: unknown): AccessScope {
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
    .select("id, name, status")
    .eq("user_id", userId)
    .in(
      "id",
      data.map((row) => row.beneficiary_id),
    );
  if (beneficiaryError) throw beneficiaryError;

  const people = new Map((beneficiaries ?? []).map((row) => [row.id, row]));
  return data.map((row) => ({
    beneficiaryId: row.beneficiary_id,
    beneficiaryName: people.get(row.beneficiary_id)?.name ?? "Beneficiary",
    notifyOrder: row.notify_order,
    status: people.get(row.beneficiary_id)?.status ?? "INACTIVE",
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

/**
 * Release links this switch has issued — the newest 20, which covers every
 * contact of the latest releases. Selected by column: the token hash and the
 * verification code hash carry no `authenticated` grant.
 */
export async function listReleaseAccess(
  db: TypedSupabaseClient,
  switchId: string,
): Promise<Omit<DmsReleaseAccess, "beneficiaryName">[]> {
  const { data, error } = await db
    .from("access_tokens")
    .select(
      "id, beneficiary_id, created_at, delivered_at, verified_at, last_used_at, expires_at, revoked_at",
    )
    .eq("dead_man_switch_id", switchId)
    .eq("grant_type", "DMS_RELEASE")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    tokenId: row.id,
    beneficiaryId: row.beneficiary_id,
    issuedAt: row.created_at,
    deliveredAt: row.delivered_at,
    verifiedAt: row.verified_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}

const ASSET_TABLES = {
  FINANCIAL_ASSET: "financial_assets",
  PHYSICAL_ASSET: "physical_assets",
  DIGITAL_ASSET: "digital_assets",
} as const;

/**
 * How many scope items a release would skip today: deleted resources, and
 * videos whose delivery condition no longer allows a switch release. Mirrors
 * `lv_live_scope()`, which is what actually decides at release time.
 */
export async function countUnavailable(
  db: TypedSupabaseClient,
  userId: string,
  scope: AccessScope,
): Promise<number> {
  const live = async (
    query: PromiseLike<{ count: number | null; error: unknown }>,
    expected: number,
  ) => {
    if (expected === 0) return 0;
    const { count, error } = await query;
    if (error) throw error;
    return expected - (count ?? 0);
  };
  const head = { count: "exact" as const, head: true };
  const assetCounts = (Object.keys(ASSET_TABLES) as (keyof typeof ASSET_TABLES)[]).map((kind) => {
    const ids = scope.assets.filter((asset) => asset.type === kind).map((asset) => asset.id);
    return live(
      db
        .from(ASSET_TABLES[kind])
        .select("id", head)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .in("id", ids),
      ids.length,
    );
  });
  const counts = await Promise.all([
    live(
      db
        .from("documents")
        .select("id", head)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .in("id", scope.documents),
      scope.documents.length,
    ),
    live(
      db
        .from("video_messages")
        .select("id", head)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .in("delivery_condition", ["IMMEDIATE", "DEAD_MAN_SWITCH"])
        .in("id", scope.videos),
      scope.videos.length,
    ),
    ...assetCounts,
  ]);
  return counts.reduce((sum, value) => sum + value, 0);
}

export function toDeadManSwitch(
  row: DmsRow,
  contacts: DmsContact[],
  events: DmsEvent[],
  releaseAccess: DmsReleaseAccess[] = [],
  unavailableScopeItems = 0,
  latestWarning: DeadManSwitch["latestWarning"] = null,
): DeadManSwitch {
  return {
    id: row.id,
    status: row.status,
    inactivityPeriodDays: row.inactivity_period_days,
    checkInFrequencyDays: row.check_in_frequency_days,
    escalationDelayHours: row.escalation_delay_hours,
    escalationSteps: escalationStepCount(row.escalation_rules),
    lastCheckInAt: row.last_check_in_at,
    nextCheckInAt: row.next_check_in_at,
    currentEscalationStep: row.current_escalation_step,
    pausedAt: row.paused_at,
    releaseScope: asScope(row.release_scope),
    unavailableScopeItems,
    contacts,
    releaseAccess,
    releaseHold:
      row.status === "ESCALATING" && row.release_held_at
        ? { since: row.release_held_at, lastCheckedAt: row.release_hold_checked_at }
        : null,
    latestWarning,
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
