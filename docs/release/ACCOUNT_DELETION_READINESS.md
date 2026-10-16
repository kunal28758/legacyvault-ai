# Account deletion — release readiness (2026-10-14, updated 2026-10-15)

Final release decision and consolidated actions: `docs/release-readiness-final.md`.

**Status:** the one current verdict lives in `docs/release-readiness-final.md`;
this file holds the feature evidence. Uncommitted on `master` (HEAD
`9fad7df`); nothing committed, pushed, deployed or applied to production.
Release steps: `docs/DEPLOYMENT.md` § 7d-2.

## 1. Behaviour verified locally (source + tests)

| Requirement | Where | Evidence |
|---|---|---|
| Typed `DELETE PERMANENTLY`, strict body (no account id accepted) | `lib/validators/user.validators.ts`, `app/api/v1/users/me/delete-now/route.ts` | `tests/unit/account-deletion-routes.test.ts` (wrong/missing phrase, forged `userId`/`mfaVerified`/`confirmed` → 422) |
| Server-side step-up: Clerk `strict_mfa` (both factors ≤ 10 min when a second factor exists) | `route.ts:21` → `lib/api/with-api.ts` `assertReverification` | route test: 403 `REVERIFICATION_REQUIRED` with level `multi_factor`; only `strict_mfa` accepted |
| Session required, same-origin, `sensitive` rate limit (5 / 15 min) | `route.ts:20`, `with-api.ts` | route tests: 401, cross-site 403, sixth attempt 429 |
| No grace period; separate from scheduling | `lib/services/account.service.ts:311` | integration "introduces no grace period" (deleted_at = now; jobs run in minutes, never 30 days); route test (scheduled path never called) |
| Access closed at once, incl. older sessions | `supabase/migrations/0012_account_deletion.sql`, `lib/auth/ensure-app-user.ts:189`, `app/(dashboard)/layout.tsx:37` | integration "refuses a session issued before the deletion" (requireUser 401); RLS + guarded function refused |
| Atomic start; links, Dead Man's Switch, emergency access stopped | `0012` `begin_account_deletion()` (SECURITY INVOKER, `search_path=""`, service_role only — checked in the local catalog) | integration "no grace period", "emergency grant", "not callable by the account itself" |
| Purge order: storage → Clerk → documents → user row (cascade); audit kept | `account.service.ts:357` | integration "closes access at once…", "retry finishes a failed purge", "already-deleted Clerk identity" |
| Never purges an active account or an unsafe identifier | `account.service.ts:365`, row check after it | integration "never marked deleted", "empty or path-like identifier" |
| Large accounts | chunked version lookup `account.service.ts`, paginated storage listing | 400 documents; opt-in 1,050-object test (`LV_SCALE_TESTS=1`) passed once |
| Late uploads (signed URL ≤ 1 h) | second job at +65 min | integration "sweeps an object written after the purge" |
| Idempotent / concurrent / retried | `0012` CAS on `deleted_at`, idempotent purge steps | integration "concurrent requests" (one `user.deleted` audit row), "retry" |
| Stalled purges not abandoned | `lib/jobs/handlers/housekeeping.ts:289` (one fresh job a day while the row exists) | integration "requeues a hard delete that ran out of attempts" |
| No new grants or device records for a deleted owner | `lib/jobs/handlers/access-deliver.ts:54`, `security-new-device.ts:94` | integration tests; both fail with the guards removed |
| Scheduled 30 days → same hard delete; cancel only while scheduled | `housekeeping.ts:260`, `lib/repositories/user.repository.ts:133` | integration "scheduled deletion and cancellation" (4 tests, incl. both race orders) |
| Deletion made in Clerk (`user.deleted` webhook): access closed the same way, data kept, replay and forged deliveries refused | `app/api/webhooks/clerk/route.ts` → `begin_account_deletion(p_purge => false)` | integration "deletion made in Clerk" (3 tests; signed with a secret generated per run); fails with the old `deleted_at`-only code (DMS stayed `ACTIVE`) |
| A webhook delivery that fails is retried, not dropped as a duplicate | `lib/repositories/webhook.repository.ts` (Clerk and email webhooks) | `tests/unit/webhook-once.test.ts` |
| UI: two separate options, exact date, phrase gate, truthful outcome | `settings-view.tsx`, `app/(marketing)/account-deleted/page.tsx` | `tests/unit/settings-account-deletion.test.tsx` (jsdom only) |

