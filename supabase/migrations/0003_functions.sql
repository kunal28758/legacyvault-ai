-- =============================================================================
-- LegacyVault AI — 0003_functions.sql (task T019)
-- Guarded (authenticated) and system (service_role) functions per
-- data-model.md § Write-Protection Model 5, ADR-004 r4, ADR-006, ADR-014 § 6,
-- ADR-016. The Supabase CLI applies this file in its own transaction.
--
-- Guarded functions (auth): SECURITY DEFINER, SET search_path = '', every object
-- schema-qualified, auth prologue (lv_require_user), FOR UPDATE ownership
-- checks, typed parameters, no dynamic SQL, never touch identity columns,
-- invariant under lock, in-transaction audit row, EXECUTE only for
-- `authenticated`. They set the transaction-local flag app.audit_in_function so
-- the Class A audit trigger (0002) does not double-write, and clear it on return.
--
-- System functions: SECURITY INVOKER, EXECUTE only for service_role; every
-- server code path that calls them authorizes in code first (ADR-004).
--
-- Error convention (mapped by the API layer, T021):
--   42501  UNAUTHENTICATED | FORBIDDEN   (same message for "missing" and "not yours")
--   LV409  INVALID_TRANSITION | LOCK_CONFLICT | DUPLICATE | TOKEN_ALREADY_LIVE
--   LV422  invariant violations, MESSAGE = machine code, DETAIL = safe JSON
-- No sensitive value (plaintext, hash, envelope) is ever placed in an error or
-- an audit row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Internal helpers (prefix lv_). Not callable by anon/authenticated; service
--    functions run as service_role, which needs EXECUTE on the helpers they use.
-- -----------------------------------------------------------------------------
create function public.lv_forbidden()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'FORBIDDEN' using errcode = '42501';
end;
$$;

