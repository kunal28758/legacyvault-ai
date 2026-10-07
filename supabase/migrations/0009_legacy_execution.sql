-- =============================================================================
-- 0009 — Legacy Execution Engine (Dead Man's Switch hardening)
--
-- Additive and forward-only. No table is created or dropped, no RLS policy is
-- changed and no existing grant is widened. What changes:
--
--  1. access_tokens gains a release-verification challenge: a DMS_RELEASE link
--     opens nothing until the beneficiary enters a one-time code sent to their
--     own address (hash only, 15 minutes, three attempts — the emergency-access
--     OTP rules). The hash is not granted to `authenticated`.
--  2. lv_live_scope(): a release is issued for what still exists. A document or
--     asset deleted after configuration is dropped from the grant instead of
--     making the whole release fail for every contact.
--  3. Owner transitions:
--       dms_configure        the check-in interval must be shorter than the
--                            inactivity threshold (otherwise the warning window
--                            collapses to the next scan)
--       dms_check_in         authoritative until release: also from ESCALATING
--                            and RELEASING (recorded as a RECOVERY)
--       dms_cancel_escalation from REMINDER_SENT onwards (the page offered it
--                            there and the function refused)
--       dms_pause            only from ACTIVE — pausing could otherwise end an
--                            escalation, or hide a completed release, without
--                            the step-up verification recovery requires
--  4. dms_transition queues one `dms.contact-notice` per eligible trusted
--     contact when escalation starts (outbox, same transaction), and authorizes
--     ESCALATING → RELEASING only once a release warning to the owner in the
--     current cycle is DELIVERED by the provider (see "Release gate" below).
--     Until then the switch is *held*: `release_held_at` records since when,
--     `release_hold_checked_at` the latest check; one audit row marks the
--     start of a hold and one its end, never one per scan.
--  5. Two service-role functions run the release-verification challenge.
--
-- Release gate — what "the owner was warned" means:
--   a grace-period, escalation or held-release notice for this switch, created
--   in the current cycle (since the last check-in), whose delivery_status is
--   DELIVERED *and* that carries a provider message id. DELIVERED is written
--   only when the provider reports that the recipient's mail server accepted
--   the message (the email webhook, or the `notification.confirm` job asking
--   the provider). SENT (the provider merely accepted the request), BOUNCED
--   and FAILED never count, and DELIVERED without a provider id (in-app only)
--   never counts. Nothing can be weaker than "the mailbox accepted it".
--
-- Release links issued before this migration: there is no backfill. Their
-- `verified_at` is NULL, so the portal refuses any session on them and every
-- new exchange demands a fresh code — an old link cannot bypass verification.
-- (On 2026-10-07 production held no DMS_RELEASE links at all.)
--
-- Re-runnable: columns use IF NOT EXISTS, constraints are guarded, functions
-- use CREATE OR REPLACE with unchanged signatures.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Delivery provenance and held releases
-- -----------------------------------------------------------------------------
-- Which provider carried an email, so its outcome can be asked for later.
alter table public.notifications
  add column if not exists delivery_provider text;
do $$
begin
  alter table public.notifications
    add constraint notifications_delivery_provider_known
    check (delivery_provider is null or delivery_provider in ('resend', 'brevo'));
exception when duplicate_object then null;
end;
$$;

alter table public.dead_man_switches
  add column if not exists release_held_at         timestamptz,
  add column if not exists release_hold_checked_at timestamptz;

-- A hold only means something while escalating: any move out of ESCALATING —
-- release, check-in, recovery, disabling — ends it, whichever path made it.
create or replace function public.lv_dms_clear_hold()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'ESCALATING' then
    new.release_held_at := null;
    new.release_hold_checked_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists dead_man_switches_clear_hold on public.dead_man_switches;
create trigger dead_man_switches_clear_hold before update on public.dead_man_switches
  for each row execute function public.lv_dms_clear_hold();

-- -----------------------------------------------------------------------------
-- 1. Release verification challenge
-- -----------------------------------------------------------------------------
alter table public.access_tokens
  add column if not exists verification_code_hash  text,
  add column if not exists verification_expires_at timestamptz,
  add column if not exists verification_attempts   integer not null default 0,
  add column if not exists verified_at             timestamptz;

do $$
begin
  alter table public.access_tokens
    add constraint access_tokens_verification_attempts_range check (verification_attempts between 0 and 3);
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.access_tokens
    add constraint access_tokens_verification_hash_format
    check (verification_code_hash is null or verification_code_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end;
$$;

-- The owner may see *that* a contact verified; the code hash stays unreadable.
grant select (verified_at) on public.access_tokens to authenticated;

-- -----------------------------------------------------------------------------
-- 2. The part of a configured scope that can still be released
-- -----------------------------------------------------------------------------
-- Keeps documents, assets and videos the owner still has (not deleted), and
-- videos whose delivery condition still allows this grant. Plan sections pass
-- through; lv_validate_scope() checks them. The result is a subset of p_scope.
create or replace function public.lv_live_scope(p_owner uuid, p_scope jsonb, p_grant public.access_grant_type)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c_uuid    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_list    jsonb;
  v_docs    jsonb;
  v_videos  jsonb;
  v_assets  jsonb := '[]'::jsonb;
  v_el      jsonb;
begin
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then
    return jsonb_build_object('documents', '[]'::jsonb, 'assets', '[]'::jsonb,
                              'videos', '[]'::jsonb, 'planSections', '[]'::jsonb);
  end if;

  v_list := case when jsonb_typeof(p_scope -> 'documents') = 'array' then p_scope -> 'documents' else '[]'::jsonb end;
  select coalesce(jsonb_agg(to_jsonb(d.id) order by d.id), '[]'::jsonb) into v_docs
    from public.documents d
   where d.user_id = p_owner and d.deleted_at is null
     and d.id::text in (select x from jsonb_array_elements_text(v_list) x);

  v_list := case when jsonb_typeof(p_scope -> 'videos') = 'array' then p_scope -> 'videos' else '[]'::jsonb end;
  select coalesce(jsonb_agg(to_jsonb(v.id) order by v.id), '[]'::jsonb) into v_videos
    from public.video_messages v
   where v.user_id = p_owner and v.deleted_at is null
     and public.lv_video_allowed(v.delivery_condition, p_grant)
     and v.id::text in (select x from jsonb_array_elements_text(v_list) x);

  if jsonb_typeof(p_scope -> 'assets') = 'array' then
    for v_el in select value from jsonb_array_elements(p_scope -> 'assets') loop
      -- Nested so the uuid cast only ever sees a well-formed id.
      if jsonb_typeof(v_el) = 'object'
         and (v_el ->> 'type') in ('FINANCIAL_ASSET', 'PHYSICAL_ASSET', 'DIGITAL_ASSET')
         and coalesce(v_el ->> 'id', '') ~* c_uuid then
        if public.lv_resource_owned(p_owner, v_el ->> 'type', (v_el ->> 'id')::uuid) then
          v_assets := v_assets || jsonb_build_array(
            jsonb_build_object('type', v_el ->> 'type', 'id', (v_el ->> 'id')::uuid));
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'documents', v_docs,
    'assets', v_assets,
    'videos', v_videos,
    'planSections', case when jsonb_typeof(p_scope -> 'planSections') = 'array'
                         then p_scope -> 'planSections' else '[]'::jsonb end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Owner transitions
-- -----------------------------------------------------------------------------
create or replace function public.dms_configure(
  p_config jsonb, p_contact_beneficiary_ids uuid[], p_release_scope jsonb, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := public.lv_require_user();
  v_switch    public.dead_man_switches%rowtype;
  v_id        uuid;
  v_prev      text := 'INACTIVE';
  v_inact     integer := (p_config ->> 'inactivityPeriodDays')::integer;
  v_freq      integer := (p_config ->> 'checkInFrequencyDays')::integer;
  v_delay     integer := coalesce((p_config ->> 'escalationDelayHours')::integer, 24);
  v_rules     jsonb   := coalesce(p_config -> 'escalationRules', '{}'::jsonb);
  v_scope     jsonb;
  v_contacts  uuid[];
  v_i         integer;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"config"}'::jsonb);
  end if;
  if v_inact is null or v_inact not between 7 and 365 then perform public.lv_raise_422('INVALID_INPUT', '{"field":"inactivityPeriodDays"}'::jsonb); end if;
  if v_freq is null or v_freq not between 1 and 90 then perform public.lv_raise_422('INVALID_INPUT', '{"field":"checkInFrequencyDays"}'::jsonb); end if;
  if v_delay not between 1 and 168 then perform public.lv_raise_422('INVALID_INPUT', '{"field":"escalationDelayHours"}'::jsonb); end if;
  if jsonb_typeof(v_rules) <> 'object' then perform public.lv_raise_422('INVALID_INPUT', '{"field":"escalationRules"}'::jsonb); end if;
  -- The warning window (check-in due → grace period) must be at least a day.
  if v_freq >= v_inact then
    perform public.lv_raise_422('WARNING_WINDOW_INVALID', '{"field":"checkInFrequencyDays"}'::jsonb);
  end if;

  select coalesce(array_agg(distinct c), '{}') into v_contacts from unnest(p_contact_beneficiary_ids) c;
  if cardinality(v_contacts) = 0 then perform public.lv_raise_422('CONTACTS_REQUIRED'); end if;
  if exists (
    select 1 from unnest(v_contacts) c
    where not exists (select 1 from public.beneficiaries b
                      where b.id = c and b.user_id = v_user and b.deleted_at is null and b.status <> 'INACTIVE')) then
    perform public.lv_raise_422('CONTACT_NOT_ELIGIBLE');
  end if;

  v_scope := public.lv_validate_scope(v_user, p_release_scope, 'DMS_RELEASE', null);

  select * into v_switch from public.dead_man_switches s where s.user_id = v_user for update;
  if found then
    v_prev := v_switch.status::text;
    if v_switch.status not in ('INACTIVE', 'ACTIVE', 'PAUSED') then
      perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_switch.status, 'to', 'ACTIVE'));
    end if;
    update public.dead_man_switches
       set status = 'ACTIVE', inactivity_period_days = v_inact, check_in_frequency_days = v_freq,
           escalation_delay_hours = v_delay, release_scope = v_scope, escalation_rules = v_rules,
           last_check_in_at = coalesce(last_check_in_at, now()),
           next_check_in_at = now() + make_interval(days => v_freq),
           current_escalation_step = 0, paused_at = null
     where id = v_switch.id
     returning id into v_id;
    delete from public.dead_man_switch_contacts where dead_man_switch_id = v_id;
  else
    insert into public.dead_man_switches
      (user_id, status, inactivity_period_days, check_in_frequency_days, escalation_delay_hours, release_scope,
       escalation_rules, last_check_in_at, next_check_in_at)
    values (v_user, 'ACTIVE', v_inact, v_freq, v_delay, v_scope, v_rules, now(), now() + make_interval(days => v_freq))
    returning id into v_id;
  end if;

  for v_i in 1 .. cardinality(v_contacts) loop
    insert into public.dead_man_switch_contacts (dead_man_switch_id, beneficiary_id, notify_order)
    values (v_id, v_contacts[v_i], v_i);
  end loop;

  perform public.lv_dms_event(v_id, 'CONFIG_CHANGE', v_prev, 'ACTIVE',
    jsonb_build_object('contacts', cardinality(v_contacts), 'checkInFrequencyDays', v_freq));
  perform public.lv_audit(v_user, 'dms.configured', 'dead_man_switch', v_id, 'SUCCESS',
    jsonb_build_object('previousStatus', v_prev, 'contacts', cardinality(v_contacts), 'inactivityPeriodDays', v_inact,
                       'checkInFrequencyDays', v_freq, 'escalationDelayHours', v_delay,
                       'scopeCounts', jsonb_build_object(
                         'documents', jsonb_array_length(v_scope -> 'documents'),
                         'assets', jsonb_array_length(v_scope -> 'assets'),
                         'videos', jsonb_array_length(v_scope -> 'videos'),
                         'planSections', jsonb_array_length(v_scope -> 'planSections'))), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

-- Pausing is a scheduling convenience for a switch that is on schedule. Leaving
-- a warning, grace or escalation stage goes through check-in or recovery, both
-- of which the API gates behind step-up verification (FR-I008).
create or replace function public.dms_pause(p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_sw   public.dead_man_switches%rowtype;
begin
  select * into v_sw from public.dead_man_switches s where s.user_id = v_user for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_sw.status <> 'ACTIVE' then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_sw.status, 'to', 'PAUSED'));
  end if;
  update public.dead_man_switches set status = 'PAUSED', paused_at = now() where id = v_sw.id;
  perform public.lv_dms_event(v_sw.id, 'PAUSE', v_sw.status::text, 'PAUSED', null);
  perform public.lv_audit(v_user, 'dms.paused', 'dead_man_switch', v_sw.id, 'SUCCESS', jsonb_build_object('previousStatus', v_sw.status), p_corr);
  perform public.lv_end();