## 2. Test results

**Current: 2026-10-15, ~10:20–11:10 UTC, final code (Next.js 16.3.8).** Commands
and exit codes: `docs/release-readiness-final.md` § 3.

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | all exit 0 |
| `pnpm test --no-file-parallelism` | **615/615** (63 files) |
| `pnpm test:integration --no-file-parallelism` | **237 passed, 1 skipped** (the opt-in 1,050-object scale test), 21 files |
| `pnpm build` | pass |
| client-bundle secret scan | none of 16 server-only values in 123 client files |
| local runtime smoke, public E2E smoke | pass; 3/3 |
| release sequence on a disposable stack: 0011 → preflight → `migration up` 0012–0014 → preflight | as documented. The catalog equals the main local DB (16 categories, 1,623 items) |
| `scripts/backup/backup-verify.sh` rehearsal (local data) | PASS: 28 of 28 tables exact |

**Historical, 2026-10-15:**
- One serial run under machine load failed only the `app-views` dashboard
  render test (5 s timeout). An interleaved A/B showed the same on the
  committed `HEAD`, so it is load-sensitive and not caused by this work. It
  has passed in every run since.
- Before the `.prettierignore` fix, `format:check` exited 1 on `.gstack/`
  only.

**Not run:** signed-in E2E journeys, live Clerk deletion, signed-in browser QA
of Settings → Account (§ 4).

## 3. Migration 0012 — release risk

The first housekeeping run after the release behaves as described in
`DEPLOYMENT.md` § 7d-2 ("What the first housekeeping run does"). How to read
each count, and when to stop, is in § 7d-2 step 1.

`scripts/account-deletion/preflight.sql` is one aggregate `SELECT`, proved
read-only before each production run:
- `tests/unit/preflight-sql.test.ts` passes 4/4 (it failed on 6 of 6
  mutations when strengthened);
- the file is one statement;
- it runs inside a read-only session (local).

The counts change whenever someone schedules a deletion, so **re-run it
immediately before the migrations**.

A dump restores **database rows only**. It holds no stored file contents and
cannot bring back a deleted Clerk user, so a hard delete of a
`purged_on_first_sweep` account is final.

Production results, counts only (the query prints no personal data):

| Run (UTC) | purged_on_first_sweep | files_on_first_sweep | purged_when_due | soft_deleted (old / other) | unsafe_clerk_ids | existing_hard_delete_jobs | function_present | targets_0013 | dependencies_0014 | scheduler_status_present |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-15T09:38:15Z (current file, 11 counts) | 0 | 0 | 0 | 0 / 0 | 0 | 0 | 0 | 3 | 2 | 0 |
| 2026-10-15T06:57:52Z (earlier 8-count file) | 0 | 0 | 0 | 0 / 0 | 0 | 0 | 0 | — | — | — |
| _immediately before the migrations_ | expect 0 | expect 0 | any | any | expect 0 | expect 0 | expect 0 | expect 3 | expect 2 | expect 0 |

## 4. Clerk and browser verification

- A new Supabase project is out of scope (owner constraint). Isolated
  authenticated testing therefore needs a separate free **Clerk** application
  used with the existing local Supabase (`DEPLOYMENT.md` § 7g option D). That
  is an owner decision (`docs/release-readiness-final.md` § 7); until it is
  made, the live checks below stay open.
- The webhook itself is verified locally with synthetic, locally signed
  deliveries (§ 1).
- The shared instance allows Clerk's own *Delete account*
  (`delete_self=true`, public environment, 2026-10-15) — `DEPLOYMENT.md` § 5
  row 16.
- Local `.env.local` points Supabase at `127.0.0.1` (isolated) but Clerk at
  `needed-turkey-5633` — the **same development instance production uses**.
  Every user created, signed in or deleted there is a user of production's
  identity store (production has no `CLERK_WEBHOOK_SIGNING_SECRET`, so
  webhook deliveries are not processed there today — `DEPLOYMENT.md` § 5
  row 9). So:
  - Clerk deletion is verified only with a **mocked** Clerk client, plus the
    SDK contract read from `@clerk/backend` 3.18.1 (`deleteUser` →
    `DELETE /users/{id}`; failures throw `ClerkAPIResponseError` with the HTTP
    `status`; 404 is treated as done, everything else is retried).
  - Settings → Account was **not** exercised in a signed-in browser.