create function public.lv_raise_422(p_code text, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'LV422', message = p_code, detail = coalesce(p_detail::text, '{}');
end;
$$;

create function public.lv_raise_409(p_code text, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'LV409', message = p_code, detail = coalesce(p_detail::text, '{}');
end;
$$;

-- Auth prologue: resolve the caller from the JWT subject, never from a parameter.
create function public.lv_require_user()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_sub  text := auth.jwt() ->> 'sub';
  v_user uuid;
begin
  if v_sub is null or v_sub = '' then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select u.id into v_user
  from public.users u
  where u.clerk_user_id = v_sub and u.deleted_at is null;
  if v_user is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform set_config('app.audit_in_function', 'on', true);
  return v_user;
end;
$$;

-- Epilogue: guarded functions clear the suppression flag before returning.
create function public.lv_end()
returns void
language sql
set search_path = ''
as $$
  select set_config('app.audit_in_function', 'off', true);
$$;

create function public.lv_audit(
  p_actor uuid, p_action text, p_resource_type text, p_resource_id uuid,
  p_outcome public.audit_outcome, p_metadata jsonb, p_corr text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_log (actor_id, actor_role, action, resource_type, resource_id, outcome, metadata, correlation_id)
  values (
    p_actor,
    coalesce(public.current_jwt_role(), 'system'),
    p_action, p_resource_type, p_resource_id, p_outcome,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('source', 'function'),
    nullif(p_corr, '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- AES-256-GCM envelope produced by lib/security/encryption.ts:
-- { ciphertext, iv, authTag, keyId } — base64 payload fields, non-empty keyId.
create function public.lv_is_envelope(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null
     and jsonb_typeof(p_value) = 'object'
     and (p_value ? 'ciphertext') and jsonb_typeof(p_value -> 'ciphertext') = 'string'
     and (p_value ? 'iv')         and jsonb_typeof(p_value -> 'iv') = 'string'
     and (p_value ? 'authTag')    and jsonb_typeof(p_value -> 'authTag') = 'string'
     and (p_value ? 'keyId')      and jsonb_typeof(p_value -> 'keyId') = 'string'
     and (p_value ->> 'ciphertext') ~ '^[A-Za-z0-9+/]+={0,2}$'
     and (p_value ->> 'iv')         ~ '^[A-Za-z0-9+/]{16}$'
     and (p_value ->> 'authTag')    ~ '^[A-Za-z0-9+/]{22}==$'
     and (p_value ->> 'keyId')      ~ '^[a-z][a-z0-9-]{0,31}$'
     and (select count(*) from jsonb_object_keys(p_value)) = 4
$$;

-- Returns the storable text form of an envelope, NULL for JSON null / SQL NULL,
-- and raises INVALID_ENCRYPTION_ENVELOPE for anything else (plaintext included).
create function public.lv_envelope_text(p_value jsonb, p_field text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if not public.lv_is_envelope(p_value) then
    perform public.lv_raise_422('INVALID_ENCRYPTION_ENVELOPE', jsonb_build_object('field', p_field));
  end if;
  return p_value::text;
end;
$$;

create function public.lv_jsonb_uuid_array(p_value jsonb, p_field text)
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out uuid[] := '{}';
  v_el  jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(p_value) <> 'array' then
    perform public.lv_raise_422('INVALID_SCOPE', jsonb_build_object('field', p_field));
  end if;
  for v_el in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_el) <> 'string' or (v_el #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform public.lv_raise_422('INVALID_SCOPE', jsonb_build_object('field', p_field));
    end if;
    v_out := array_append(v_out, (v_el #>> '{}')::uuid);
  end loop;
  select coalesce(array_agg(distinct x order by x), '{}') into v_out from unnest(v_out) as x;
  return v_out;
end;
$$;

-- Strict delivery-condition ↔ grant-type mapping (data-model § 11).
create function public.lv_video_allowed(p_condition public.delivery_condition, p_grant public.access_grant_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_condition
    when 'IMMEDIATE'        then true
    when 'DEAD_MAN_SWITCH'  then p_grant = 'DMS_RELEASE'
    when 'EMERGENCY_ACCESS' then p_grant = 'EMERGENCY_ACCESS'
  end
$$;

-- Does p_owner own the live resource? (used by assignments, attachments, scopes)
create function public.lv_resource_owned(p_owner uuid, p_type text, p_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return case p_type
    when 'FINANCIAL_ASSET' then exists (select 1 from public.financial_assets a where a.id = p_id and a.user_id = p_owner and a.deleted_at is null)
    when 'PHYSICAL_ASSET'  then exists (select 1 from public.physical_assets  a where a.id = p_id and a.user_id = p_owner and a.deleted_at is null)
    when 'DIGITAL_ASSET'   then exists (select 1 from public.digital_assets   a where a.id = p_id and a.user_id = p_owner and a.deleted_at is null)
    when 'DOCUMENT'        then exists (select 1 from public.documents        d where d.id = p_id and d.user_id = p_owner and d.deleted_at is null)
    when 'VIDEO_MESSAGE'   then exists (select 1 from public.video_messages   v where v.id = p_id and v.user_id = p_owner and v.deleted_at is null)
    when 'LEGACY_PLAN'     then exists (select 1 from public.legacy_plans     p where p.id = p_id and p.user_id = p_owner and p.deleted_at is null)
    else false
  end;
end;
$$;

-- Validates and normalizes an access scope for a grant type.
--   { documents: uuid[], assets: [{type,id}], videos: uuid[], planSections: text[] }
-- Every id must be owned by p_owner; videos must satisfy the strict mapping; for
-- DIRECT_SHARE every resource must currently be assigned to p_beneficiary and
-- planSections must be empty (FR-D011). Returns the canonical scope.
create function public.lv_validate_scope(
  p_owner uuid, p_scope jsonb, p_grant public.access_grant_type, p_beneficiary uuid
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c_sections constant text[] := array['personal-details','family-information','beneficiaries','financial-assets',
                                      'physical-assets','digital-assets','witness-details','special-wishes','document-attachments'];
  v_documents uuid[];
  v_videos    uuid[];
  v_sections  text[] := '{}';
  v_assets    jsonb := '[]'::jsonb;
  v_el        jsonb;
  v_type      text;
  v_id        uuid;
  v_cond      public.delivery_condition;
  v_unknown   text;
begin
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then
    perform public.lv_raise_422('INVALID_SCOPE', '{"field":"scope"}'::jsonb);
  end if;
  select k into v_unknown from jsonb_object_keys(p_scope) k
   where k not in ('documents','assets','videos','planSections') limit 1;
  if v_unknown is not null then
    perform public.lv_raise_422('INVALID_SCOPE', jsonb_build_object('field', v_unknown));
  end if;

  v_documents := public.lv_jsonb_uuid_array(p_scope -> 'documents', 'documents');
  v_videos    := public.lv_jsonb_uuid_array(p_scope -> 'videos', 'videos');

  if p_scope ? 'planSections' and jsonb_typeof(p_scope -> 'planSections') <> 'null' then
    if jsonb_typeof(p_scope -> 'planSections') <> 'array' then
      perform public.lv_raise_422('INVALID_SCOPE', '{"field":"planSections"}'::jsonb);
    end if;
    select coalesce(array_agg(distinct s order by s), '{}') into v_sections
      from jsonb_array_elements_text(p_scope -> 'planSections') s;
    if exists (select 1 from unnest(v_sections) s where s <> all (c_sections)) then
      perform public.lv_raise_422('INVALID_SCOPE', '{"field":"planSections"}'::jsonb);
    end if;
  end if;

  if p_scope ? 'assets' and jsonb_typeof(p_scope -> 'assets') <> 'null' then
    if jsonb_typeof(p_scope -> 'assets') <> 'array' then
      perform public.lv_raise_422('INVALID_SCOPE', '{"field":"assets"}'::jsonb);
    end if;
    for v_el in select value from jsonb_array_elements(p_scope -> 'assets') loop
      v_type := v_el ->> 'type';
      if jsonb_typeof(v_el) <> 'object' or v_type not in ('FINANCIAL_ASSET','PHYSICAL_ASSET','DIGITAL_ASSET')
         or (v_el ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform public.lv_raise_422('INVALID_SCOPE', '{"field":"assets"}'::jsonb);
      end if;
      v_id := (v_el ->> 'id')::uuid;
      if not public.lv_resource_owned(p_owner, v_type, v_id) then
        perform public.lv_forbidden();
      end if;
      if p_grant = 'DIRECT_SHARE' and not exists (
        select 1 from public.beneficiary_assignments ba
        where ba.beneficiary_id = p_beneficiary and ba.user_id = p_owner
          and ba.resource_type = v_type::public.assignment_resource_type and ba.resource_id = v_id) then
        perform public.lv_raise_422('SCOPE_NOT_ASSIGNED', jsonb_build_object('resourceType', v_type, 'resourceId', v_id));
      end if;
      if not (v_assets @> jsonb_build_array(jsonb_build_object('type', v_type, 'id', v_id))) then
        v_assets := v_assets || jsonb_build_array(jsonb_build_object('type', v_type, 'id', v_id));
      end if;
    end loop;
  end if;

  foreach v_id in array v_documents loop
    if not public.lv_resource_owned(p_owner, 'DOCUMENT', v_id) then
      perform public.lv_forbidden();
    end if;
    if p_grant = 'DIRECT_SHARE' and not exists (
      select 1 from public.beneficiary_assignments ba
      where ba.beneficiary_id = p_beneficiary and ba.user_id = p_owner
        and ba.resource_type = 'DOCUMENT' and ba.resource_id = v_id) then
      perform public.lv_raise_422('SCOPE_NOT_ASSIGNED', jsonb_build_object('resourceType', 'DOCUMENT', 'resourceId', v_id));
    end if;
  end loop;

  foreach v_id in array v_videos loop
    select v.delivery_condition into v_cond
    from public.video_messages v where v.id = v_id and v.user_id = p_owner and v.deleted_at is null;
    if v_cond is null then
      perform public.lv_forbidden();
    end if;
    if not public.lv_video_allowed(v_cond, p_grant) then
      perform public.lv_raise_422('DELIVERY_CONDITION_MISMATCH',
        jsonb_build_object('videoId', v_id, 'deliveryCondition', v_cond, 'grantType', p_grant));
    end if;
    if p_grant = 'DIRECT_SHARE' and not exists (
      select 1 from public.beneficiary_assignments ba
      where ba.beneficiary_id = p_beneficiary and ba.user_id = p_owner
        and ba.resource_type = 'VIDEO_MESSAGE' and ba.resource_id = v_id) then
      perform public.lv_raise_422('SCOPE_NOT_ASSIGNED', jsonb_build_object('resourceType', 'VIDEO_MESSAGE', 'resourceId', v_id));
    end if;
  end loop;

  if p_grant = 'DIRECT_SHARE' and cardinality(v_sections) > 0 then
    perform public.lv_raise_422('SCOPE_NOT_ASSIGNED', '{"resourceType":"PLAN_SECTION"}'::jsonb);
  end if;

  if cardinality(v_documents) = 0 and cardinality(v_videos) = 0
     and jsonb_array_length(v_assets) = 0 and cardinality(v_sections) = 0 then
    perform public.lv_raise_422('SCOPE_EMPTY');
  end if;

  return jsonb_build_object(
    'documents', to_jsonb(v_documents),
    'assets', v_assets,
    'videos', to_jsonb(v_videos),
    'planSections', to_jsonb(v_sections)
  );
end;
$$;

-- Is every element of p_scope contained in p_allowed? (system grants ⊆ configured scope)
create function public.lv_scope_subset(p_scope jsonb, p_allowed jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_scope -> 'documents', '[]'::jsonb)    <@ coalesce(p_allowed -> 'documents', '[]'::jsonb)
     and coalesce(p_scope -> 'assets', '[]'::jsonb)       <@ coalesce(p_allowed -> 'assets', '[]'::jsonb)
     and coalesce(p_scope -> 'videos', '[]'::jsonb)       <@ coalesce(p_allowed -> 'videos', '[]'::jsonb)
     and coalesce(p_scope -> 'planSections', '[]'::jsonb) <@ coalesce(p_allowed -> 'planSections', '[]'::jsonb)
$$;

-- Outbox insert into jobs; idempotent on the key (ADR-006). Returns the job id or
-- NULL when the key already existed.
create function public.lv_enqueue_job(p_type text, p_payload jsonb, p_key text, p_run_at timestamptz default now())
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.jobs (type, payload, idempotency_key, run_at)
  values (p_type, coalesce(p_payload, '{}'::jsonb), p_key, coalesce(p_run_at, now()))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create function public.lv_revoke_token(p_token_id uuid, p_reason public.token_revoked_reason)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.access_tokens
     set revoked_at = now(), revoked_reason = p_reason
   where id = p_token_id and revoked_at is null;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create function public.lv_revoke_tokens_for_beneficiary(p_beneficiary uuid, p_reason public.token_revoked_reason)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.access_tokens
     set revoked_at = now(), revoked_reason = p_reason
   where beneficiary_id = p_beneficiary and revoked_at is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create function public.lv_dms_event(
  p_switch uuid, p_type public.dms_event_type, p_prev text, p_new text, p_meta jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.dead_man_switch_events (dead_man_switch_id, event_type, previous_state, new_state, metadata)
  values (p_switch, p_type, p_prev, p_new, p_meta)
  returning id into v_id;
  return v_id;
end;
$$;

-- Deterministic delivery job for a system grant (ADR-014 § 6). p_source is the RELEASE
-- event id (DMS_RELEASE) or the emergency request id (EMERGENCY_ACCESS). A resend run
-- appends :r{n} with n = existing runs for the same prefix + 1, inside this transaction.
create function public.lv_enqueue_access_delivery(
  p_grant public.access_grant_type, p_source uuid, p_beneficiary uuid, p_payload jsonb, p_resend boolean
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text := 'access.deliver:' || p_grant::text || ':' || p_source::text || ':' || p_beneficiary::text;
  v_key    text := v_prefix;
  v_n      integer;
begin
  if p_resend then
    perform pg_advisory_xact_lock(hashtext(v_prefix));
    select count(*) into v_n from public.jobs j
     where j.type = 'access.deliver' and (j.idempotency_key = v_prefix or j.idempotency_key like v_prefix || ':r%');
    v_key := v_prefix || ':r' || (v_n + 1)::text;
  end if;
  return public.lv_enqueue_job(
    'access.deliver',
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('grantType', p_grant, 'sourceId', p_source, 'beneficiaryId', p_beneficiary),
    v_key
  );
end;
$$;

-- =============================================================================
-- 1. Legacy plan (Class B) — FR-C001–C012, Clarifications 2026-09-18
-- =============================================================================
create function public.create_legacy_plan(p_corr text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_id   uuid;
begin
  if exists (select 1 from public.legacy_plans p where p.user_id = v_user and p.status = 'DRAFT') then
    perform public.lv_raise_409('DRAFT_EXISTS');
  end if;
  insert into public.legacy_plans (user_id) values (v_user) returning id into v_id;
  perform public.lv_audit(v_user, 'plan.created', 'legacy_plan', v_id, 'SUCCESS', null, p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

-- Auto-save one section. p_data is the validated section payload; the service
-- sets p_data.isComplete after its own completeness rules (plan § Phase 3).
create function public.save_plan_step(
  p_plan_id uuid, p_step text, p_data jsonb, p_expected_lock_version integer, p_corr text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_sections constant text[] := array['personal-details','family-information','beneficiaries','financial-assets',
                                      'physical-assets','digital-assets','witness-details','special-wishes','document-attachments'];
  v_user uuid := public.lv_require_user();
  v_plan public.legacy_plans%rowtype;
  v_complete boolean;
begin
  if p_step <> all (c_sections) then
    perform public.lv_raise_422('INVALID_STEP', jsonb_build_object('step', p_step));
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"data"}'::jsonb);
  end if;
  select * into v_plan from public.legacy_plans p
   where p.id = p_plan_id and p.user_id = v_user and p.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_plan.status <> 'DRAFT' then
    perform public.lv_raise_409('PLAN_NOT_DRAFT');
  end if;
  if v_plan.lock_version <> p_expected_lock_version then
    perform public.lv_raise_409('LOCK_CONFLICT', jsonb_build_object('lockVersion', v_plan.lock_version));
  end if;
  v_complete := coalesce((p_data ->> 'isComplete')::boolean, false);
  update public.legacy_plans
     set steps_data = steps_data || jsonb_build_object(p_step, p_data - 'isComplete'),
         completion_status = completion_status || jsonb_build_object(p_step, v_complete),
         current_step = greatest(current_step, array_position(c_sections, p_step)),
         lock_version = lock_version + 1
   where id = p_plan_id;
  perform public.lv_audit(v_user, 'plan.step_saved', 'legacy_plan', p_plan_id, 'SUCCESS',
    jsonb_build_object('step', p_step, 'complete', v_complete), p_corr);
  perform public.lv_end();
  return jsonb_build_object('lockVersion', v_plan.lock_version + 1, 'step', p_step, 'complete', v_complete);
end;
$$;

-- DRAFT → FINALIZED with an immutable, fully resolved snapshot. Personal Details
-- must be complete; other incomplete sections require explicit acknowledgment.
create function public.finalize_legacy_plan(
  p_plan_id uuid, p_expected_lock_version integer, p_acknowledge_incomplete boolean default false, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_sections constant text[] := array['personal-details','family-information','beneficiaries','financial-assets',
                                      'physical-assets','digital-assets','witness-details','special-wishes','document-attachments'];
  v_user       uuid := public.lv_require_user();
  v_plan       public.legacy_plans%rowtype;
  v_incomplete text[];
  v_snapshot   jsonb;
  v_version    uuid;
  v_draft      uuid;
  v_notif      uuid;
begin
  select * into v_plan from public.legacy_plans p
   where p.id = p_plan_id and p.user_id = v_user and p.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_plan.status <> 'DRAFT' then perform public.lv_raise_409('PLAN_NOT_DRAFT'); end if;
  if v_plan.lock_version <> p_expected_lock_version then
    perform public.lv_raise_409('LOCK_CONFLICT', jsonb_build_object('lockVersion', v_plan.lock_version));
  end if;
  if coalesce((v_plan.completion_status ->> 'personal-details')::boolean, false) is not true then
    perform public.lv_raise_422('PERSONAL_DETAILS_REQUIRED');
  end if;
  select coalesce(array_agg(s order by s), '{}') into v_incomplete
    from unnest(c_sections) s
   where coalesce((v_plan.completion_status ->> s)::boolean, false) is not true;
  if cardinality(v_incomplete) > 0 and not coalesce(p_acknowledge_incomplete, false) then
    perform public.lv_raise_422('PLAN_INCOMPLETE', jsonb_build_object('incompleteSections', to_jsonb(v_incomplete)));
  end if;

  select a.id into v_draft from public.ai_drafts a
   where a.user_id = v_user and a.legacy_plan_id = p_plan_id and a.kind = 'WILL_DRAFT'
     and a.status = 'CONFIRMED' and a.deleted_at is null
   order by a.confirmed_at desc limit 1;

  -- Resolved by value; encrypted asset columns are never copied into a snapshot.
  v_snapshot := jsonb_build_object(
    'stepsData', v_plan.steps_data,
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'relationship', b.relationship, 'email', b.email, 'phone', b.phone, 'status', b.status)
        order by b.created_at)
        from public.beneficiaries b where b.user_id = v_user and b.deleted_at is null), '[]'::jsonb),
    'financialAssets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'category', a.category, 'institution', a.institution,
        'estimatedValue', a.estimated_value, 'currency', a.currency, 'notes', a.notes) order by a.created_at)
        from public.financial_assets a where a.user_id = v_user and a.deleted_at is null), '[]'::jsonb),
    'physicalAssets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'category', a.category, 'description', a.description, 'location', a.location,
        'estimatedValue', a.estimated_value, 'currency', a.currency, 'ownershipDetails', a.ownership_details, 'notes', a.notes)
        order by a.created_at)
        from public.physical_assets a where a.user_id = v_user and a.deleted_at is null), '[]'::jsonb),
    'digitalAssets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'category', a.category, 'platform', a.platform, 'username', a.username,
        'estimatedValue', a.estimated_value, 'currency', a.currency, 'notes', a.notes) order by a.created_at)
        from public.digital_assets a where a.user_id = v_user and a.deleted_at is null), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
        'beneficiaryId', ba.beneficiary_id, 'resourceType', ba.resource_type, 'resourceId', ba.resource_id,
        'allocationPercentage', ba.allocation_percentage) order by ba.created_at)
        from public.beneficiary_assignments ba where ba.user_id = v_user), '[]'::jsonb),
    'documentAttachments', coalesce((select jsonb_agg(jsonb_build_object(
        'documentId', da.document_id, 'name', d.name, 'mimeType', d.mime_type, 'sizeBytes', d.size_bytes,
        'resourceType', da.resource_type, 'resourceId', da.resource_id) order by da.created_at)
        from public.document_attachments da join public.documents d on d.id = da.document_id
        where da.user_id = v_user and d.deleted_at is null), '[]'::jsonb),
    'confirmedAiDraftId', v_draft
  );

  insert into public.legacy_plan_versions
    (legacy_plan_id, version_number, snapshot_data, completeness, acknowledged_incomplete, incomplete_sections, finalized_at)
  values (p_plan_id, v_plan.version, v_snapshot, v_plan.completion_status,
          cardinality(v_incomplete) > 0, v_incomplete, now())
  returning id into v_version;

  update public.legacy_plans
     set status = 'FINALIZED', finalized_at = now(), confirmed_by = v_user, current_step = 11,
         lock_version = lock_version + 1
   where id = p_plan_id;

  insert into public.notifications (user_id, type, title, content, channel, metadata)
  values (v_user, 'plan.finalized', 'Your legacy plan was finalized',
          'Version ' || v_plan.version::text || ' of your legacy plan is now finalized.', 'BOTH',
          jsonb_build_object('planId', p_plan_id, 'versionId', v_version))
  returning id into v_notif;
  perform public.lv_enqueue_job('notification.deliver', jsonb_build_object('notificationId', v_notif),
    'notification.deliver:' || v_notif::text);

  perform public.lv_audit(v_user, 'plan.finalized', 'legacy_plan', p_plan_id, 'SUCCESS',
    jsonb_build_object('versionId', v_version, 'version', v_plan.version,
                       'acknowledgedIncomplete', cardinality(v_incomplete) > 0, 'incompleteSections', to_jsonb(v_incomplete)), p_corr);
  perform public.lv_end();
  return v_version;
