-- =============================================================================
-- 0014 — Scheduler status: make the database scheduler observable
--
-- Additive and forward-only: one read-only, service-role-only function. No
-- table, trigger, grant or data change.
--
-- The database scheduler (0010) calls the application through pg_net only when
-- both Vault entries exist; otherwise lv_trigger_scheduler() returns NULL and
-- every cron tick still "succeeds". The GitHub Actions caller keeps the Dead
-- Man's Switch scan fresh either way, so the health check could not tell that
-- the primary scheduler was doing nothing (production, 2026-10-15:
-- legacyvault_cron_secret missing, no pg_net response at all).
--
-- scheduler_status() answers, without any secret value or response body:
--   configured      — both Vault entries exist (names only; values never read)
--   lastSuccessAt   — the newest 2xx response pg_net still holds
--   failedResponses — responses pg_net still holds that timed out, errored or
--                     were not 2xx
-- pg_net keeps responses only for its TTL (hours), so this describes the
-- recent past — the window a health check needs.
--
-- Rollback: drop function public.scheduler_status(); the application treats a
-- missing function as "unknown" and reports the scheduler as degraded.
-- =============================================================================

create function public.scheduler_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'configured', (
      select count(distinct s.name) = 2
        from vault.secrets s
       where s.name in ('legacyvault_app_url', 'legacyvault_cron_secret')),
    'lastSuccessAt', (
      select max(r.created)
        from net._http_response r
       where r.status_code between 200 and 299),
    'failedResponses', (
      select count(*)
        from net._http_response r
       where r.timed_out
          or r.error_msg is not null
          or r.status_code is null
          or r.status_code not between 200 and 299)
  )
$$;

revoke all on function public.scheduler_status() from public, anon, authenticated;
grant execute on function public.scheduler_status() to service_role;
