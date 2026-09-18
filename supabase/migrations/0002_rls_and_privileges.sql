-- =============================================================================
-- LegacyVault AI — 0002_rls_and_privileges.sql (task T218)
-- Privilege baseline, row-level security, column allow-lists, protection
-- triggers and storage policies per data-model.md § Write-Protection Model 1–6
-- and ADR-004 r4. Business functions live in 0003.
--
-- Roles (Supabase): anon = unauthenticated PostgREST, authenticated = a user
-- presenting their own Clerk session token (Supabase third-party auth adds
-- role=authenticated; sub = users.clerk_user_id), service_role = server-only
-- secret key (bypasses RLS). Migrations run as postgres, the object owner.
-- The Supabase CLI applies this file in its own transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Privilege baseline: nothing is reachable by anon/authenticated unless
--    granted explicitly below. service_role keeps full table access (it is the
--    server's own identity; every service-client path authorizes in code).
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- set_updated_at() is a trigger function; no role needs to call it directly.
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Identity helper used by every policy: the app user whose clerk_user_id
--    equals the JWT subject. SECURITY DEFINER so it can read users regardless
--    of the caller's own SELECT policy; STABLE so planners cache it per query.
-- -----------------------------------------------------------------------------
create function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where u.clerk_user_id = (select auth.jwt() ->> 'sub')
    and u.deleted_at is null
  limit 1
$$;
revoke all on function public.current_user_id() from public, anon;
grant execute on function public.current_user_id() to authenticated, service_role;

-- Role claim of the current request ('authenticated', 'service_role', 'anon' or NULL
-- for a direct database session such as migrations/cron inside Postgres).
create function public.current_jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;
revoke all on function public.current_jwt_role() from public, anon;
grant execute on function public.current_jwt_role() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Row-level security on every table (deny-by-default). Tables without a
--    policy below (jobs, rate_limits, processed_webhook_events) are reachable
--    only by service_role.
-- -----------------------------------------------------------------------------
alter table public.users                     enable row level security;
alter table public.beneficiaries             enable row level security;
alter table public.financial_assets          enable row level security;
alter table public.physical_assets           enable row level security;
alter table public.digital_assets            enable row level security;
alter table public.folders                   enable row level security;
alter table public.documents                 enable row level security;
alter table public.document_versions         enable row level security;
alter table public.legacy_plans              enable row level security;
alter table public.legacy_plan_versions      enable row level security;
alter table public.video_messages            enable row level security;
alter table public.dead_man_switches         enable row level security;
alter table public.dead_man_switch_events    enable row level security;
alter table public.dead_man_switch_contacts  enable row level security;
alter table public.emergency_access_configs  enable row level security;
alter table public.emergency_access_requests enable row level security;
alter table public.access_tokens             enable row level security;
alter table public.beneficiary_assignments   enable row level security;
alter table public.document_attachments      enable row level security;
alter table public.audit_log                 enable row level security;
alter table public.ai_drafts                 enable row level security;
alter table public.ai_draft_versions         enable row level security;
alter table public.ai_interactions           enable row level security;
alter table public.notifications             enable row level security;
alter table public.jobs                      enable row level security;
alter table public.upload_sessions           enable row level security;
alter table public.rate_limits               enable row level security;
alter table public.processed_webhook_events  enable row level security;

-- -----------------------------------------------------------------------------
-- 4. SELECT own rows (Class A, B and the SELECT-own Class C tables)
-- -----------------------------------------------------------------------------
create policy users_select_own on public.users
  for select to authenticated
  using (clerk_user_id = (select auth.jwt() ->> 'sub'));

create policy beneficiaries_select_own on public.beneficiaries
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy financial_assets_select_own on public.financial_assets
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy physical_assets_select_own on public.physical_assets
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy digital_assets_select_own on public.digital_assets
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy folders_select_own on public.folders
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy documents_select_own on public.documents
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy document_versions_select_own on public.document_versions
  for select to authenticated using (
    exists (select 1 from public.documents d
            where d.id = document_versions.document_id
              and d.user_id = (select public.current_user_id()))
  );
create policy legacy_plans_select_own on public.legacy_plans
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy legacy_plan_versions_select_own on public.legacy_plan_versions
  for select to authenticated using (
    exists (select 1 from public.legacy_plans p
            where p.id = legacy_plan_versions.legacy_plan_id
              and p.user_id = (select public.current_user_id()))
  );
create policy video_messages_select_own on public.video_messages
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy dead_man_switches_select_own on public.dead_man_switches
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy dead_man_switch_events_select_own on public.dead_man_switch_events
  for select to authenticated using (
    exists (select 1 from public.dead_man_switches s
            where s.id = dead_man_switch_events.dead_man_switch_id
              and s.user_id = (select public.current_user_id()))
  );
create policy dead_man_switch_contacts_select_own on public.dead_man_switch_contacts
  for select to authenticated using (
    exists (select 1 from public.dead_man_switches s
            where s.id = dead_man_switch_contacts.dead_man_switch_id
              and s.user_id = (select public.current_user_id()))
  );
create policy emergency_access_configs_select_own on public.emergency_access_configs
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy emergency_access_requests_select_own on public.emergency_access_requests
  for select to authenticated using (
    exists (select 1 from public.emergency_access_configs c
            where c.id = emergency_access_requests.config_id
              and c.user_id = (select public.current_user_id()))
  );
create policy access_tokens_select_own on public.access_tokens
  for select to authenticated using (owner_user_id = (select public.current_user_id()));
create policy beneficiary_assignments_select_own on public.beneficiary_assignments
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy document_attachments_select_own on public.document_attachments
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy audit_log_select_own on public.audit_log
  for select to authenticated using (actor_id = (select public.current_user_id()));
create policy ai_drafts_select_own on public.ai_drafts
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy ai_draft_versions_select_own on public.ai_draft_versions
  for select to authenticated using (
    exists (select 1 from public.ai_drafts a
            where a.id = ai_draft_versions.draft_id
              and a.user_id = (select public.current_user_id()))
  );
create policy ai_interactions_select_own on public.ai_interactions
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select public.current_user_id()));
create policy upload_sessions_select_own on public.upload_sessions
  for select to authenticated using (user_id = (select public.current_user_id()));

