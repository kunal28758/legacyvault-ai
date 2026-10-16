-- =============================================================================
-- 0013 — Audit minimisation: no personal values in new Class A trigger rows
--
-- Additive and forward-only: one function body replaced, no table or trigger
-- change, existing audit rows untouched (the append-only trigger still refuses
-- any update or delete of audit_log).
--
-- audit_class_a_change() (0002 § 6c) recorded the old and new VALUES of
-- personal columns — names, contact details, addresses, dates of birth, notes,
-- asset descriptions and values, document and video titles — so they outlived
-- the record and even a permanent account deletion (0012). From this migration
-- on, a trigger row still lists every changed column in `changed`, and keeps
-- the values of non-personal state only (status, lifecycle timestamps,
-- category, currency, folder/version links, scan status, preferences); every
-- other value is written as '[protected]', as unlisted columns always were.
--
-- The guarded create_asset() / delete_asset() (0003) also recorded the asset's
-- name in their audit metadata; they are re-created below with only that key
-- removed (CREATE OR REPLACE keeps their owner and grants).
--
-- What stays answerable: who (actor, role) changed which fields of which record,
-- when, in which request. What no new row holds: the personal content itself.
-- The application-level diffs (lib/audit/audit.service.ts, diffForAudit)
-- follow the same rule.
--
-- Existing rows keep their values; whether to redact them is the open
-- retention decision (docs/release/ACCOUNT_DELETION_READINESS.md § 5).
-- Rollback: re-create the 0002 definition (forward fix); nothing else depends
-- on the recorded values (the activity feed hides trigger rows).
-- =============================================================================

create or replace function public.audit_class_a_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old        jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_new        jsonb := to_jsonb(new);
  v_loggable   text[];
  v_redacted   text[];
  v_changed    text[] := '{}';
  v_previous   jsonb := '{}'::jsonb;
  v_current    jsonb := '{}'::jsonb;
  v_key        text;
  v_actor      uuid;
  v_role       text := public.current_jwt_role();
  v_resource   uuid;
  v_owner      uuid;
begin
  -- Guarded functions audit themselves. They set this transaction-local flag in
  -- their prologue and clear it before returning (0003); PostgREST executes every
  -- request in its own transaction and exposes no other way to set a GUC, so a
  -- direct table write can never run with the flag on.
  if current_setting('app.audit_in_function', true) = 'on' then
    return new;
  end if;

  case tg_table_name
    when 'users' then
      v_loggable := array['preferences','notification_preferences','security_preferences','onboarding_completed_at'];
      v_redacted := array['identification_details','role','email','email_verified','mfa_enabled','name',
                          'clerk_user_id','last_login_at','deletion_requested_at','deleted_at'];
    when 'beneficiaries' then
      v_loggable := array['status','invited_at','activated_at','deleted_at'];
      v_redacted := '{}';
    when 'financial_assets' then
      v_loggable := array['category','currency','deleted_at'];
      v_redacted := array['account_number','policy_number'];
    when 'physical_assets' then
      v_loggable := array['category','currency','deleted_at'];
      v_redacted := '{}';
    when 'digital_assets' then
      v_loggable := array['category','currency','deleted_at'];
      v_redacted := array['credentials','recovery_info'];
    when 'folders' then
      v_loggable := array['parent_id','deleted_at'];
      v_redacted := '{}';
    when 'documents' then
      v_loggable := array['folder_id','scan_status','current_version_id','deleted_at'];
      v_redacted := array['storage_key','encryption_key_id'];
    when 'video_messages' then
      v_loggable := array['delivery_condition','scan_status','deleted_at'];
      v_redacted := array['storage_key','encryption_key_id'];
    else
      v_loggable := '{}';
      v_redacted := '{}';
  end case;

  for v_key in select jsonb_object_keys(v_new) loop
    if v_key in ('id','user_id','created_at','updated_at') then
      continue;
    end if;
    if tg_op = 'INSERT' or (v_new -> v_key) is distinct from (v_old -> v_key) then
      v_changed := v_changed || v_key;
      if v_key = any (v_loggable) then
        if tg_op = 'UPDATE' then v_previous := v_previous || jsonb_build_object(v_key, v_old -> v_key); end if;
        v_current := v_current || jsonb_build_object(v_key, v_new -> v_key);
      elsif v_key = any (v_redacted) then
        if tg_op = 'UPDATE' then v_previous := v_previous || jsonb_build_object(v_key, '[encrypted]'); end if;
        v_current := v_current || jsonb_build_object(v_key, '[encrypted]');
      else
        if tg_op = 'UPDATE' then v_previous := v_previous || jsonb_build_object(v_key, '[protected]'); end if;
        v_current := v_current || jsonb_build_object(v_key, '[protected]');
      end if;
    end if;
  end loop;

  if tg_op = 'UPDATE' and cardinality(v_changed) = 0 then
    return new;
  end if;

  v_resource := (v_new ->> 'id')::uuid;
  v_owner := case when tg_table_name = 'users' then v_resource else (v_new ->> 'user_id')::uuid end;
  v_actor := case when v_role = 'authenticated' then public.current_user_id() else null end;

  insert into public.audit_log
    (actor_id, actor_role, action, resource_type, resource_id, outcome, metadata, correlation_id)
  values (
    v_actor,
    coalesce(v_role, current_user),
    tg_table_name || case when tg_op = 'INSERT' then '.row_created' else '.row_changed' end,
    tg_table_name,
    v_resource,
    'SUCCESS',
    jsonb_build_object(
      'source', 'db_trigger',
      'db_role', coalesce(v_role, current_user),
      'owner_user_id', v_owner,
      'changed', to_jsonb(v_changed),
      'previous', case when tg_op = 'UPDATE' then v_previous else null end,
      'new', v_current
    ),
    nullif(current_setting('app.correlation_id', true), '')
  );
  return new;
end;
$$;
revoke all on function public.audit_class_a_change() from public, anon, authenticated;

create or replace function public.create_asset(
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
    jsonb_build_object('category', p_plain ->> 'category', 'encryptedFieldsSet', to_jsonb(v_enc_set)), p_corr);
  perform public.lv_end();
  return v_id;
exception
  when invalid_text_representation then
    -- an unparsable category / estimatedValue in p_plain
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"plain"}'::jsonb);
    return null;
end;
$$;

create or replace function public.delete_asset(p_resource_type public.assignment_resource_type, p_asset_id uuid, p_corr text default null)
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
    jsonb_build_object('assignmentsRemoved', v_assignments, 'attachmentsRemoved', v_attachments), p_corr);
  perform public.lv_end();
end;
$$;