- **Prerequisite to close this** (owner decision D1 in
  `docs/release-readiness-final.md`):
  - (a) a separate free Clerk application, used with the **existing local
    Supabase** (`DEPLOYMENT.md` § 7g option D; no new Supabase project), proven
    with `pnpm staging:check` → PASS, then the § 7g browser checks; or
  - (b) written risk acceptance.

  As of 2026-10-15 the check fails on the local configuration (shared Clerk
  instance, no webhook secret). On re-check at 2026-10-15 ~05:16 UTC, the
  production Vercel project's server secrets were Production-only. The second
  project `legacyvault-ai`, which scoped all 25 of its variables Production +
  Preview, was deleted by the owner on 2026-10-16.

## 5. Audit log and personal data (decision required — unresolved)

Decisions, production counts and recommended defaults:
`docs/release/DATA_RETENTION_DECISIONS.md`.

**New rows: minimised on 2026-10-15** (uncommitted, local only; production
needs migration 0013):
- **Class A trigger rows** list the changed fields but write personal values
  as `[protected]`. Only non-personal state keeps its values.
- **`create_asset` / `delete_asset`** no longer record the asset name.
- **Application diffs** (`diffForAudit`: `beneficiary.updated`,
  `user.profile_updated`) withhold every value outside a non-personal
  allowlist.
- **Admin actions** no longer store `subjectEmail`.

Still recorded on purpose:
- `auth.device_seen` (browser, device type, country). New-device detection
  compares against it.
- IP address and user agent of refused or failed requests, which are security
  evidence.

Tests: `beneficiaries.test.ts`, `assets.test.ts`, `api-foundation.test.ts`.
Each fails with the old behaviour put back. **Existing rows are unchanged**; the
options below now concern them and how long they are kept.

`audit_log` is append-only and kept indefinitely (`data-model.md` §
Retention). After a hard delete it still holds, for that account:

- **Class A trigger rows** (`<table>.row_created` / `row_changed`,
  `supabase/migrations/0002_rls_and_privileges.sql`): values of — users:
  date of birth, phone, alternate email, address, family info, preferences;
  beneficiaries: name, relationship, email, phone, notes; assets: name,
  institution, location, platform, username, values, notes, metadata;
  folders/documents: names, metadata; videos: title, description. (Encrypted
  columns and storage keys are recorded only as `[encrypted]`/`[protected]`.)
- **Function audits:** `create_asset` / `delete_asset` record the asset name.
- **Application audits:** `auth.device_seen` (browser, device type, country);
  admin actions record `subjectEmail`; denied/failed requests record
  `ip_address` and `user_agent`.

Essential for investigations: action, resource type/id, outcome, actor id and
role, correlation id, timestamps (arguably IP/user agent for a limited time).
Not essential after erasure: the free-text values above.

Options (none implemented): A — keep (current policy); B — stop recording
values of personal columns in new rows (record changed keys only); C —
crypto-shredding: encrypt those values with a per-account key destroyed at
purge (append-only preserved); D — redact on purge through an audited,
narrowly-scoped exception to the append-only trigger; E — a time-limited
retention schedule for IP/user agent. Recommended for review: B for new rows,
plus C or D for existing rows — an owner/legal decision.

## 6. Other open decisions and known limits

- **Accounts deleted before 0012 or in Clerk** keep their data and are never
  swept (counts in the preflight). Since 2026-10-15 a Clerk-side deletion
  closes access exactly like the app's (links revoked, Dead Man's Switch and
  emergency access stopped), but still keeps the data; such a user also
  cannot sign up again with the same email (`users.email` is unique). Product
  decision: leave, purge Clerk-side deletions too (pass `p_purge => true` in
  the webhook), or a reviewed one-time purge — and turn Clerk self-deletion
  off either way (`DEPLOYMENT.md` § 5 row 16).
- Signed download URLs already issued stay valid until the object is removed
  (≤ 15 min, `DOWNLOAD_URL_TTL_SECONDS`); normally removed within the request.
- While a purge is pending, queued notification emails can still reach the
  owner's own address (`notification-deliver.ts`); no third party is emailed.
- `jobs` rows keep `userId` and `clerkUserId` (job pruning, T245, is not
  implemented).
- No metrics/alerting exist beyond logs and the admin dashboard's DEAD-job
  count; a stalled purge is visible there and retried daily.