-- The token hash is never readable through the API (T098 lists tokens without it):
-- authenticated may SELECT every column except token_hash.
grant select (id, owner_user_id, beneficiary_id, grant_type, dead_man_switch_id, emergency_request_id,
              scope, expires_at, revoked_at, revoked_reason, delivered_at, delivery_provider_message_id,
              replaces_token_id, used_at, last_used_at, created_at)
  on public.access_tokens to authenticated;
-- Likewise the OTP hash of an emergency request is never exposed to the owner.
grant select (id, config_id, requester_email, status, otp_expires_at, verification_attempts, request_expires_at,
              decided_by, decided_at, access_token_id, granted_at, expires_at, revoked_at, revoked_by,
              created_at, updated_at)
  on public.emergency_access_requests to authenticated;

grant select on public.users, public.beneficiaries, public.financial_assets, public.physical_assets,
  public.digital_assets, public.folders, public.documents, public.document_versions, public.legacy_plans,
  public.legacy_plan_versions, public.video_messages, public.dead_man_switches, public.dead_man_switch_events,
  public.dead_man_switch_contacts, public.emergency_access_configs, public.beneficiary_assignments,
  public.document_attachments, public.audit_log, public.ai_drafts, public.ai_draft_versions,
  public.ai_interactions, public.notifications, public.upload_sessions
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Class A direct writes: row policies + column allow-lists (data-model § 4).
--    ENCRYPTED columns (users.identification_details, financial_assets.account_number /
--    policy_number, digital_assets.credentials / recovery_info) receive NO grant: they
--    are written only by create_asset() / set_encrypted_fields() (0003). Asset rows have
--    no INSERT grant (create_asset()) and no direct deleted_at (delete_asset()).
-- -----------------------------------------------------------------------------
create policy users_update_own on public.users
  for update to authenticated
  using (clerk_user_id = (select auth.jwt() ->> 'sub'))
  with check (clerk_user_id = (select auth.jwt() ->> 'sub'));
