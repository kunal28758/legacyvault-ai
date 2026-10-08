-- =============================================================================
-- 0010 — Reliable production scheduler + emergency auto-grant gate
--
-- Additive and forward-only.
--
-- 1. Scheduler. The application's time-based work (job runner, Dead Man's
--    Switch scan, daily housekeeping) has always been driven by calls to the
--    protected `/api/internal/cron/*` routes. On the Vercel Hobby plan those
--    calls came from a GitHub Actions schedule, which GitHub throttles to
--    every 3–7 hours. pg_cron + pg_net now make the same calls from the
--    database itself (ADR-006 / T211 named this as the redundancy trigger):
--
--      legacyvault-run-jobs      every 10 minutes   → run-jobs
--      legacyvault-dms-scan      :07 and :37        → dms-scan (queues the
--                                                     hourly scan; its key is
--                                                     per hour, so a second
--                                                     call is a no-op)
--      legacyvault-housekeeping  03:17 daily         → housekeeping
--
--    All times are UTC: pg_cron evaluates schedules in `cron.timezone`, GMT
--    by default on Supabase. The routes themselves are time-zone agnostic.
--
--    Nothing about the job engine changes: the routes still authenticate with
--    the CRON_SECRET bearer (constant-time), claim_jobs() still locks with
--    SKIP LOCKED, every job is still idempotent, and the GitHub workflow can
--    keep running as a harmless extra caller. The base URL and the secret are
--    read from Supabase Vault at call time (`legacyvault_app_url`,
--    `legacyvault_cron_secret`); neither is in this file or the repository.
--    Without both secrets — local development, CI — the trigger does nothing.
--
-- 2. Emergency access. A timeout rule set to AUTO_GRANT used to grant access
--    once the owner had not answered in time, whether or not the owner had
--    ever been told. It now requires the owner's `ea.request_pending` alert
--    for that request to be DELIVERED (provider-confirmed, with a provider
--    message id) — the same evidence rule as the release gate (0009). Until
--    then the request stays VERIFIED (the owner can still approve or deny),
--    `auto_grant_held_at` records when the hold began (one audit row), and the
--    request simply expires if the alert is never delivered. An automatic
--    grant is also refused once the request has expired or the contact is no
--    longer active (removed, or the beneficiary deactivated), whatever order
--    the daily sweep checks them in. DENY timeouts and owner decisions are
--    unchanged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Scheduler trigger
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Calls one of the three scheduler routes. Only the cron owner runs it.
create or replace function public.lv_trigger_scheduler(p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base   text;
  v_secret text;
begin
  if p_path not in ('/api/internal/cron/run-jobs', '/api/internal/cron/dms-scan',
                    '/api/internal/cron/housekeeping') then
    raise exception 'unknown scheduler route';
  end if;
  select ds.decrypted_secret into v_base
    from vault.decrypted_secrets ds where ds.name = 'legacyvault_app_url';
  select ds.decrypted_secret into v_secret
    from vault.decrypted_secrets ds where ds.name = 'legacyvault_cron_secret';
  if v_base is null or v_secret is null then
    return null;  -- not configured in this environment: nothing to call
  end if;
  -- Asynchronous: the request is queued and pg_net records the response.
  return net.http_post(
    url := rtrim(v_base, '/') || p_path,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret,
                                  'Content-Type', 'application/json'),
    timeout_milliseconds := 300000  -- the run-jobs route may take up to its maxDuration
  );
end;
$$;

revoke all on function public.lv_trigger_scheduler(text) from public, anon, authenticated, service_role;

-- cron.schedule() updates a job with the same name, so this is re-runnable.
select cron.schedule('legacyvault-run-jobs', '*/10 * * * *',
  $$select public.lv_trigger_scheduler('/api/internal/cron/run-jobs')$$);
select cron.schedule('legacyvault-dms-scan', '7,37 * * * *',
  $$select public.lv_trigger_scheduler('/api/internal/cron/dms-scan')$$);
select cron.schedule('legacyvault-housekeeping', '17 3 * * *',
  $$select public.lv_trigger_scheduler('/api/internal/cron/housekeeping')$$);

-- -----------------------------------------------------------------------------
-- 2. Emergency auto-grant gate
-- -----------------------------------------------------------------------------
alter table public.emergency_access_requests
  add column if not exists auto_grant_held_at timestamptz;

-- The owner may see that an automatic grant is on hold (not the OTP hash).
grant select (auto_grant_held_at) on public.emergency_access_requests to authenticated;

create or replace function public.ea_transition(p_request_id uuid, p_to public.ea_request_status, p_metadata jsonb default '{}'::jsonb)
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
    -- A timeout never outlives the request, or the contact: the expiry sweep
    -- and the owner's removal win even when the timeout rule is checked first.
    if v_req.request_expires_at <= now() then perform public.lv_raise_409('REQUEST_EXPIRED'); end if;
    if v_cfg.deleted_at is not null or v_cfg.status <> 'ACTIVE' or not exists (
      select 1 from public.beneficiaries b
       where b.id = v_cfg.beneficiary_id and b.deleted_at is null and b.status <> 'INACTIVE') then
      perform public.lv_raise_409('CONTACT_NOT_ACTIVE');
    end if;
    -- Never grant on silence the owner may not have heard: the owner's alert
    -- for this request must be DELIVERED. Otherwise hold — the request stays
    -- VERIFIED for the owner to decide, or expires.
    if not exists (
      select 1 from public.notifications n
       where n.user_id = v_cfg.user_id
         and n.type = 'ea.request_pending'
         and n.metadata ->> 'requestId' = p_request_id::text
         and n.delivery_status = 'DELIVERED'
         and n.provider_message_id is not null) then
      if v_req.auto_grant_held_at is null then
        update public.emergency_access_requests set auto_grant_held_at = now() where id = p_request_id;
        perform public.lv_audit(null, 'ea.auto_grant_held', 'emergency_access_request', p_request_id, 'DENIED',
          jsonb_build_object('ownerUserId', v_cfg.user_id, 'reason', 'OWNER_ALERT_NOT_DELIVERED'), null);
      end if;
      return v_req.status;
    end if;
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
    jsonb_build_object('from', v_req.status, 'to', p_to, 'ownerUserId', v_cfg.user_id,
                       'autoGrantHeldSince', v_req.auto_grant_held_at) || coalesce(p_metadata, '{}'::jsonb), null);
  return p_to;
end;
$$;

revoke all on function public.ea_transition(uuid, public.ea_request_status, jsonb) from public, anon, authenticated;
grant execute on function public.ea_transition(uuid, public.ea_request_status, jsonb) to service_role;