end;
$$;

create function public.create_plan_draft(p_from_plan_id uuid, p_corr text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_from public.legacy_plans%rowtype;
  v_id   uuid;
begin
  select * into v_from from public.legacy_plans p
   where p.id = p_from_plan_id and p.user_id = v_user and p.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_from.status <> 'FINALIZED' then perform public.lv_raise_409('PLAN_NOT_FINALIZED'); end if;
  if exists (select 1 from public.legacy_plans p where p.user_id = v_user and p.status = 'DRAFT') then
    perform public.lv_raise_409('DRAFT_EXISTS');
  end if;
  insert into public.legacy_plans (user_id, status, current_step, steps_data, completion_status, version)
  values (v_user, 'DRAFT', 1, v_from.steps_data, v_from.completion_status, v_from.version + 1)
  returning id into v_id;
  perform public.lv_audit(v_user, 'plan.draft_created', 'legacy_plan', v_id, 'SUCCESS',
    jsonb_build_object('fromPlanId', p_from_plan_id, 'version', v_from.version + 1), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

-- =============================================================================
-- 2. Beneficiaries, assignments, attachments (Class B) — FR-D004–D011, FR-E004
-- =============================================================================
create function public.assign_beneficiary(
  p_beneficiary_id uuid, p_resource_type public.assignment_resource_type, p_resource_id uuid,
  p_allocation numeric default null, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := public.lv_require_user();
  v_status public.beneficiary_status;
  v_sum    numeric;
  v_id     uuid;
  v_locked uuid;
begin
  if p_allocation is not null and (p_allocation < 0 or p_allocation > 100) then
    perform public.lv_raise_422('INVALID_ALLOCATION');
  end if;
  select b.status into v_status from public.beneficiaries b
   where b.id = p_beneficiary_id and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_status = 'INACTIVE' then perform public.lv_raise_422('BENEFICIARY_INACTIVE'); end if;

  -- Lock the resource row so concurrent assignments serialize on the sum.
  case p_resource_type
    when 'FINANCIAL_ASSET' then select a.id into v_locked from public.financial_assets a where a.id = p_resource_id and a.user_id = v_user and a.deleted_at is null for update;
    when 'PHYSICAL_ASSET'  then select a.id into v_locked from public.physical_assets  a where a.id = p_resource_id and a.user_id = v_user and a.deleted_at is null for update;
    when 'DIGITAL_ASSET'   then select a.id into v_locked from public.digital_assets   a where a.id = p_resource_id and a.user_id = v_user and a.deleted_at is null for update;
    when 'DOCUMENT'        then select d.id into v_locked from public.documents        d where d.id = p_resource_id and d.user_id = v_user and d.deleted_at is null for update;
    when 'VIDEO_MESSAGE'   then select v.id into v_locked from public.video_messages   v where v.id = p_resource_id and v.user_id = v_user and v.deleted_at is null for update;
  end case;
  if v_locked is null then perform public.lv_forbidden(); end if;

  if exists (select 1 from public.beneficiary_assignments ba
             where ba.beneficiary_id = p_beneficiary_id and ba.resource_type = p_resource_type and ba.resource_id = p_resource_id) then
    perform public.lv_raise_409('ALREADY_ASSIGNED');
  end if;

  select coalesce(sum(ba.allocation_percentage), 0) into v_sum
    from public.beneficiary_assignments ba
   where ba.resource_type = p_resource_type and ba.resource_id = p_resource_id;
  if v_sum + coalesce(p_allocation, 0) > 100 then
    perform public.lv_raise_422('ALLOCATION_EXCEEDED', jsonb_build_object('remaining', 100 - v_sum));
  end if;

  insert into public.beneficiary_assignments (user_id, beneficiary_id, resource_type, resource_id, allocation_percentage)
  values (v_user, p_beneficiary_id, p_resource_type, p_resource_id, p_allocation)
  returning id into v_id;
  perform public.lv_audit(v_user, 'assignment.created', p_resource_type::text, p_resource_id, 'SUCCESS',
    jsonb_build_object('assignmentId', v_id, 'beneficiaryId', p_beneficiary_id, 'allocationPercentage', p_allocation), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

create function public.unassign_beneficiary(p_assignment_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_row  public.beneficiary_assignments%rowtype;
begin
  select * into v_row from public.beneficiary_assignments ba
   where ba.id = p_assignment_id and ba.user_id = v_user for update;
  if not found then perform public.lv_forbidden(); end if;
  delete from public.beneficiary_assignments where id = p_assignment_id;
  perform public.lv_audit(v_user, 'assignment.removed', v_row.resource_type::text, v_row.resource_id, 'SUCCESS',
    jsonb_build_object('assignmentId', p_assignment_id, 'beneficiaryId', v_row.beneficiary_id,
                       'previousAllocationPercentage', v_row.allocation_percentage), p_corr);
  perform public.lv_end();
end;
$$;

create function public.set_beneficiary_status(p_beneficiary_id uuid, p_status public.beneficiary_status, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.lv_require_user();
  v_prev  public.beneficiary_status;
  v_revoked integer := 0;
begin
  if p_status not in ('ACTIVE', 'INACTIVE') then
    perform public.lv_raise_422('INVALID_STATUS');
  end if;
  select b.status into v_prev from public.beneficiaries b
   where b.id = p_beneficiary_id and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  update public.beneficiaries
     set status = p_status,
         activated_at = case when p_status = 'ACTIVE' then coalesce(activated_at, now()) else activated_at end
   where id = p_beneficiary_id;
  if p_status = 'INACTIVE' then
    v_revoked := public.lv_revoke_tokens_for_beneficiary(p_beneficiary_id, 'BENEFICIARY_INACTIVE');
  end if;
  perform public.lv_audit(v_user, 'beneficiary.status_changed', 'beneficiary', p_beneficiary_id, 'SUCCESS',
    jsonb_build_object('previous', v_prev, 'new', p_status, 'tokensRevoked', v_revoked), p_corr);
  perform public.lv_end();
end;
$$;

create function public.remove_beneficiary(p_beneficiary_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user        uuid := public.lv_require_user();
  v_assignments integer;
  v_tokens      integer;
  v_contacts    integer;
  v_configs     integer;
begin
  perform 1 from public.beneficiaries b
   where b.id = p_beneficiary_id and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;

  delete from public.beneficiary_assignments where beneficiary_id = p_beneficiary_id and user_id = v_user;
  get diagnostics v_assignments = row_count;
  v_tokens := public.lv_revoke_tokens_for_beneficiary(p_beneficiary_id, 'BENEFICIARY_REMOVED');
  delete from public.dead_man_switch_contacts c
   using public.dead_man_switches s
   where c.dead_man_switch_id = s.id and s.user_id = v_user and c.beneficiary_id = p_beneficiary_id;
  get diagnostics v_contacts = row_count;
  update public.emergency_access_configs
     set status = 'INACTIVE', deleted_at = now()
   where beneficiary_id = p_beneficiary_id and user_id = v_user and deleted_at is null;
  get diagnostics v_configs = row_count;
  update public.beneficiaries set status = 'INACTIVE', deleted_at = now() where id = p_beneficiary_id;

  perform public.lv_audit(v_user, 'beneficiary.removed', 'beneficiary', p_beneficiary_id, 'SUCCESS',
    jsonb_build_object('assignmentsRemoved', v_assignments, 'tokensRevoked', v_tokens,
                       'dmsContactLinksRemoved', v_contacts, 'emergencyConfigsDeactivated', v_configs), p_corr);
  perform public.lv_end();
end;
$$;

create function public.attach_document(
  p_document_id uuid, p_resource_type public.attachment_resource_type, p_resource_id uuid, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_id   uuid;
begin
  if not public.lv_resource_owned(v_user, 'DOCUMENT', p_document_id)
     or not public.lv_resource_owned(v_user, p_resource_type::text, p_resource_id) then
    perform public.lv_forbidden();
  end if;
  if exists (select 1 from public.document_attachments da
             where da.document_id = p_document_id and da.resource_type = p_resource_type and da.resource_id = p_resource_id) then
    perform public.lv_raise_409('ALREADY_ATTACHED');
  end if;
  insert into public.document_attachments (user_id, document_id, resource_type, resource_id)
  values (v_user, p_document_id, p_resource_type, p_resource_id)
  returning id into v_id;
  perform public.lv_audit(v_user, 'document.attached', p_resource_type::text, p_resource_id, 'SUCCESS',
    jsonb_build_object('attachmentId', v_id, 'documentId', p_document_id), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

create function public.detach_document(p_attachment_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_row  public.document_attachments%rowtype;
begin
  select * into v_row from public.document_attachments da
   where da.id = p_attachment_id and da.user_id = v_user for update;
  if not found then perform public.lv_forbidden(); end if;
  delete from public.document_attachments where id = p_attachment_id;
  perform public.lv_audit(v_user, 'document.detached', v_row.resource_type::text, v_row.resource_id, 'SUCCESS',
    jsonb_build_object('attachmentId', p_attachment_id, 'documentId', v_row.document_id), p_corr);
  perform public.lv_end();
end;
$$;

-- =============================================================================
-- 3. Access tokens — owner paths (ADR-014, FR-D011). Only the hash is stored.
-- =============================================================================
create function public.issue_access_token(
  p_beneficiary_id uuid, p_scope jsonb, p_token_hash text, p_expires_at timestamptz, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := public.lv_require_user();
  v_status public.beneficiary_status;
  v_scope  jsonb;
  v_id     uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    perform public.lv_raise_422('INVALID_TOKEN_HASH');
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    perform public.lv_raise_422('INVALID_EXPIRY', '{"maxDays":30}'::jsonb);
  end if;
  select b.status into v_status from public.beneficiaries b
   where b.id = p_beneficiary_id and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_status = 'INACTIVE' then perform public.lv_raise_422('BENEFICIARY_INACTIVE'); end if;

  v_scope := public.lv_validate_scope(v_user, p_scope, 'DIRECT_SHARE', p_beneficiary_id);

  insert into public.access_tokens (owner_user_id, beneficiary_id, grant_type, token_hash, scope, expires_at)
  values (v_user, p_beneficiary_id, 'DIRECT_SHARE', p_token_hash, v_scope, p_expires_at)
  returning id into v_id;
  perform public.lv_audit(v_user, 'access.token_issued', 'access_token', v_id, 'SUCCESS',
    jsonb_build_object('beneficiaryId', p_beneficiary_id, 'grantType', 'DIRECT_SHARE', 'expiresAt', p_expires_at,
                       'scopeCounts', jsonb_build_object(
                         'documents', jsonb_array_length(v_scope -> 'documents'),
                         'assets', jsonb_array_length(v_scope -> 'assets'),
                         'videos', jsonb_array_length(v_scope -> 'videos'))), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

create function public.revoke_access_token(p_token_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_tok  public.access_tokens%rowtype;
begin
  select * into v_tok from public.access_tokens t where t.id = p_token_id and t.owner_user_id = v_user for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_tok.revoked_at is null then
    perform public.lv_revoke_token(p_token_id, 'OWNER');
  end if;
  perform public.lv_audit(v_user, 'access.token_revoked', 'access_token', p_token_id, 'SUCCESS',
    jsonb_build_object('beneficiaryId', v_tok.beneficiary_id, 'grantType', v_tok.grant_type, 'alreadyRevoked', v_tok.revoked_at is not null), p_corr);
  perform public.lv_end();
end;
$$;

-- Owner resend of a DIRECT_SHARE link: re-applies every issue-time invariant, then
-- revokes the previous token (RESENT) and mints exactly one replacement.
create function public.resend_access_token(
  p_token_id uuid, p_token_hash text, p_expires_at timestamptz, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := public.lv_require_user();
  v_tok    public.access_tokens%rowtype;
  v_status public.beneficiary_status;
  v_scope  jsonb;
  v_id     uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then perform public.lv_raise_422('INVALID_TOKEN_HASH'); end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    perform public.lv_raise_422('INVALID_EXPIRY', '{"maxDays":30}'::jsonb);
  end if;
  select * into v_tok from public.access_tokens t where t.id = p_token_id and t.owner_user_id = v_user for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_tok.grant_type <> 'DIRECT_SHARE' then perform public.lv_raise_422('NOT_DIRECT_SHARE'); end if;
  select b.status into v_status from public.beneficiaries b
   where b.id = v_tok.beneficiary_id and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_status = 'INACTIVE' then perform public.lv_raise_422('BENEFICIARY_INACTIVE'); end if;

  v_scope := public.lv_validate_scope(v_user, v_tok.scope, 'DIRECT_SHARE', v_tok.beneficiary_id);

  if v_tok.revoked_at is null then
    perform public.lv_revoke_token(p_token_id, 'RESENT');
  end if;
  insert into public.access_tokens (owner_user_id, beneficiary_id, grant_type, token_hash, scope, expires_at, replaces_token_id)
  values (v_user, v_tok.beneficiary_id, 'DIRECT_SHARE', p_token_hash, v_scope, p_expires_at, p_token_id)
  returning id into v_id;
  perform public.lv_audit(v_user, 'access.token_resent', 'access_token', v_id, 'SUCCESS',
    jsonb_build_object('replacesTokenId', p_token_id, 'beneficiaryId', v_tok.beneficiary_id, 'expiresAt', p_expires_at), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

-- =============================================================================
-- 4. Document / video / asset lifecycle (Class B)
-- =============================================================================
create function public.delete_document(p_document_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_doc  public.documents%rowtype;
  v_assignments integer;
  v_attachments integer;
begin
  select * into v_doc from public.documents d
   where d.id = p_document_id and d.user_id = v_user and d.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  delete from public.beneficiary_assignments where resource_type = 'DOCUMENT' and resource_id = p_document_id and user_id = v_user;
  get diagnostics v_assignments = row_count;
  delete from public.document_attachments where document_id = p_document_id and user_id = v_user;
  get diagnostics v_attachments = row_count;
  update public.documents set deleted_at = now() where id = p_document_id;
  perform public.lv_enqueue_job('storage.remove-object',
    jsonb_build_object('bucket', v_doc.storage_bucket, 'documentId', p_document_id),
    'storage.remove-object:document:' || p_document_id::text);
  perform public.lv_audit(v_user, 'document.deleted', 'document', p_document_id, 'SUCCESS',
    jsonb_build_object('sharesRemoved', v_assignments, 'attachmentsRemoved', v_attachments), p_corr);
  perform public.lv_end();
end;
$$;

create function public.delete_video(p_video_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_vid  public.video_messages%rowtype;
  v_assignments integer;
begin
  select * into v_vid from public.video_messages v
   where v.id = p_video_id and v.user_id = v_user and v.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  delete from public.beneficiary_assignments where resource_type = 'VIDEO_MESSAGE' and resource_id = p_video_id and user_id = v_user;
  get diagnostics v_assignments = row_count;
  update public.video_messages set deleted_at = now() where id = p_video_id;
  perform public.lv_enqueue_job('storage.remove-object',
    jsonb_build_object('bucket', v_vid.storage_bucket, 'videoId', p_video_id),
    'storage.remove-object:video:' || p_video_id::text);
  perform public.lv_audit(v_user, 'video.deleted', 'video_message', p_video_id, 'SUCCESS',
    jsonb_build_object('assignmentsRemoved', v_assignments), p_corr);
  perform public.lv_end();
end;
$$;

-- Asset creation is function-only (ADR-004 r4 § 8): typed plain columns per type,
-- envelope-validated encrypted columns, one transaction, audited.
create function public.create_asset(
  p_resource_type public.assignment_resource_type, p_plain jsonb, p_encrypted jsonb default '{}'::jsonb, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := public.lv_require_user();
  v_id       uuid;
  v_allowed  text[];
  v_enc_keys text[];
  v_unknown  text;
  v_value    numeric;
  v_currency text;
  v_enc_set  text[] := '{}';
begin
  if p_plain is null or jsonb_typeof(p_plain) <> 'object' then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"plain"}'::jsonb);
  end if;
  if p_encrypted is not null and jsonb_typeof(p_encrypted) <> 'object' then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"encrypted"}'::jsonb);
  end if;
  case p_resource_type
    when 'FINANCIAL_ASSET' then
      v_allowed := array['name','category','institution','estimatedValue','currency','notes','metadata'];
      v_enc_keys := array['accountNumber','policyNumber'];
    when 'PHYSICAL_ASSET' then
      v_allowed := array['name','category','description','location','estimatedValue','currency','ownershipDetails','notes','metadata'];
      v_enc_keys := '{}';
    when 'DIGITAL_ASSET' then
      v_allowed := array['name','category','platform','username','estimatedValue','currency','notes','metadata'];
      v_enc_keys := array['credentials','recoveryInfo'];
    else
      perform public.lv_raise_422('INVALID_RESOURCE_TYPE');
  end case;

  select k into v_unknown from jsonb_object_keys(p_plain) k where k <> all (v_allowed) limit 1;
  if v_unknown is not null then
    perform public.lv_raise_422('INVALID_INPUT', jsonb_build_object('field', v_unknown));
  end if;
  select k into v_unknown from jsonb_object_keys(coalesce(p_encrypted, '{}'::jsonb)) k where k <> all (v_enc_keys) limit 1;
  if v_unknown is not null then
    perform public.lv_raise_422('INVALID_INPUT', jsonb_build_object('field', v_unknown));
  end if;
  if coalesce(nullif(p_plain ->> 'name', ''), '') = '' then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"name"}'::jsonb);
  end if;
  v_value := nullif(p_plain ->> 'estimatedValue', '')::numeric;
  v_currency := upper(coalesce(nullif(p_plain ->> 'currency', ''), 'USD'));
  if v_currency !~ '^[A-Z]{3}$' then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"currency"}'::jsonb);
  end if;
  select coalesce(array_agg(k), '{}') into v_enc_set
    from jsonb_object_keys(coalesce(p_encrypted, '{}'::jsonb)) k
   where jsonb_typeof(p_encrypted -> k) <> 'null';

  case p_resource_type
    when 'FINANCIAL_ASSET' then
      insert into public.financial_assets
        (user_id, name, category, institution, account_number, policy_number, estimated_value, currency, notes, metadata)
      values (v_user, p_plain ->> 'name', (p_plain ->> 'category')::public.financial_asset_category, p_plain ->> 'institution',
              public.lv_envelope_text(p_encrypted -> 'accountNumber', 'accountNumber'),
              public.lv_envelope_text(p_encrypted -> 'policyNumber', 'policyNumber'),
              v_value, v_currency, p_plain ->> 'notes', p_plain -> 'metadata')
      returning id into v_id;
    when 'PHYSICAL_ASSET' then
      insert into public.physical_assets
        (user_id, name, category, description, location, estimated_value, currency, ownership_details, notes, metadata)
      values (v_user, p_plain ->> 'name', (p_plain ->> 'category')::public.physical_asset_category, p_plain ->> 'description',
              p_plain ->> 'location', v_value, v_currency, p_plain ->> 'ownershipDetails', p_plain ->> 'notes', p_plain -> 'metadata')
      returning id into v_id;
    when 'DIGITAL_ASSET' then
      insert into public.digital_assets
        (user_id, name, category, platform, username, credentials, recovery_info, estimated_value, currency, notes, metadata)
      values (v_user, p_plain ->> 'name', (p_plain ->> 'category')::public.digital_asset_category, p_plain ->> 'platform',
              p_plain ->> 'username',
              public.lv_envelope_text(p_encrypted -> 'credentials', 'credentials'),
              public.lv_envelope_text(p_encrypted -> 'recoveryInfo', 'recoveryInfo'),
              v_value, v_currency, p_plain ->> 'notes', p_plain -> 'metadata')
      returning id into v_id;
  end case;

  perform public.lv_audit(v_user, 'asset.created', p_resource_type::text, v_id, 'SUCCESS',
    jsonb_build_object('name', p_plain ->> 'name', 'category', p_plain ->> 'category', 'encryptedFieldsSet', to_jsonb(v_enc_set)), p_corr);
  perform public.lv_end();
  return v_id;
exception
  when invalid_text_representation then
    -- an unparsable category / estimatedValue in p_plain
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"plain"}'::jsonb);
    return null;
end;
$$;

-- The only write path for ENCRYPTED columns (ADR-004 r4 § 8).
create function public.set_encrypted_fields(
  p_resource_type text, p_resource_id uuid, p_fields jsonb, p_corr text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := public.lv_require_user();
  v_allowed  text[];
  v_unknown  text;
  v_changed  text[];
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"fields"}'::jsonb);
  end if;
  case p_resource_type
    when 'USER'            then v_allowed := array['identificationDetails'];
    when 'FINANCIAL_ASSET' then v_allowed := array['accountNumber','policyNumber'];
    when 'DIGITAL_ASSET'   then v_allowed := array['credentials','recoveryInfo'];
    else perform public.lv_raise_422('INVALID_RESOURCE_TYPE');
  end case;
  select k into v_unknown from jsonb_object_keys(p_fields) k where k <> all (v_allowed) limit 1;
  if v_unknown is not null then
    perform public.lv_raise_422('INVALID_INPUT', jsonb_build_object('field', v_unknown));
  end if;
  select coalesce(array_agg(k order by k), '{}') into v_changed from jsonb_object_keys(p_fields) k;

  case p_resource_type
    when 'USER' then
      if p_resource_id <> v_user then perform public.lv_forbidden(); end if;
      perform 1 from public.users u where u.id = v_user for update;
      update public.users
         set identification_details = public.lv_envelope_text(p_fields -> 'identificationDetails', 'identificationDetails')
       where id = v_user;
    when 'FINANCIAL_ASSET' then
      perform 1 from public.financial_assets a where a.id = p_resource_id and a.user_id = v_user and a.deleted_at is null for update;
      if not found then perform public.lv_forbidden(); end if;
      update public.financial_assets
         set account_number = case when p_fields ? 'accountNumber' then public.lv_envelope_text(p_fields -> 'accountNumber', 'accountNumber') else account_number end,
             policy_number  = case when p_fields ? 'policyNumber'  then public.lv_envelope_text(p_fields -> 'policyNumber', 'policyNumber')   else policy_number  end
       where id = p_resource_id;
    when 'DIGITAL_ASSET' then
      perform 1 from public.digital_assets a where a.id = p_resource_id and a.user_id = v_user and a.deleted_at is null for update;
      if not found then perform public.lv_forbidden(); end if;
      update public.digital_assets
         set credentials   = case when p_fields ? 'credentials'  then public.lv_envelope_text(p_fields -> 'credentials', 'credentials')   else credentials   end,
             recovery_info = case when p_fields ? 'recoveryInfo' then public.lv_envelope_text(p_fields -> 'recoveryInfo', 'recoveryInfo') else recovery_info end
       where id = p_resource_id;
  end case;

  perform public.lv_audit(v_user, 'asset.encrypted_fields_updated',
    case when p_resource_type = 'USER' then 'user' else p_resource_type end, p_resource_id, 'SUCCESS',
    jsonb_build_object('changed', to_jsonb(v_changed), 'values', '[encrypted]'), p_corr);
  perform public.lv_end();
end;
$$;

create function public.delete_asset(p_resource_type public.assignment_resource_type, p_asset_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user        uuid := public.lv_require_user();
  v_name        text;
  v_assignments integer;
  v_attachments integer;
begin
  case p_resource_type
    when 'FINANCIAL_ASSET' then
      select a.name into v_name from public.financial_assets a where a.id = p_asset_id and a.user_id = v_user and a.deleted_at is null for update;
    when 'PHYSICAL_ASSET' then
      select a.name into v_name from public.physical_assets a where a.id = p_asset_id and a.user_id = v_user and a.deleted_at is null for update;
    when 'DIGITAL_ASSET' then
      select a.name into v_name from public.digital_assets a where a.id = p_asset_id and a.user_id = v_user and a.deleted_at is null for update;
    else
      perform public.lv_raise_422('INVALID_RESOURCE_TYPE');
  end case;
  if v_name is null then perform public.lv_forbidden(); end if;

  delete from public.beneficiary_assignments where resource_type = p_resource_type and resource_id = p_asset_id and user_id = v_user;
  get diagnostics v_assignments = row_count;
  delete from public.document_attachments
   where resource_type = p_resource_type::text::public.attachment_resource_type and resource_id = p_asset_id and user_id = v_user;
  get diagnostics v_attachments = row_count;

  case p_resource_type
    when 'FINANCIAL_ASSET' then update public.financial_assets set deleted_at = now() where id = p_asset_id;
    when 'PHYSICAL_ASSET'  then update public.physical_assets  set deleted_at = now() where id = p_asset_id;
    when 'DIGITAL_ASSET'   then update public.digital_assets   set deleted_at = now() where id = p_asset_id;
  end case;

  perform public.lv_audit(v_user, 'asset.deleted', p_resource_type::text, p_asset_id, 'SUCCESS',
    jsonb_build_object('name', v_name, 'assignmentsRemoved', v_assignments, 'attachmentsRemoved', v_attachments), p_corr);
  perform public.lv_end();
end;
$$;

-- =============================================================================
-- 5. Dead Man Switch — owner transitions (Class B), FR-I001–I012
-- =============================================================================
create function public.dms_configure(
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
                       'checkInFrequencyDays', v_freq, 'escalationDelayHours', v_delay), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

create function public.dms_pause(p_corr text default null)
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
  if v_sw.status in ('INACTIVE', 'PAUSED') then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_sw.status, 'to', 'PAUSED'));
  end if;
  update public.dead_man_switches set status = 'PAUSED', paused_at = now() where id = v_sw.id;
  perform public.lv_dms_event(v_sw.id, 'PAUSE', v_sw.status::text, 'PAUSED', null);
  perform public.lv_audit(v_user, 'dms.paused', 'dead_man_switch', v_sw.id, 'SUCCESS', jsonb_build_object('previousStatus', v_sw.status), p_corr);
  perform public.lv_end();
end;
$$;

create function public.dms_resume(p_corr text default null)
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
  if v_sw.status <> 'PAUSED' then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_sw.status, 'to', 'ACTIVE'));
  end if;
  update public.dead_man_switches
     set status = 'ACTIVE', paused_at = null, last_check_in_at = now(),
         next_check_in_at = now() + make_interval(days => check_in_frequency_days), current_escalation_step = 0
   where id = v_sw.id;
  perform public.lv_dms_event(v_sw.id, 'RESUME', 'PAUSED', 'ACTIVE', null);
  perform public.lv_audit(v_user, 'dms.resumed', 'dead_man_switch', v_sw.id, 'SUCCESS', null, p_corr);
  perform public.lv_end();
end;
$$;

-- Reverification is enforced by the API layer before this call (FR-I008).
create function public.dms_disable(p_corr text default null)
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
  if v_sw.status = 'INACTIVE' then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', 'INACTIVE', 'to', 'INACTIVE'));
  end if;
  update public.access_tokens set revoked_at = now(), revoked_reason = 'OWNER'
   where dead_man_switch_id = v_sw.id and grant_type = 'DMS_RELEASE' and revoked_at is null;
  get diagnostics v_revoked = row_count;
  update public.dead_man_switches
     set status = 'INACTIVE', next_check_in_at = null, current_escalation_step = 0, paused_at = null
   where id = v_sw.id;
  perform public.lv_dms_event(v_sw.id, 'CONFIG_CHANGE', v_sw.status::text, 'INACTIVE', jsonb_build_object('disabled', true));
  perform public.lv_audit(v_user, 'dms.disabled', 'dead_man_switch', v_sw.id, 'SUCCESS',
    jsonb_build_object('previousStatus', v_sw.status, 'releaseTokensRevoked', v_revoked), p_corr);
  perform public.lv_end();
end;
$$;

-- Reverification (multi_factor when MFA is enabled) is enforced by the API layer (FR-I003).
create function public.dms_check_in(p_corr text default null)
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
  if v_sw.status not in ('ACTIVE', 'REMINDER_SENT', 'GRACE_PERIOD') then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_sw.status, 'to', 'ACTIVE'));
  end if;
  update public.dead_man_switches
     set status = 'ACTIVE', last_check_in_at = now(),
         next_check_in_at = now() + make_interval(days => check_in_frequency_days), current_escalation_step = 0
   where id = v_sw.id;
  perform public.lv_dms_event(v_sw.id, 'CHECK_IN', v_sw.status::text, 'ACTIVE', null);
  perform public.lv_audit(v_user, 'dms.checked_in', 'dead_man_switch', v_sw.id, 'SUCCESS', jsonb_build_object('previousStatus', v_sw.status), p_corr);
  perform public.lv_end();
end;
$$;

-- Recovery at every stage, including after release: release tokens are revoked (FR-I007).
create function public.dms_cancel_escalation(p_corr text default null)
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
  if v_sw.status not in ('ESCALATING', 'RELEASING', 'RELEASED') then
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
    jsonb_build_object('previousStatus', v_sw.status, 'releaseTokensRevoked', v_revoked), p_corr);
  perform public.lv_end();
end;
$$;

-- =============================================================================
-- 6. Emergency access — owner paths (Class B), FR-J001–J010
-- =============================================================================
create function public.ea_configure_contact(
  p_beneficiary_id uuid, p_access_scope jsonb, p_on_timeout public.ea_on_timeout default 'WAIT',
  p_timeout_hours integer default null, p_request_expiry_hours integer default 72,
  p_access_duration_hours integer default 72, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := public.lv_require_user();
  v_status public.beneficiary_status;
  v_scope  jsonb;
  v_id     uuid;
begin
  if p_on_timeout <> 'WAIT' and (p_timeout_hours is null or p_timeout_hours not between 1 and 168) then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"timeoutHours"}'::jsonb);
  end if;
  if p_request_expiry_hours not between 1 and 720 then perform public.lv_raise_422('INVALID_INPUT', '{"field":"requestExpiryHours"}'::jsonb); end if;
  if p_access_duration_hours not between 1 and 720 then perform public.lv_raise_422('INVALID_INPUT', '{"field":"accessDurationHours"}'::jsonb); end if;
  select b.status into v_status from public.beneficiaries b
   where b.id = p_beneficiary_id and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_status = 'INACTIVE' then perform public.lv_raise_422('BENEFICIARY_INACTIVE'); end if;
  if exists (select 1 from public.emergency_access_configs c
             where c.user_id = v_user and c.beneficiary_id = p_beneficiary_id and c.deleted_at is null) then
    perform public.lv_raise_409('CONTACT_ALREADY_CONFIGURED');
  end if;
  v_scope := public.lv_validate_scope(v_user, p_access_scope, 'EMERGENCY_ACCESS', null);
  insert into public.emergency_access_configs
    (user_id, beneficiary_id, access_scope, on_timeout, timeout_hours, request_expiry_hours, access_duration_hours)
  values (v_user, p_beneficiary_id, v_scope, p_on_timeout,
          case when p_on_timeout = 'WAIT' then null else p_timeout_hours end, p_request_expiry_hours, p_access_duration_hours)
  returning id into v_id;
  perform public.lv_audit(v_user, 'ea.contact_configured', 'emergency_access_config', v_id, 'SUCCESS',
    jsonb_build_object('beneficiaryId', p_beneficiary_id, 'onTimeout', p_on_timeout, 'timeoutHours', p_timeout_hours,
                       'requestExpiryHours', p_request_expiry_hours, 'accessDurationHours', p_access_duration_hours), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

create function public.ea_update_contact(
  p_config_id uuid, p_access_scope jsonb default null, p_on_timeout public.ea_on_timeout default null,
  p_timeout_hours integer default null, p_request_expiry_hours integer default null,
  p_access_duration_hours integer default null, p_corr text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.lv_require_user();
  v_cfg   public.emergency_access_configs%rowtype;
  v_scope jsonb;
  v_on    public.ea_on_timeout;
  v_to    integer;
begin
  select * into v_cfg from public.emergency_access_configs c
   where c.id = p_config_id and c.user_id = v_user and c.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  v_on := coalesce(p_on_timeout, v_cfg.on_timeout);
  v_to := case when v_on = 'WAIT' then null else coalesce(p_timeout_hours, v_cfg.timeout_hours) end;
  if v_on <> 'WAIT' and (v_to is null or v_to not between 1 and 168) then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"timeoutHours"}'::jsonb);
  end if;
  if p_request_expiry_hours is not null and p_request_expiry_hours not between 1 and 720 then perform public.lv_raise_422('INVALID_INPUT', '{"field":"requestExpiryHours"}'::jsonb); end if;
  if p_access_duration_hours is not null and p_access_duration_hours not between 1 and 720 then perform public.lv_raise_422('INVALID_INPUT', '{"field":"accessDurationHours"}'::jsonb); end if;
  v_scope := case when p_access_scope is null then v_cfg.access_scope
                  else public.lv_validate_scope(v_user, p_access_scope, 'EMERGENCY_ACCESS', null) end;
  update public.emergency_access_configs
     set access_scope = v_scope, on_timeout = v_on, timeout_hours = v_to,
         request_expiry_hours = coalesce(p_request_expiry_hours, request_expiry_hours),
         access_duration_hours = coalesce(p_access_duration_hours, access_duration_hours)
   where id = p_config_id;
  perform public.lv_audit(v_user, 'ea.contact_updated', 'emergency_access_config', p_config_id, 'SUCCESS',
    jsonb_build_object('scopeChanged', p_access_scope is not null, 'onTimeout', v_on, 'timeoutHours', v_to), p_corr);
  perform public.lv_end();
end;
$$;

create function public.ea_remove_contact(p_config_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := public.lv_require_user();
  v_cfg     public.emergency_access_configs%rowtype;
  v_revoked integer := 0;
begin
  select * into v_cfg from public.emergency_access_configs c
   where c.id = p_config_id and c.user_id = v_user and c.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  update public.access_tokens t set revoked_at = now(), revoked_reason = 'OWNER'
    from public.emergency_access_requests r
   where t.emergency_request_id = r.id and r.config_id = p_config_id and t.revoked_at is null;
  get diagnostics v_revoked = row_count;
  update public.emergency_access_requests set status = 'REVOKED', revoked_at = now(), revoked_by = 'OWNER'
   where config_id = p_config_id and status = 'ACTIVE';
  update public.emergency_access_requests set status = 'EXPIRED'
   where config_id = p_config_id and status in ('PENDING', 'VERIFYING', 'VERIFIED', 'APPROVED', 'AUTO_GRANTED');
  update public.emergency_access_configs set status = 'INACTIVE', deleted_at = now() where id = p_config_id;
  perform public.lv_audit(v_user, 'ea.contact_removed', 'emergency_access_config', p_config_id, 'SUCCESS',
    jsonb_build_object('beneficiaryId', v_cfg.beneficiary_id, 'tokensRevoked', v_revoked), p_corr);
  perform public.lv_end();
end;
$$;

-- APPROVE records the decision and enqueues exactly one access.deliver job in this
-- transaction (outbox); the token is minted by that job (ADR-014 § 6).
create function public.ea_decide_request(p_request_id uuid, p_decision text, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_req  public.emergency_access_requests%rowtype;
  v_cfg  public.emergency_access_configs%rowtype;
begin
  if p_decision not in ('APPROVE', 'DENY') then perform public.lv_raise_422('INVALID_DECISION'); end if;
  select r.* into v_req from public.emergency_access_requests r
    join public.emergency_access_configs c on c.id = r.config_id
   where r.id = p_request_id and c.user_id = v_user for update of r;
  if not found then perform public.lv_forbidden(); end if;
  select * into v_cfg from public.emergency_access_configs c where c.id = v_req.config_id;
  if v_req.status <> 'VERIFIED' then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_req.status, 'to', p_decision));
  end if;
  if p_decision = 'APPROVE' then
    update public.emergency_access_requests
       set status = 'APPROVED', decided_by = 'OWNER', decided_at = now()
     where id = p_request_id;
    perform public.lv_enqueue_access_delivery('EMERGENCY_ACCESS', p_request_id, v_cfg.beneficiary_id,
      jsonb_build_object('requestId', p_request_id, 'configId', v_cfg.id), false);
  else
    update public.emergency_access_requests
       set status = 'DENIED', decided_by = 'OWNER', decided_at = now()
     where id = p_request_id;
  end if;
  perform public.lv_audit(v_user, case when p_decision = 'APPROVE' then 'ea.request_approved' else 'ea.request_denied' end,
    'emergency_access_request', p_request_id, 'SUCCESS',
    jsonb_build_object('configId', v_cfg.id, 'beneficiaryId', v_cfg.beneficiary_id), p_corr);
  perform public.lv_end();
end;
$$;

create function public.ea_revoke(p_request_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.lv_require_user();
  v_req  public.emergency_access_requests%rowtype;
begin
  select r.* into v_req from public.emergency_access_requests r
    join public.emergency_access_configs c on c.id = r.config_id
   where r.id = p_request_id and c.user_id = v_user for update of r;
  if not found then perform public.lv_forbidden(); end if;
  if v_req.status <> 'ACTIVE' then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_req.status, 'to', 'REVOKED'));
  end if;
  if v_req.access_token_id is not null then
    perform public.lv_revoke_token(v_req.access_token_id, 'OWNER');
  end if;
  update public.emergency_access_requests
     set status = 'REVOKED', revoked_at = now(), revoked_by = 'OWNER'
   where id = p_request_id;
  perform public.lv_audit(v_user, 'ea.access_revoked', 'emergency_access_request', p_request_id, 'SUCCESS',
    jsonb_build_object('tokenId', v_req.access_token_id), p_corr);
  perform public.lv_end();
end;
$$;

-- =============================================================================
-- 7. AI drafts (Class B, ADR-016) — FR-M006–M011, FR-N007–N008
-- =============================================================================
create function public.update_ai_draft(p_draft_id uuid, p_content_encrypted jsonb, p_corr text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.lv_require_user();
  v_draft public.ai_drafts%rowtype;
  v_num   integer;
  v_id    uuid;
begin
  if not public.lv_is_envelope(p_content_encrypted) then
    perform public.lv_raise_422('INVALID_ENCRYPTION_ENVELOPE', '{"field":"content"}'::jsonb);
  end if;
  select * into v_draft from public.ai_drafts a
   where a.id = p_draft_id and a.user_id = v_user and a.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_draft.status not in ('DRAFT', 'PENDING_CONFIRMATION') then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_draft.status, 'to', 'USER_VERSION'));
  end if;
  select coalesce(max(v.version_number), 0) + 1 into v_num from public.ai_draft_versions v where v.draft_id = p_draft_id;
  insert into public.ai_draft_versions (draft_id, version_number, created_by, content)
  values (p_draft_id, v_num, 'USER', p_content_encrypted)
  returning id into v_id;
  update public.ai_drafts set current_version_id = v_id, status = 'PENDING_CONFIRMATION' where id = p_draft_id;
  perform public.lv_audit(v_user, 'ai_draft.user_version_added', 'ai_draft', p_draft_id, 'SUCCESS',
    jsonb_build_object('versionId', v_id, 'versionNumber', v_num), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

-- Explicit confirmation gate (constitution V/VI, FR-M010). Reverification is enforced by the API layer.
create function public.confirm_ai_draft(p_draft_id uuid, p_version_id uuid, p_corr text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.lv_require_user();
  v_draft public.ai_drafts%rowtype;
  v_superseded integer := 0;
begin
  select * into v_draft from public.ai_drafts a
   where a.id = p_draft_id and a.user_id = v_user and a.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_draft.kind <> 'WILL_DRAFT' then perform public.lv_raise_422('NOT_WILL_DRAFT'); end if;
  if v_draft.status not in ('DRAFT', 'PENDING_CONFIRMATION') then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_draft.status, 'to', 'CONFIRMED'));
  end if;
  if not exists (select 1 from public.ai_draft_versions v where v.id = p_version_id and v.draft_id = p_draft_id) then
    perform public.lv_raise_422('VERSION_NOT_IN_DRAFT');
  end if;
  update public.ai_drafts
     set status = 'SUPERSEDED'
   where user_id = v_user and kind = 'WILL_DRAFT' and status = 'CONFIRMED' and id <> p_draft_id
     and legacy_plan_id is not distinct from v_draft.legacy_plan_id;
  get diagnostics v_superseded = row_count;
  update public.ai_drafts
     set status = 'CONFIRMED', confirmed_version_id = p_version_id, current_version_id = p_version_id, confirmed_at = now()
   where id = p_draft_id;
  perform public.lv_audit(v_user, 'ai_draft.confirmed', 'ai_draft', p_draft_id, 'SUCCESS',
    jsonb_build_object('versionId', p_version_id, 'superseded', v_superseded, 'legacyPlanId', v_draft.legacy_plan_id), p_corr);
  perform public.lv_end();
end;
$$;

-- Selected analysis findings become records only through this explicit confirmation
-- (FR-N007/N008). Assets go through create_asset(); beneficiaries are inserted with
-- the same allow-listed columns a direct insert would use.
create function public.confirm_analysis_findings(
  p_draft_id uuid, p_assets jsonb default '[]'::jsonb, p_beneficiaries jsonb default '[]'::jsonb, p_corr text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := public.lv_require_user();
  v_draft    public.ai_drafts%rowtype;
  v_el       jsonb;
  v_id       uuid;
  v_assets   jsonb := '[]'::jsonb;
  v_benefs   jsonb := '[]'::jsonb;
  v_email    text;
begin
  if p_assets is null or jsonb_typeof(p_assets) <> 'array' then perform public.lv_raise_422('INVALID_INPUT', '{"field":"assets"}'::jsonb); end if;
  if p_beneficiaries is null or jsonb_typeof(p_beneficiaries) <> 'array' then perform public.lv_raise_422('INVALID_INPUT', '{"field":"beneficiaries"}'::jsonb); end if;
  select * into v_draft from public.ai_drafts a
   where a.id = p_draft_id and a.user_id = v_user and a.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_draft.kind <> 'DOCUMENT_ANALYSIS' then perform public.lv_raise_422('NOT_ANALYSIS_DRAFT'); end if;
  if v_draft.status not in ('DRAFT', 'PENDING_CONFIRMATION') then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_draft.status, 'to', 'CONFIRMED'));
  end if;

  for v_el in select value from jsonb_array_elements(p_assets) loop
    if jsonb_typeof(v_el) <> 'object' or (v_el ->> 'resourceType') not in ('FINANCIAL_ASSET','PHYSICAL_ASSET','DIGITAL_ASSET') then
      perform public.lv_raise_422('INVALID_INPUT', '{"field":"assets"}'::jsonb);
    end if;
    v_id := public.create_asset((v_el ->> 'resourceType')::public.assignment_resource_type,
                                coalesce(v_el -> 'plain', '{}'::jsonb), coalesce(v_el -> 'encrypted', '{}'::jsonb), p_corr);
    v_assets := v_assets || jsonb_build_array(jsonb_build_object('resourceType', v_el ->> 'resourceType', 'id', v_id));
  end loop;
  -- create_asset() clears the audit-suppression flag on return; re-arm it for the
  -- beneficiary inserts below, which this function audits explicitly.
  perform set_config('app.audit_in_function', 'on', true);

  for v_el in select value from jsonb_array_elements(p_beneficiaries) loop
    v_email := lower(nullif(trim(v_el ->> 'email'), ''));
    if jsonb_typeof(v_el) <> 'object' or coalesce(nullif(v_el ->> 'name', ''), '') = ''
       or coalesce(nullif(v_el ->> 'relationship', ''), '') = '' or v_email is null then
      perform public.lv_raise_422('INVALID_INPUT', '{"field":"beneficiaries"}'::jsonb);
    end if;
    if exists (select 1 from public.beneficiaries b where b.user_id = v_user and b.email = v_email and b.deleted_at is null) then
      perform public.lv_raise_409('DUPLICATE_BENEFICIARY', jsonb_build_object('email', v_email));
    end if;
    insert into public.beneficiaries (user_id, name, relationship, email, phone, notes)
    values (v_user, v_el ->> 'name', v_el ->> 'relationship', v_email, nullif(v_el ->> 'phone', ''), nullif(v_el ->> 'notes', ''))
    returning id into v_id;
    perform public.lv_audit(v_user, 'beneficiary.created', 'beneficiary', v_id, 'SUCCESS',
      jsonb_build_object('source', 'ai_analysis_confirmation', 'draftId', p_draft_id), p_corr);
    v_benefs := v_benefs || jsonb_build_array(jsonb_build_object('id', v_id));
  end loop;

  update public.ai_drafts
     set status = 'CONFIRMED', confirmed_version_id = coalesce(current_version_id, confirmed_version_id), confirmed_at = now()
   where id = p_draft_id;
  if (select confirmed_version_id from public.ai_drafts where id = p_draft_id) is null then
    perform public.lv_raise_422('DRAFT_HAS_NO_VERSION');
  end if;

  perform public.lv_audit(v_user, 'ai_draft.findings_confirmed', 'ai_draft', p_draft_id, 'SUCCESS',
    jsonb_build_object('assetsCreated', jsonb_array_length(v_assets), 'beneficiariesCreated', jsonb_array_length(v_benefs)), p_corr);
  perform public.lv_end();
  return jsonb_build_object('assets', v_assets, 'beneficiaries', v_benefs);
end;
$$;

-- =============================================================================
-- 8. System functions (service_role only, SECURITY INVOKER)
-- =============================================================================
-- Upload promotion (ADR-005): only SCANNED_CLEAN sessions become documents,
-- document versions or video messages; rows are created atomically.
create function public.promote_upload(p_upload_id uuid, p_target jsonb, p_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_s        public.upload_sessions%rowtype;
  v_bucket   text := p_target ->> 'bucket';
  v_key      text := p_target ->> 'key';
  v_mime     text := p_target ->> 'mimeType';
  v_size     bigint := (p_target ->> 'sizeBytes')::bigint;
  v_id       uuid;
  v_version  uuid;
  v_num      integer;
begin
  select * into v_s from public.upload_sessions u where u.id = p_upload_id for update;
  if not found then perform public.lv_raise_422('UPLOAD_NOT_FOUND'); end if;
  if v_s.status <> 'SCANNED_CLEAN' then
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_s.status, 'to', 'PROMOTED'));
  end if;
  if v_bucket is null or v_key is null or v_mime is null or v_size is null or v_size <= 0 then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"target"}'::jsonb);
  end if;

  case v_s.kind
    when 'DOCUMENT' then
      insert into public.documents (user_id, folder_id, name, mime_type, size_bytes, storage_bucket, storage_key, scan_status, metadata)
      values (v_s.user_id, v_s.folder_id, v_s.declared_name, v_mime, v_size, v_bucket, v_key, 'CLEAN', p_metadata -> 'document')
      returning id into v_id;
      insert into public.document_versions (document_id, version_number, storage_key, size_bytes, uploaded_by)
      values (v_id, 1, v_key, v_size, v_s.user_id) returning id into v_version;
      update public.documents set current_version_id = v_version where id = v_id;
    when 'DOCUMENT_VERSION' then
      select d.id into v_id from public.documents d
       where d.id = v_s.target_document_id and d.user_id = v_s.user_id and d.deleted_at is null for update;
      if v_id is null then perform public.lv_raise_422('TARGET_DOCUMENT_NOT_FOUND'); end if;
      select coalesce(max(v.version_number), 0) + 1 into v_num from public.document_versions v where v.document_id = v_id;
      insert into public.document_versions (document_id, version_number, storage_key, size_bytes, uploaded_by)
      values (v_id, v_num, v_key, v_size, v_s.user_id) returning id into v_version;
      update public.documents
         set current_version_id = v_version, storage_key = v_key, size_bytes = v_size, mime_type = v_mime, scan_status = 'CLEAN'
       where id = v_id;
    when 'VIDEO' then
      if (p_metadata ->> 'deliveryCondition') not in ('IMMEDIATE','DEAD_MAN_SWITCH','EMERGENCY_ACCESS') then
        perform public.lv_raise_422('INVALID_INPUT', '{"field":"deliveryCondition"}'::jsonb);
      end if;
      insert into public.video_messages
        (user_id, title, description, storage_bucket, storage_key, scan_status, mime_type, size_bytes, delivery_condition, metadata)
      values (v_s.user_id, coalesce(nullif(p_metadata ->> 'title', ''), v_s.declared_name), p_metadata ->> 'description',
              v_bucket, v_key, 'CLEAN', v_mime, v_size, (p_metadata ->> 'deliveryCondition')::public.delivery_condition,
              p_metadata -> 'metadata')
      returning id into v_id;
  end case;

  update public.upload_sessions set status = 'PROMOTED' where id = p_upload_id;
  perform public.lv_audit(v_s.user_id, 'upload.promoted',
    case v_s.kind when 'VIDEO' then 'video_message' else 'document' end, v_id, 'SUCCESS',
    jsonb_build_object('uploadId', p_upload_id, 'kind', v_s.kind, 'sizeBytes', v_size, 'mimeType', v_mime, 'versionId', v_version), null);
  return v_id;
end;
$$;

-- Job-driven Dead Man Switch transitions. The transition to RELEASED inserts the
-- per-contact access.deliver jobs as an outbox operation in the same transaction
-- (ADR-014 § 6); tokens are minted by those jobs, never here.
create function public.dms_transition(
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

  update public.dead_man_switches
     set status = p_to,
         next_check_in_at = coalesce(v_next, next_check_in_at),
         current_escalation_step = coalesce(v_step, current_escalation_step)
   where id = p_switch_id;

  v_event := public.lv_dms_event(p_switch_id, p_event_type, p_from::text, p_to::text, p_metadata);

  if p_to = 'RELEASED' then
    for v_contact in
      select c.beneficiary_id from public.dead_man_switch_contacts c
        join public.beneficiaries b on b.id = c.beneficiary_id
       where c.dead_man_switch_id = p_switch_id and b.deleted_at is null and b.status <> 'INACTIVE'
       order by c.notify_order
    loop
      perform public.lv_enqueue_access_delivery('DMS_RELEASE', v_event, v_contact.beneficiary_id,
        jsonb_build_object('switchId', p_switch_id, 'releaseEventId', v_event), false);
    end loop;
  end if;

  perform public.lv_audit(null, 'dms.transition', 'dead_man_switch', p_switch_id, 'SUCCESS',
    jsonb_build_object('from', p_from, 'to', p_to, 'eventType', p_event_type, 'eventId', v_event, 'ownerUserId', v_sw.user_id), null);
  return v_event;
end;
$$;

-- Public request flow (FR-J002/J003). Returns the request id, or NULL when the email
-- does not match the designated beneficiary so the API can answer generically.
create function public.ea_request_access(p_config_id uuid, p_requester_email text, p_otp_hash text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_cfg  public.emergency_access_configs%rowtype;
  v_ben  public.beneficiaries%rowtype;
  v_id   uuid;
begin
  if p_otp_hash !~ '^[0-9a-f]{64}$' then perform public.lv_raise_422('INVALID_OTP_HASH'); end if;
  select * into v_cfg from public.emergency_access_configs c
   where c.id = p_config_id and c.status = 'ACTIVE' and c.deleted_at is null;
  if not found then return null; end if;
  select * into v_ben from public.beneficiaries b where b.id = v_cfg.beneficiary_id and b.deleted_at is null and b.status <> 'INACTIVE';
  if not found or v_ben.email <> lower(trim(p_requester_email)) then
    perform public.lv_audit(null, 'ea.request_rejected', 'emergency_access_config', p_config_id, 'DENIED',
      jsonb_build_object('reason', 'EMAIL_MISMATCH_OR_INELIGIBLE'), null);
    return null;
  end if;
  insert into public.emergency_access_requests
    (config_id, requester_email, status, otp_hash, otp_expires_at, request_expires_at)
  values (p_config_id, v_ben.email, 'VERIFYING', p_otp_hash, now() + interval '15 minutes',
          now() + make_interval(hours => v_cfg.request_expiry_hours))
  returning id into v_id;
  perform public.lv_audit(null, 'ea.request_created', 'emergency_access_request', v_id, 'SUCCESS',
    jsonb_build_object('configId', p_config_id, 'ownerUserId', v_cfg.user_id, 'beneficiaryId', v_cfg.beneficiary_id), null);
  return v_id;
end;
$$;

-- OTP verification: ≤ 3 attempts, 15-minute expiry. Returns the resulting status.
create function public.ea_verify_otp(p_request_id uuid, p_otp_hash text)
returns public.ea_request_status
language plpgsql
set search_path = ''
as $$
declare
  v_req public.emergency_access_requests%rowtype;
  v_new public.ea_request_status;
begin
  select * into v_req from public.emergency_access_requests r where r.id = p_request_id for update;
  if not found then perform public.lv_raise_422('REQUEST_NOT_FOUND'); end if;
  if v_req.status <> 'VERIFYING' then
    return v_req.status;
  end if;
  if v_req.otp_expires_at is null or v_req.otp_expires_at < now() or v_req.request_expires_at < now() then
    update public.emergency_access_requests set status = 'FAILED' where id = p_request_id;
    perform public.lv_audit(null, 'ea.otp_expired', 'emergency_access_request', p_request_id, 'DENIED', null, null);
    return 'FAILED';
  end if;
  if v_req.otp_hash is not null and v_req.otp_hash = p_otp_hash then
    update public.emergency_access_requests set status = 'VERIFIED', otp_hash = null where id = p_request_id;
    perform public.lv_audit(null, 'ea.otp_verified', 'emergency_access_request', p_request_id, 'SUCCESS', null, null);
    return 'VERIFIED';
  end if;
  v_new := case when v_req.verification_attempts + 1 >= 3 then 'FAILED' else 'VERIFYING' end;
  update public.emergency_access_requests
     set verification_attempts = verification_attempts + 1, status = v_new,
         otp_hash = case when v_new = 'FAILED' then null else otp_hash end
   where id = p_request_id;
  perform public.lv_audit(null, 'ea.otp_rejected', 'emergency_access_request', p_request_id, 'DENIED',
    jsonb_build_object('attempts', v_req.verification_attempts + 1, 'status', v_new), null);
  return v_new;
end;
$$;

-- Job/system transitions for emergency requests (timeout rules, expiry, activation).
create function public.ea_transition(p_request_id uuid, p_to public.ea_request_status, p_metadata jsonb default '{}'::jsonb)
returns public.ea_request_status
language plpgsql
set search_path = ''
as $$
declare
  v_req public.emergency_access_requests%rowtype;
  v_cfg public.emergency_access_configs%rowtype;
begin
  select * into v_req from public.emergency_access_requests r where r.id = p_request_id for update;
  if not found then perform public.lv_raise_422('REQUEST_NOT_FOUND'); end if;
  select * into v_cfg from public.emergency_access_configs c where c.id = v_req.config_id;

  if p_to = 'AUTO_GRANTED' and v_req.status = 'VERIFIED' then
    update public.emergency_access_requests set status = 'AUTO_GRANTED', decided_by = 'SYSTEM', decided_at = now() where id = p_request_id;
    perform public.lv_enqueue_access_delivery('EMERGENCY_ACCESS', p_request_id, v_cfg.beneficiary_id,
      jsonb_build_object('requestId', p_request_id, 'configId', v_cfg.id), false);
  elsif p_to = 'DENIED' and v_req.status = 'VERIFIED' then
    update public.emergency_access_requests set status = 'DENIED', decided_by = 'SYSTEM', decided_at = now() where id = p_request_id;
  elsif p_to = 'EXPIRED' and v_req.status in ('PENDING', 'VERIFYING', 'VERIFIED') then
    update public.emergency_access_requests set status = 'EXPIRED', otp_hash = null where id = p_request_id;
  elsif p_to = 'ACTIVE' and v_req.status in ('APPROVED', 'AUTO_GRANTED') then
    if v_req.access_token_id is null then perform public.lv_raise_409('TOKEN_REQUIRED_FOR_ACTIVATION'); end if;
    update public.emergency_access_requests
       set status = 'ACTIVE', granted_at = now(), expires_at = now() + make_interval(hours => v_cfg.access_duration_hours)
     where id = p_request_id;
  elsif p_to = 'EXPIRED' and v_req.status = 'ACTIVE' then
    if v_req.access_token_id is not null then perform public.lv_revoke_token(v_req.access_token_id, 'EXPIRED'); end if;
    update public.emergency_access_requests set status = 'EXPIRED', revoked_at = now(), revoked_by = 'EXPIRY' where id = p_request_id;
  else
    perform public.lv_raise_409('INVALID_TRANSITION', jsonb_build_object('from', v_req.status, 'to', p_to));
  end if;

  perform public.lv_audit(null, 'ea.transition', 'emergency_access_request', p_request_id, 'SUCCESS',
    jsonb_build_object('from', v_req.status, 'to', p_to, 'ownerUserId', v_cfg.user_id) || coalesce(p_metadata, '{}'::jsonb), null);
  return p_to;
end;
$$;

-- Mints a DMS_RELEASE / EMERGENCY_ACCESS token (called only by the access.deliver job).
-- The owner and the beneficiary are derived from the switch/request, never trusted from input.
create function public.system_issue_access_token(
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

  -- Re-validate ownership + delivery-condition mapping, then require ⊆ configured scope.
  v_scope := public.lv_validate_scope(v_owner, p_scope, p_grant_type, null);
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
                       'deadManSwitchId', p_dms_id, 'emergencyRequestId', p_request_id, 'expiresAt', p_expires_at), null);
  return v_id;
end;
$$;

-- Reissue-on-retry / audited resend for system grants: revoke the previous token
-- and mint exactly one replacement with identical grant, beneficiary, scope and links.
create function public.system_reissue_access_token(
  p_previous_token_id uuid, p_token_hash text, p_expires_at timestamptz, p_reason public.token_revoked_reason
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_prev public.access_tokens%rowtype;
  v_id   uuid;
begin
  if p_reason not in ('UNDELIVERED_REPLACED', 'RESENT', 'ADMIN') then perform public.lv_raise_422('INVALID_REASON'); end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then perform public.lv_raise_422('INVALID_TOKEN_HASH'); end if;
  if p_expires_at is null or p_expires_at <= now() then perform public.lv_raise_422('INVALID_EXPIRY'); end if;
  select * into v_prev from public.access_tokens t where t.id = p_previous_token_id for update;
  if not found then perform public.lv_raise_422('TOKEN_NOT_FOUND'); end if;
  if v_prev.grant_type not in ('DMS_RELEASE', 'EMERGENCY_ACCESS') then perform public.lv_raise_422('NOT_SYSTEM_GRANT'); end if;
  if v_prev.revoked_at is not null then perform public.lv_raise_409('TOKEN_ALREADY_REVOKED'); end if;
  if p_reason = 'UNDELIVERED_REPLACED' and v_prev.delivered_at is not null then
    perform public.lv_raise_409('TOKEN_ALREADY_DELIVERED');
  end if;

  perform public.lv_revoke_token(p_previous_token_id, p_reason);
  insert into public.access_tokens
    (owner_user_id, beneficiary_id, grant_type, dead_man_switch_id, emergency_request_id, token_hash, scope, expires_at, replaces_token_id)
  values (v_prev.owner_user_id, v_prev.beneficiary_id, v_prev.grant_type, v_prev.dead_man_switch_id, v_prev.emergency_request_id,
          p_token_hash, v_prev.scope, p_expires_at, p_previous_token_id)
  returning id into v_id;
  if v_prev.grant_type = 'EMERGENCY_ACCESS' then
    update public.emergency_access_requests set access_token_id = v_id where id = v_prev.emergency_request_id;
  end if;
  perform public.lv_audit(null, 'access.token_replaced', 'access_token', v_id, 'SUCCESS',
    jsonb_build_object('replacesTokenId', p_previous_token_id, 'reason', p_reason, 'ownerUserId', v_prev.owner_user_id,
                       'beneficiaryId', v_prev.beneficiary_id, 'grantType', v_prev.grant_type), null);
  return v_id;
end;
$$;

create function public.system_mark_token_delivered(p_token_id uuid, p_provider_message_id text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.access_tokens
     set delivered_at = coalesce(delivered_at, now()),
         delivery_provider_message_id = coalesce(p_provider_message_id, delivery_provider_message_id)
   where id = p_token_id;
  if not found then perform public.lv_raise_422('TOKEN_NOT_FOUND'); end if;
end;
$$;

-- Job runner claim (ADR-006): FOR UPDATE SKIP LOCKED so concurrent runners
-- (Vercel Cron and the pg_cron redundancy trigger) never process the same job.
create function public.claim_jobs(p_limit integer default 20, p_runner_id text default null)
returns setof public.jobs
language plpgsql
set search_path = ''
as $$
begin
  return query
  update public.jobs j
     set status = 'RUNNING', locked_at = now(), locked_by = p_runner_id, attempts = j.attempts + 1
   where j.id in (
     select q.id from public.jobs q
      where q.status = 'QUEUED' and q.run_at <= now()
      order by q.run_at
      limit greatest(1, least(coalesce(p_limit, 20), 100))
      for update skip locked)
  returning j.*;
end;
$$;

-- Fixed-window counter (ADR-007). Returns { allowed, count, limit }.
create function public.rate_limit_hit(p_key text, p_window_start timestamptz, p_limit integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, p_window_start, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return jsonb_build_object('allowed', v_count <= p_limit, 'count', v_count, 'limit', p_limit);
end;
$$;

-- Webhook idempotency: true when this is the first time the event is seen.
create function public.record_webhook_event(p_provider public.webhook_provider, p_event_id text, p_event_type text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inserted boolean;
begin
  insert into public.processed_webhook_events (provider, event_id, event_type)
  values (p_provider, p_event_id, p_event_type)
  on conflict (provider, event_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- =============================================================================
-- 9. Privileges (rule 8): helpers are internal; guarded functions → authenticated;
--    system functions → service_role. Default privileges (0002) already revoke
--    PUBLIC/anon/authenticated on new functions; the explicit statements below
--    make the intent visible and idempotent.
-- =============================================================================
revoke all on function public.lv_forbidden() from public, anon, authenticated;
revoke all on function public.lv_raise_422(text, jsonb) from public, anon, authenticated;
revoke all on function public.lv_raise_409(text, jsonb) from public, anon, authenticated;
revoke all on function public.lv_require_user() from public, anon, authenticated;
revoke all on function public.lv_end() from public, anon, authenticated;
revoke all on function public.lv_audit(uuid, text, text, uuid, public.audit_outcome, jsonb, text) from public, anon, authenticated;
revoke all on function public.lv_is_envelope(jsonb) from public, anon, authenticated;
revoke all on function public.lv_envelope_text(jsonb, text) from public, anon, authenticated;
revoke all on function public.lv_jsonb_uuid_array(jsonb, text) from public, anon, authenticated;
revoke all on function public.lv_video_allowed(public.delivery_condition, public.access_grant_type) from public, anon, authenticated;
revoke all on function public.lv_resource_owned(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.lv_validate_scope(uuid, jsonb, public.access_grant_type, uuid) from public, anon, authenticated;
revoke all on function public.lv_scope_subset(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.lv_enqueue_job(text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.lv_revoke_token(uuid, public.token_revoked_reason) from public, anon, authenticated;
revoke all on function public.lv_revoke_tokens_for_beneficiary(uuid, public.token_revoked_reason) from public, anon, authenticated;
revoke all on function public.lv_dms_event(uuid, public.dms_event_type, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.lv_enqueue_access_delivery(public.access_grant_type, uuid, uuid, jsonb, boolean) from public, anon, authenticated;

-- service_role executes system functions (SECURITY INVOKER), so it needs the helpers they call.
grant execute on function public.lv_forbidden() to service_role;
grant execute on function public.lv_raise_422(text, jsonb) to service_role;
grant execute on function public.lv_raise_409(text, jsonb) to service_role;
grant execute on function public.lv_audit(uuid, text, text, uuid, public.audit_outcome, jsonb, text) to service_role;
grant execute on function public.lv_is_envelope(jsonb) to service_role;
grant execute on function public.lv_envelope_text(jsonb, text) to service_role;
grant execute on function public.lv_jsonb_uuid_array(jsonb, text) to service_role;
grant execute on function public.lv_video_allowed(public.delivery_condition, public.access_grant_type) to service_role;
grant execute on function public.lv_resource_owned(uuid, text, uuid) to service_role;
grant execute on function public.lv_validate_scope(uuid, jsonb, public.access_grant_type, uuid) to service_role;
grant execute on function public.lv_scope_subset(jsonb, jsonb) to service_role;
grant execute on function public.lv_enqueue_job(text, jsonb, text, timestamptz) to service_role;
grant execute on function public.lv_revoke_token(uuid, public.token_revoked_reason) to service_role;
grant execute on function public.lv_revoke_tokens_for_beneficiary(uuid, public.token_revoked_reason) to service_role;
grant execute on function public.lv_dms_event(uuid, public.dms_event_type, text, text, jsonb) to service_role;
grant execute on function public.lv_enqueue_access_delivery(public.access_grant_type, uuid, uuid, jsonb, boolean) to service_role;

-- Guarded functions: authenticated only.
revoke all on function public.create_legacy_plan(text) from public, anon;
grant execute on function public.create_legacy_plan(text) to authenticated;
revoke all on function public.save_plan_step(uuid, text, jsonb, integer, text) from public, anon;
grant execute on function public.save_plan_step(uuid, text, jsonb, integer, text) to authenticated;
revoke all on function public.finalize_legacy_plan(uuid, integer, boolean, text) from public, anon;
grant execute on function public.finalize_legacy_plan(uuid, integer, boolean, text) to authenticated;
revoke all on function public.create_plan_draft(uuid, text) from public, anon;
grant execute on function public.create_plan_draft(uuid, text) to authenticated;
revoke all on function public.assign_beneficiary(uuid, public.assignment_resource_type, uuid, numeric, text) from public, anon;
grant execute on function public.assign_beneficiary(uuid, public.assignment_resource_type, uuid, numeric, text) to authenticated;
revoke all on function public.unassign_beneficiary(uuid, text) from public, anon;
grant execute on function public.unassign_beneficiary(uuid, text) to authenticated;
revoke all on function public.set_beneficiary_status(uuid, public.beneficiary_status, text) from public, anon;
grant execute on function public.set_beneficiary_status(uuid, public.beneficiary_status, text) to authenticated;
revoke all on function public.remove_beneficiary(uuid, text) from public, anon;
grant execute on function public.remove_beneficiary(uuid, text) to authenticated;
revoke all on function public.attach_document(uuid, public.attachment_resource_type, uuid, text) from public, anon;
grant execute on function public.attach_document(uuid, public.attachment_resource_type, uuid, text) to authenticated;
revoke all on function public.detach_document(uuid, text) from public, anon;
grant execute on function public.detach_document(uuid, text) to authenticated;
revoke all on function public.issue_access_token(uuid, jsonb, text, timestamptz, text) from public, anon;
grant execute on function public.issue_access_token(uuid, jsonb, text, timestamptz, text) to authenticated;
revoke all on function public.revoke_access_token(uuid, text) from public, anon;
grant execute on function public.revoke_access_token(uuid, text) to authenticated;
revoke all on function public.resend_access_token(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.resend_access_token(uuid, text, timestamptz, text) to authenticated;
revoke all on function public.delete_document(uuid, text) from public, anon;
grant execute on function public.delete_document(uuid, text) to authenticated;
revoke all on function public.delete_video(uuid, text) from public, anon;
grant execute on function public.delete_video(uuid, text) to authenticated;
revoke all on function public.create_asset(public.assignment_resource_type, jsonb, jsonb, text) from public, anon;
grant execute on function public.create_asset(public.assignment_resource_type, jsonb, jsonb, text) to authenticated;
revoke all on function public.set_encrypted_fields(text, uuid, jsonb, text) from public, anon;
grant execute on function public.set_encrypted_fields(text, uuid, jsonb, text) to authenticated;
revoke all on function public.delete_asset(public.assignment_resource_type, uuid, text) from public, anon;
grant execute on function public.delete_asset(public.assignment_resource_type, uuid, text) to authenticated;
revoke all on function public.dms_configure(jsonb, uuid[], jsonb, text) from public, anon;
grant execute on function public.dms_configure(jsonb, uuid[], jsonb, text) to authenticated;
revoke all on function public.dms_pause(text) from public, anon;
grant execute on function public.dms_pause(text) to authenticated;
revoke all on function public.dms_resume(text) from public, anon;
grant execute on function public.dms_resume(text) to authenticated;
revoke all on function public.dms_disable(text) from public, anon;
grant execute on function public.dms_disable(text) to authenticated;
revoke all on function public.dms_check_in(text) from public, anon;
grant execute on function public.dms_check_in(text) to authenticated;
revoke all on function public.dms_cancel_escalation(text) from public, anon;
grant execute on function public.dms_cancel_escalation(text) to authenticated;
revoke all on function public.ea_configure_contact(uuid, jsonb, public.ea_on_timeout, integer, integer, integer, text) from public, anon;
grant execute on function public.ea_configure_contact(uuid, jsonb, public.ea_on_timeout, integer, integer, integer, text) to authenticated;
revoke all on function public.ea_update_contact(uuid, jsonb, public.ea_on_timeout, integer, integer, integer, text) from public, anon;
grant execute on function public.ea_update_contact(uuid, jsonb, public.ea_on_timeout, integer, integer, integer, text) to authenticated;
revoke all on function public.ea_remove_contact(uuid, text) from public, anon;
grant execute on function public.ea_remove_contact(uuid, text) to authenticated;
revoke all on function public.ea_decide_request(uuid, text, text) from public, anon;
grant execute on function public.ea_decide_request(uuid, text, text) to authenticated;
revoke all on function public.ea_revoke(uuid, text) from public, anon;
grant execute on function public.ea_revoke(uuid, text) to authenticated;
revoke all on function public.update_ai_draft(uuid, jsonb, text) from public, anon;
grant execute on function public.update_ai_draft(uuid, jsonb, text) to authenticated;
revoke all on function public.confirm_ai_draft(uuid, uuid, text) from public, anon;
grant execute on function public.confirm_ai_draft(uuid, uuid, text) to authenticated;
revoke all on function public.confirm_analysis_findings(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.confirm_analysis_findings(uuid, jsonb, jsonb, text) to authenticated;

-- System functions: service_role only.
revoke all on function public.promote_upload(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.promote_upload(uuid, jsonb, jsonb) to service_role;
revoke all on function public.dms_transition(uuid, public.dms_status, public.dms_status, public.dms_event_type, jsonb) from public, anon, authenticated;
grant execute on function public.dms_transition(uuid, public.dms_status, public.dms_status, public.dms_event_type, jsonb) to service_role;
revoke all on function public.ea_request_access(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ea_request_access(uuid, text, text) to service_role;
revoke all on function public.ea_verify_otp(uuid, text) from public, anon, authenticated;
grant execute on function public.ea_verify_otp(uuid, text) to service_role;
revoke all on function public.ea_transition(uuid, public.ea_request_status, jsonb) from public, anon, authenticated;
grant execute on function public.ea_transition(uuid, public.ea_request_status, jsonb) to service_role;
revoke all on function public.system_issue_access_token(uuid, public.access_grant_type, jsonb, text, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.system_issue_access_token(uuid, public.access_grant_type, jsonb, text, timestamptz, uuid, uuid) to service_role;
revoke all on function public.system_reissue_access_token(uuid, text, timestamptz, public.token_revoked_reason) from public, anon, authenticated;
grant execute on function public.system_reissue_access_token(uuid, text, timestamptz, public.token_revoked_reason) to service_role;
revoke all on function public.system_mark_token_delivered(uuid, text) from public, anon, authenticated;
grant execute on function public.system_mark_token_delivered(uuid, text) to service_role;
revoke all on function public.claim_jobs(integer, text) from public, anon, authenticated;
grant execute on function public.claim_jobs(integer, text) to service_role;
revoke all on function public.rate_limit_hit(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, timestamptz, integer) to service_role;
revoke all on function public.record_webhook_event(public.webhook_provider, text, text) from public, anon, authenticated;
grant execute on function public.record_webhook_event(public.webhook_provider, text, text) to service_role;