grant update (date_of_birth, phone, alternate_email, address, family_info, preferences,
              notification_preferences, security_preferences, onboarding_completed_at)
  on public.users to authenticated;

create policy beneficiaries_insert_own on public.beneficiaries
  for insert to authenticated
  with check (user_id = (select public.current_user_id()));
create policy beneficiaries_update_own on public.beneficiaries
  for update to authenticated
  using (user_id = (select public.current_user_id()) and deleted_at is null)
  with check (user_id = (select public.current_user_id()));
grant insert (user_id, name, relationship, email, phone, notes) on public.beneficiaries to authenticated;
grant update (name, relationship, email, phone, notes) on public.beneficiaries to authenticated;

create policy financial_assets_update_own on public.financial_assets
  for update to authenticated
  using (user_id = (select public.current_user_id()) and deleted_at is null)
  with check (user_id = (select public.current_user_id()));
grant update (name, category, institution, estimated_value, currency, notes, metadata)
  on public.financial_assets to authenticated;

create policy physical_assets_update_own on public.physical_assets
  for update to authenticated
  using (user_id = (select public.current_user_id()) and deleted_at is null)
  with check (user_id = (select public.current_user_id()));
grant update (name, category, description, location, estimated_value, currency, ownership_details, notes, metadata)
  on public.physical_assets to authenticated;

create policy digital_assets_update_own on public.digital_assets
  for update to authenticated
  using (user_id = (select public.current_user_id()) and deleted_at is null)
  with check (user_id = (select public.current_user_id()));
grant update (name, category, platform, username, estimated_value, currency, notes, metadata)
  on public.digital_assets to authenticated;

create policy folders_insert_own on public.folders
  for insert to authenticated
  with check (
    user_id = (select public.current_user_id())
    and (parent_id is null or exists (
      select 1 from public.folders pf
      where pf.id = folders.parent_id and pf.user_id = (select public.current_user_id()) and pf.deleted_at is null))
  );
create policy folders_update_own on public.folders
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and (parent_id is null or exists (
      select 1 from public.folders pf
      where pf.id = folders.parent_id and pf.user_id = (select public.current_user_id()) and pf.deleted_at is null))
  );
grant insert (user_id, parent_id, name) on public.folders to authenticated;
grant update (name, parent_id, deleted_at) on public.folders to authenticated;

create policy documents_update_own on public.documents
  for update to authenticated
  using (user_id = (select public.current_user_id()) and deleted_at is null)
  with check (
    user_id = (select public.current_user_id())
    and (folder_id is null or exists (
      select 1 from public.folders f
      where f.id = documents.folder_id and f.user_id = (select public.current_user_id()) and f.deleted_at is null))
  );
grant update (name, folder_id, metadata) on public.documents to authenticated;

create policy video_messages_update_own on public.video_messages
  for update to authenticated
  using (user_id = (select public.current_user_id()) and deleted_at is null)
  with check (user_id = (select public.current_user_id()));
grant update (title, description, delivery_condition, metadata) on public.video_messages to authenticated;

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));
grant update (read_at) on public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Protection triggers
-- -----------------------------------------------------------------------------
-- 6a. users identity/authorization columns can never change through a request
--     carrying the authenticated role, even if a grant is ever mis-applied.
create function public.protect_identity_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.current_jwt_role() = 'authenticated' then
    if new.role                   is distinct from old.role
    or new.email                  is distinct from old.email
    or new.email_verified         is distinct from old.email_verified
    or new.mfa_enabled            is distinct from old.mfa_enabled
    or new.name                   is distinct from old.name
    or new.clerk_user_id          is distinct from old.clerk_user_id
    or new.last_login_at          is distinct from old.last_login_at
    or new.deletion_requested_at  is distinct from old.deletion_requested_at
    or new.deleted_at             is distinct from old.deleted_at
    or new.created_at             is distinct from old.created_at
    or new.id                     is distinct from old.id then
      raise exception 'FORBIDDEN' using errcode = '42501',
        detail = 'identity or authorization columns of users are protected';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_identity_columns() from public, anon, authenticated;
