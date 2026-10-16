-- =============================================================================
-- 0012 — Account deletion: one atomic start for both deletion paths
--
-- Additive and forward-only: one new service-role function, no table change.
--
-- An account is deleted in two phases (T189, data-model § Retention):
--
--   1. begin_account_deletion() — this function, one transaction. The account
--      is marked deleted (`users.deleted_at`), which closes every door at once:
--      current_user_id() and lv_require_user() already refuse a deleted row, so
--      RLS and every guarded function stop answering for it, and the
--      application's requireUser() refuses it too. In the same transaction
--      everything that could still act for the account is stopped — live
--      access links revoked, the Dead Man's Switch made INACTIVE, emergency
--      access configs deactivated and undecided requests denied — and the
--      hard delete is queued (`user.hard-delete`). Either all of it happens or
--      none of it does, so an account deleted in the app can never be marked
--      deleted without its cleanup being queued.
--
--   2. The `user.hard-delete` job (lib/jobs/handlers/user-hard-delete.ts):
--      private storage objects, then the Clerk identity, then the `users` row,
--      whose foreign keys cascade to every domain table. Each step is
--      idempotent, so the job is retried until it completes. `audit_log` has no
--      foreign key to `users` and is retained (legally significant).
--
-- Callers:
--   • immediate deletion (POST /api/v1/users/me/delete-now): p_requested_before
--     NULL — no grace period. The route then runs the hard delete inline and
--     reports whether it completed; the queued job is the retry.
--   • scheduled deletion (daily housekeeping): p_requested_before = now − 30
--     days. Only an account whose request is older than that is marked, and a
--     cancellation committed first wins: the row lock serialises the two, and a
--     cancelled account has no `deletion_requested_at` to compare.
--   • deletion outside the app (Clerk `user.deleted` webhook: Clerk's own
--     account page or its dashboard): p_purge false. Access closes exactly as
--     above, but nothing is queued, so the data stays. Whether such a deletion
--     should also erase the data is an open decision
--     (docs/release/ACCOUNT_DELETION_READINESS.md § 6). After an in-app
--     deletion the account is already deleted, so the webhook changes nothing.
--
-- Two jobs are queued. The first is the retry for an inline attempt that did
-- not finish. The second runs after the one-hour lifetime of a signed upload
-- URL (UPLOAD_URL_TTL_SECONDS): a URL minted just before deletion can still
-- write an object under the owner's prefix, and that sweep removes it.
--
-- Returns false, changing nothing, when the account is already deleted or (for
-- the scheduled path) not yet due.
-- =============================================================================

create function public.begin_account_deletion(
  p_user_id uuid,
  p_requested_before timestamptz default null,
  p_corr text default null,
  p_purge boolean default true
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_now      timestamptz := now();
  v_clerk    text;
  v_tokens   integer;
  v_requests integer;
  v_payload  jsonb;
begin
  update public.users
     set deleted_at = v_now,
         deletion_requested_at = coalesce(deletion_requested_at, v_now)
   where id = p_user_id
     and deleted_at is null
     and (p_requested_before is null or deletion_requested_at < p_requested_before)
  returning clerk_user_id into v_clerk;
  if not found then
    return false;
  end if;

  update public.access_tokens
     set revoked_at = v_now, revoked_reason = 'OWNER'
   where owner_user_id = p_user_id and revoked_at is null;
  get diagnostics v_tokens = row_count;

  update public.dead_man_switches
     set status = 'INACTIVE', next_check_in_at = null
   where user_id = p_user_id;

  update public.emergency_access_configs
     set status = 'INACTIVE'
   where user_id = p_user_id and status = 'ACTIVE';

  update public.emergency_access_requests r
     set status = 'DENIED', decided_by = 'SYSTEM', decided_at = v_now
    from public.emergency_access_configs c
   where r.config_id = c.id
     and c.user_id = p_user_id
     and r.status in ('PENDING', 'VERIFYING', 'VERIFIED');
  get diagnostics v_requests = row_count;

  if p_purge then
    v_payload := jsonb_build_object('userId', p_user_id, 'clerkUserId', v_clerk);
    perform public.lv_enqueue_job('user.hard-delete', v_payload,
      'user.hard-delete:' || p_user_id, v_now + interval '5 minutes');
    perform public.lv_enqueue_job('user.hard-delete', v_payload,
      'user.hard-delete:' || p_user_id || ':late-uploads', v_now + interval '65 minutes');
  end if;

  perform public.lv_audit(p_user_id, 'user.deleted', 'users', p_user_id, 'SUCCESS',
    jsonb_build_object(
      'mode', case when not p_purge then 'identity-deleted'
                   when p_requested_before is null then 'immediate' else 'scheduled' end,
      'purgeQueued', p_purge,
      'accessTokensRevoked', v_tokens,
      'emergencyRequestsDenied', v_requests
    ), p_corr);
  return true;
end;
$$;

revoke all on function public.begin_account_deletion(uuid, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.begin_account_deletion(uuid, timestamptz, text, boolean) to service_role;