end;
$$;

-- A verified owner check-in is authoritative at every stage before release.
-- From ESCALATING or RELEASING it also cancels the pending release; nothing has
-- been issued yet, but any stray live release link is revoked all the same.
create or replace function public.dms_check_in(p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := public.lv_require_user();
  v_sw        public.dead_man_switches%rowtype;
  v_cancelled boolean;
  v_revoked   integer := 0;
begin
  select * into v_sw from public.dead_man_switches s where s.user_id = v_user for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_sw.status not in ('ACTIVE', 'REMINDER_SENT', 'GRACE_PERIOD', 'ESCALATING', 'RELEASING') then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_sw.status, 'to', 'ACTIVE'));
  end if;
  v_cancelled := v_sw.status in ('ESCALATING', 'RELEASING');
  if v_cancelled then
    update public.access_tokens set revoked_at = now(), revoked_reason = 'RECOVERY'
     where dead_man_switch_id = v_sw.id and grant_type = 'DMS_RELEASE' and revoked_at is null;
    get diagnostics v_revoked = row_count;
  end if;
  update public.dead_man_switches
     set status = 'ACTIVE', last_check_in_at = now(),
         next_check_in_at = now() + make_interval(days => check_in_frequency_days), current_escalation_step = 0
   where id = v_sw.id;
  perform public.lv_dms_event(v_sw.id, case when v_cancelled then 'RECOVERY' else 'CHECK_IN' end::public.dms_event_type,
    v_sw.status::text, 'ACTIVE', case when v_cancelled then jsonb_build_object('releaseCancelled', true) else null end);
  perform public.lv_audit(v_user, 'dms.checked_in', 'dead_man_switch', v_sw.id, 'SUCCESS',
    jsonb_build_object('previousStatus', v_sw.status), p_corr);
  if v_cancelled then
    perform public.lv_audit(v_user, 'dms.release_cancelled', 'dead_man_switch', v_sw.id, 'SUCCESS',
      jsonb_build_object('previousStatus', v_sw.status, 'releaseTokensRevoked', v_revoked,
                         'releaseHeldSince', v_sw.release_held_at), p_corr);
  end if;
  perform public.lv_end();