create trigger users_protect_identity_columns before update on public.users
  for each row execute function public.protect_identity_columns();

-- 6b. audit_log is append-only for every role.
create function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'FORBIDDEN' using errcode = '42501', detail = 'audit_log is append-only';
end;
$$;
revoke all on function public.audit_log_append_only() from public, anon, authenticated;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();

-- 6c. Class A audit trigger (ADR-004 r4 / data-model § 6): every direct change to a
--     Class A table produces an audit_log row independent of application code.
--     Suppressed only inside guarded functions (definer context + app.audit_in_function).
create function public.audit_class_a_change()
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
      v_loggable := array['date_of_birth','phone','alternate_email','address','family_info','preferences',
                          'notification_preferences','security_preferences','onboarding_completed_at'];
      v_redacted := array['identification_details','role','email','email_verified','mfa_enabled','name',
                          'clerk_user_id','last_login_at','deletion_requested_at','deleted_at'];
    when 'beneficiaries' then
      v_loggable := array['name','relationship','email','phone','notes','status','invited_at','activated_at','deleted_at'];
      v_redacted := '{}';
    when 'financial_assets' then
      v_loggable := array['name','category','institution','estimated_value','currency','notes','metadata','deleted_at'];
      v_redacted := array['account_number','policy_number'];
    when 'physical_assets' then
      v_loggable := array['name','category','description','location','estimated_value','currency','ownership_details','notes','metadata','deleted_at'];
      v_redacted := '{}';
    when 'digital_assets' then
      v_loggable := array['name','category','platform','username','estimated_value','currency','notes','metadata','deleted_at'];
      v_redacted := array['credentials','recovery_info'];
    when 'folders' then
      v_loggable := array['name','parent_id','deleted_at'];
      v_redacted := '{}';
    when 'documents' then
      v_loggable := array['name','folder_id','metadata','scan_status','current_version_id','deleted_at'];
      v_redacted := array['storage_key','encryption_key_id'];
    when 'video_messages' then
      v_loggable := array['title','description','delivery_condition','metadata','scan_status','deleted_at'];
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

create trigger users_audit_class_a after insert or update on public.users
  for each row execute function public.audit_class_a_change();
create trigger beneficiaries_audit_class_a after insert or update on public.beneficiaries
  for each row execute function public.audit_class_a_change();
create trigger financial_assets_audit_class_a after insert or update on public.financial_assets
  for each row execute function public.audit_class_a_change();
create trigger physical_assets_audit_class_a after insert or update on public.physical_assets
  for each row execute function public.audit_class_a_change();
create trigger digital_assets_audit_class_a after insert or update on public.digital_assets
  for each row execute function public.audit_class_a_change();
create trigger folders_audit_class_a after insert or update on public.folders
  for each row execute function public.audit_class_a_change();
create trigger documents_audit_class_a after insert or update on public.documents
  for each row execute function public.audit_class_a_change();
create trigger video_messages_audit_class_a after insert or update on public.video_messages
  for each row execute function public.audit_class_a_change();

-- -----------------------------------------------------------------------------
-- 7. Storage (ADR-005): no client reads; authenticated may only create objects
--    under quarantine/<clerk sub>/ (resumable uploads). Everything else is
--    server-side through signed URLs / promote_upload().
-- -----------------------------------------------------------------------------
create policy quarantine_insert_own_prefix on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'quarantine'
    and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
  );
