-- =============================================================================
-- Account deletion (migration 0012) — READ-ONLY pre-release check
--
-- Run by an authorised operator against production BEFORE applying 0012 and
-- releasing the application (docs/DEPLOYMENT.md § 7d-2), from the repository
-- root, after checking that `supabase/.temp/project-ref` is the production ref:
--
--   pnpm exec supabase db query --linked -f scripts/account-deletion/preflight.sql
--
-- One SELECT of aggregate counts; changes nothing (the CLI also refuses a file
-- with more than one statement). Prints eleven integers, never personal data.
-- Record them in docs/release/ACCOUNT_DELETION_READINESS.md § 3: until it has
-- been run, the number of accounts the first sweep will hard-delete is NOT
-- KNOWN. tests/unit/preflight-sql.test.ts keeps it a single read-only query.
-- =============================================================================
select
  -- Hard-deleted (rows, files, Clerk user) by the FIRST housekeeping run after
  -- the release: scheduled more than 30 days ago, never marked deleted.
  count(*) filter (
    where deletion_requested_at < now() - interval '30 days' and deleted_at is null
  ) as purged_on_first_sweep,
  -- Stored files removed with those accounts. A database dump does not hold
  -- file contents, so these cannot be restored after the sweep.
  (select count(*) from storage.objects o
    where o.bucket_id in ('documents', 'videos', 'quarantine')
      and split_part(o.name, '/', 1) in (
        select k from public.users u,
          lateral (values (u.id::text), (u.clerk_user_id)) as v(k)
         where u.deletion_requested_at < now() - interval '30 days'
           and u.deleted_at is null)) as files_on_first_sweep,
  -- Hard-deleted later, each when its 30 days end (what the owner asked for).
  count(*) filter (
    where deletion_requested_at >= now() - interval '30 days' and deleted_at is null
  ) as purged_when_due,
  -- Soft-deleted by an earlier release's sweep: blocked, data KEPT, not swept.
  count(*) filter (
    where deleted_at is not null and deletion_requested_at is not null
  ) as soft_deleted_by_old_sweep,
  -- Deleted another way (Clerk dashboard → user.deleted webhook): blocked,
  -- data KEPT, not swept. Needs a product decision.
  count(*) filter (
    where deleted_at is not null and deletion_requested_at is null
  ) as soft_deleted_other_paths,
  -- Identifiers the purge refuses as unsafe storage prefixes (expected 0).
  count(*) filter (
    where clerk_user_id !~ '^[A-Za-z0-9_-]{8,}$'
  ) as unsafe_clerk_ids,
  -- Hard-delete jobs that already exist (expected 0 before 0012).
  (select count(*) from public.jobs where type = 'user.hard-delete') as existing_hard_delete_jobs,
  -- 1 once 0012 is applied, 0 before.
  (select count(*) from pg_proc where proname = 'begin_account_deletion') as function_present,
  -- 0013 replaces exactly these three functions with CREATE OR REPLACE; a
  -- missing one or an extra overload would make it add a function instead of
  -- replacing one. Expected 3.
  (select count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('audit_class_a_change', 'create_asset', 'delete_asset')) as targets_0013,
  -- 0014's scheduler_status() reads these two catalogs (pg_net, Vault).
  -- Expected 2.
  (select count(*) from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname || '.' || c.relname in ('net._http_response', 'vault.secrets')) as dependencies_0014,
  -- 1 once 0014 is applied, 0 before.
  (select count(*) from pg_proc where proname = 'scheduler_status') as scheduler_status_present
from public.users;