end;
$$;

-- Recovery from any stage after the check-in became due, including after
-- release: every DMS_RELEASE link is revoked in the same transaction (FR-I007).
create or replace function public.dms_cancel_escalation(p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := public.lv_require_user();
  v_sw      public.dead_man_switches%rowtype;
  v_revoked integer;
begin
  select * into v_sw from public.dead_man_switches s where s.user_id = v_user for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_sw.status not in ('REMINDER_SENT', 'GRACE_PERIOD', 'ESCALATING', 'RELEASING', 'RELEASED') then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_sw.status, 'to', 'ACTIVE'));
  end if;
  update public.access_tokens set revoked_at = now(), revoked_reason = 'RECOVERY'
   where dead_man_switch_id = v_sw.id and grant_type = 'DMS_RELEASE' and revoked_at is null;
  get diagnostics v_revoked = row_count;
  update public.dead_man_switches
     set status = 'ACTIVE', last_check_in_at = now(),
         next_check_in_at = now() + make_interval(days => check_in_frequency_days), current_escalation_step = 0
   where id = v_sw.id;
  perform public.lv_dms_event(v_sw.id, 'RECOVERY', v_sw.status::text, 'ACTIVE', jsonb_build_object('releaseTokensRevoked', v_revoked));
  perform public.lv_audit(v_user, 'dms.escalation_cancelled', 'dead_man_switch', v_sw.id, 'SUCCESS',
    jsonb_build_object('previousStatus', v_sw.status, 'releaseTokensRevoked', v_revoked,
                       'releaseHeldSince', v_sw.release_held_at), p_corr);
  perform public.lv_end();
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Job-driven transitions: contact notice when escalation starts
-- -----------------------------------------------------------------------------
create or replace function public.dms_transition(
  p_switch_id uuid, p_from public.dms_status, p_to public.dms_status, p_event_type public.dms_event_type, p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_sw      public.dead_man_switches%rowtype;
  v_event   uuid;
  v_contact record;
  v_next    timestamptz := nullif(p_metadata ->> 'nextCheckInAt', '')::timestamptz;
  v_step    integer := nullif(p_metadata ->> 'currentEscalationStep', '')::integer;
begin
  select * into v_sw from public.dead_man_switches s where s.id = p_switch_id for update;
  if not found then perform public.lv_raise_422('SWITCH_NOT_FOUND'); end if;
  if v_sw.status <> p_from then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('current', v_sw.status, 'from', p_from, 'to', p_to));
  end if;
  if not (
       (p_from = 'ACTIVE'        and p_to = 'REMINDER_SENT')
    or (p_from = 'REMINDER_SENT' and p_to = 'GRACE_PERIOD')
    or (p_from = 'GRACE_PERIOD'  and p_to = 'ESCALATING')
    or (p_from = 'ESCALATING'    and p_to = 'ESCALATING')
    or (p_from = 'ESCALATING'    and p_to = 'RELEASING')
    or (p_from = 'RELEASING'     and p_to = 'RELEASED')
  ) then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', p_from, 'to', p_to));
  end if;
  -- Release gate (header): a warning DELIVERED to the owner in this cycle.
  -- Otherwise the switch stays ESCALATING and is marked held; the first
  -- refusal is audited, later ones only move release_hold_checked_at. NULL is
  -- returned instead of an event id, and nothing else changes.
  if p_to = 'RELEASING' and not exists (
    select 1 from public.notifications n
     where n.user_id = v_sw.user_id
       and n.type in ('dms.grace_period', 'dms.escalating', 'dms.release_held')
       and n.metadata ->> 'switchId' = p_switch_id::text
       and n.created_at >= coalesce(v_sw.last_check_in_at, v_sw.created_at)
       and n.delivery_status = 'DELIVERED'
       and n.provider_message_id is not null) then
    update public.dead_man_switches
       set release_held_at = coalesce(release_held_at, now()), release_hold_checked_at = now()
     where id = p_switch_id;
    if v_sw.release_held_at is null then
      perform public.lv_audit(null, 'dms.release_held', 'dead_man_switch', p_switch_id, 'DENIED',
        jsonb_build_object('ownerUserId', v_sw.user_id, 'reason', 'OWNER_WARNING_NOT_DELIVERED'), null);
    end if;
    return null;
  end if;
  if p_to = 'RELEASING' and v_sw.release_held_at is not null then
    perform public.lv_audit(null, 'dms.release_hold_cleared', 'dead_man_switch', p_switch_id, 'SUCCESS',
      jsonb_build_object('ownerUserId', v_sw.user_id, 'heldSince', v_sw.release_held_at,
                         'reason', 'OWNER_WARNING_DELIVERED'), null);
  end if;

  update public.dead_man_switches
     set status = p_to,
         next_check_in_at = coalesce(v_next, next_check_in_at),
         current_escalation_step = coalesce(v_step, current_escalation_step)
   where id = p_switch_id;

  v_event := public.lv_dms_event(p_switch_id, p_event_type, p_from::text, p_to::text, p_metadata);

  if (p_from = 'GRACE_PERIOD' and p_to = 'ESCALATING') or p_to = 'RELEASED' then
    for v_contact in
      select c.beneficiary_id from public.dead_man_switch_contacts c
        join public.beneficiaries b on b.id = c.beneficiary_id
       where c.dead_man_switch_id = p_switch_id and b.user_id = v_sw.user_id
         and b.deleted_at is null and b.status <> 'INACTIVE'
       order by c.notify_order
    loop
      if p_to = 'RELEASED' then
        perform public.lv_enqueue_access_delivery('DMS_RELEASE', v_event, v_contact.beneficiary_id,
          jsonb_build_object('switchId', p_switch_id, 'releaseEventId', v_event), false);
      else
        -- No link and no scope: only that the workflow started (dms.contact-notice).
        perform public.lv_enqueue_job('dms.contact-notice',
          jsonb_build_object('switchId', p_switch_id, 'beneficiaryId', v_contact.beneficiary_id, 'eventId', v_event),
          'dms.contact-notice:' || v_event::text || ':' || v_contact.beneficiary_id::text);
      end if;
    end loop;
  end if;

  perform public.lv_audit(null, 'dms.transition', 'dead_man_switch', p_switch_id, 'SUCCESS',
    jsonb_build_object('from', p_from, 'to', p_to, 'eventType', p_event_type, 'eventId', v_event, 'ownerUserId', v_sw.user_id), null);
  return v_event;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. System grants are issued for the live part of the configured scope
-- -----------------------------------------------------------------------------
create or replace function public.system_issue_access_token(
  p_beneficiary_id uuid, p_grant_type public.access_grant_type, p_scope jsonb, p_token_hash text, p_expires_at timestamptz,
  p_dms_id uuid default null, p_request_id uuid default null
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_allowed jsonb;
  v_scope   jsonb;
  v_id      uuid;
  v_ben_ok  boolean := false;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then perform public.lv_raise_422('INVALID_TOKEN_HASH'); end if;
  if p_expires_at is null or p_expires_at <= now() then perform public.lv_raise_422('INVALID_EXPIRY'); end if;

  if p_grant_type = 'DMS_RELEASE' then
    if p_dms_id is null or p_request_id is not null then perform public.lv_raise_422('INVALID_INPUT', '{"field":"dmsId"}'::jsonb); end if;
    select s.user_id, s.release_scope into v_owner, v_allowed from public.dead_man_switches s
     where s.id = p_dms_id and s.status = 'RELEASED';
    if v_owner is null then perform public.lv_raise_409('SWITCH_NOT_RELEASED'); end if;
    v_ben_ok := exists (select 1 from public.dead_man_switch_contacts c join public.beneficiaries b on b.id = c.beneficiary_id
                        where c.dead_man_switch_id = p_dms_id and c.beneficiary_id = p_beneficiary_id
                          and b.user_id = v_owner and b.deleted_at is null and b.status <> 'INACTIVE');
  elsif p_grant_type = 'EMERGENCY_ACCESS' then
    if p_request_id is null or p_dms_id is not null then perform public.lv_raise_422('INVALID_INPUT', '{"field":"requestId"}'::jsonb); end if;
    select c.user_id, c.access_scope into v_owner, v_allowed
      from public.emergency_access_requests r join public.emergency_access_configs c on c.id = r.config_id
     where r.id = p_request_id and r.status in ('APPROVED', 'AUTO_GRANTED', 'ACTIVE') and c.beneficiary_id = p_beneficiary_id;
    if v_owner is null then perform public.lv_raise_409('REQUEST_NOT_GRANTABLE'); end if;
    v_ben_ok := exists (select 1 from public.beneficiaries b where b.id = p_beneficiary_id and b.user_id = v_owner
                        and b.deleted_at is null and b.status <> 'INACTIVE');
  else
    perform public.lv_raise_422('INVALID_GRANT_TYPE');
  end if;
  if not v_ben_ok then perform public.lv_forbidden(); end if;

  -- What still exists is re-validated (ownership + delivery condition), must be
  -- non-empty (SCOPE_EMPTY) and must stay inside the configured scope.
  v_scope := public.lv_validate_scope(v_owner, public.lv_live_scope(v_owner, p_scope, p_grant_type), p_grant_type, null);
  if not public.lv_scope_subset(v_scope, v_allowed) then
    perform public.lv_raise_422('SCOPE_EXCEEDS_CONFIGURED');
  end if;
  if exists (select 1 from public.access_tokens t
             where t.revoked_at is null and t.grant_type = p_grant_type
               and ((p_grant_type = 'DMS_RELEASE' and t.dead_man_switch_id = p_dms_id and t.beneficiary_id = p_beneficiary_id)
                 or (p_grant_type = 'EMERGENCY_ACCESS' and t.emergency_request_id = p_request_id))) then
    perform public.lv_raise_409('TOKEN_ALREADY_LIVE');
  end if;

  insert into public.access_tokens
    (owner_user_id, beneficiary_id, grant_type, dead_man_switch_id, emergency_request_id, token_hash, scope, expires_at)
  values (v_owner, p_beneficiary_id, p_grant_type, p_dms_id, p_request_id, p_token_hash, v_scope, p_expires_at)
  returning id into v_id;
  if p_grant_type = 'EMERGENCY_ACCESS' then
    update public.emergency_access_requests set access_token_id = v_id where id = p_request_id;
  end if;
  perform public.lv_audit(null, 'access.token_issued', 'access_token', v_id, 'SUCCESS',
    jsonb_build_object('ownerUserId', v_owner, 'beneficiaryId', p_beneficiary_id, 'grantType', p_grant_type,
                       'deadManSwitchId', p_dms_id, 'emergencyRequestId', p_request_id, 'expiresAt', p_expires_at,
                       'scopeCounts', jsonb_build_object(
                         'documents', jsonb_array_length(v_scope -> 'documents'),
                         'assets', jsonb_array_length(v_scope -> 'assets'),
                         'videos', jsonb_array_length(v_scope -> 'videos'),
                         'planSections', jsonb_array_length(v_scope -> 'planSections'))), null);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Release verification (service role; called by the access portal)
-- -----------------------------------------------------------------------------
-- Starts (or restarts) the challenge for a live DMS_RELEASE link. A new code
-- replaces the previous one. Returns when the code expires.
create or replace function public.system_start_release_verification(p_token_id uuid, p_code_hash text)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_tok public.access_tokens%rowtype;
  v_exp timestamptz := now() + interval '15 minutes';
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then perform public.lv_raise_422('INVALID_CODE_HASH'); end if;
  select * into v_tok from public.access_tokens t where t.id = p_token_id for update;
  if not found or v_tok.revoked_at is not null or v_tok.expires_at <= now() then
    perform public.lv_raise_409('TOKEN_NOT_LIVE');
  end if;
  if v_tok.grant_type <> 'DMS_RELEASE' then perform public.lv_raise_422('VERIFICATION_NOT_REQUIRED'); end if;
  update public.access_tokens
     set verification_code_hash = p_code_hash, verification_expires_at = v_exp, verification_attempts = 0
   where id = p_token_id;
  perform public.lv_audit(null, 'access.verification_started', 'access_token', p_token_id, 'SUCCESS',
    jsonb_build_object('ownerUserId', v_tok.owner_user_id, 'beneficiaryId', v_tok.beneficiary_id,
                       'grantType', v_tok.grant_type), null);
  return v_exp;
end;
$$;

-- Checks a code: VERIFIED | RETRY | LOCKED | EXPIRED | NO_CHALLENGE | NOT_LIVE.
-- Three wrong codes end the challenge; a new code must be requested.
create or replace function public.system_check_release_verification(p_token_id uuid, p_code_hash text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_tok      public.access_tokens%rowtype;
  v_attempts integer;
  v_meta     jsonb;
begin
  select * into v_tok from public.access_tokens t where t.id = p_token_id for update;
  if not found or v_tok.revoked_at is not null or v_tok.expires_at <= now() then
    return 'NOT_LIVE';
  end if;
  v_meta := jsonb_build_object('ownerUserId', v_tok.owner_user_id, 'beneficiaryId', v_tok.beneficiary_id,
                               'grantType', v_tok.grant_type);
  if v_tok.verification_code_hash is null then
    return 'NO_CHALLENGE';
  end if;
  if v_tok.verification_expires_at is null or v_tok.verification_expires_at <= now() then
    update public.access_tokens set verification_code_hash = null, verification_expires_at = null where id = p_token_id;
    perform public.lv_audit(null, 'access.verification_expired', 'access_token', p_token_id, 'DENIED', v_meta, null);
    return 'EXPIRED';
  end if;
  if v_tok.verification_code_hash = p_code_hash then
    update public.access_tokens
       set verification_code_hash = null, verification_expires_at = null, verification_attempts = 0,
           verified_at = coalesce(verified_at, now())
     where id = p_token_id;
    perform public.lv_audit(null, 'access.beneficiary_verified', 'access_token', p_token_id, 'SUCCESS', v_meta, null);
    return 'VERIFIED';
  end if;
  v_attempts := v_tok.verification_attempts + 1;
  update public.access_tokens
     set verification_attempts = v_attempts,
         verification_code_hash = case when v_attempts >= 3 then null else verification_code_hash end,
         verification_expires_at = case when v_attempts >= 3 then null else verification_expires_at end
   where id = p_token_id;
  perform public.lv_audit(null, 'access.verification_rejected', 'access_token', p_token_id, 'DENIED',
    v_meta || jsonb_build_object('attempts', v_attempts), null);
  return case when v_attempts >= 3 then 'LOCKED' else 'RETRY' end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Privileges (same rules as 0003 § 9)
-- -----------------------------------------------------------------------------
revoke all on function public.lv_dms_clear_hold() from public, anon, authenticated;
revoke all on function public.lv_live_scope(uuid, jsonb, public.access_grant_type) from public, anon, authenticated;
grant execute on function public.lv_live_scope(uuid, jsonb, public.access_grant_type) to service_role;

revoke all on function public.dms_configure(jsonb, uuid[], jsonb, text) from public, anon;
grant execute on function public.dms_configure(jsonb, uuid[], jsonb, text) to authenticated;
revoke all on function public.dms_pause(text) from public, anon;
grant execute on function public.dms_pause(text) to authenticated;
revoke all on function public.dms_check_in(text) from public, anon;
grant execute on function public.dms_check_in(text) to authenticated;
revoke all on function public.dms_cancel_escalation(text) from public, anon;
grant execute on function public.dms_cancel_escalation(text) to authenticated;

revoke all on function public.dms_transition(uuid, public.dms_status, public.dms_status, public.dms_event_type, jsonb) from public, anon, authenticated;
grant execute on function public.dms_transition(uuid, public.dms_status, public.dms_status, public.dms_event_type, jsonb) to service_role;
revoke all on function public.system_issue_access_token(uuid, public.access_grant_type, jsonb, text, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.system_issue_access_token(uuid, public.access_grant_type, jsonb, text, timestamptz, uuid, uuid) to service_role;
revoke all on function public.system_start_release_verification(uuid, text) from public, anon, authenticated;
grant execute on function public.system_start_release_verification(uuid, text) to service_role;
revoke all on function public.system_check_release_verification(uuid, text) from public, anon, authenticated;
grant execute on function public.system_check_release_verification(uuid, text) to service_role;
