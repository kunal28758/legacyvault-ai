# LegacyVault AI — release readiness (authoritative report)

**Current as of 2026-10-16, ~18:30 UTC.** This is the only readiness report;
earlier passes are superseded. The only rollout procedure is
`docs/DEPLOYMENT.md` § 7d-2; the checklist is § 8 below.

Labels:
- **verified now**: run in this pass, with evidence;
- **production, read-only**: observed at the stated time;
- **historical**: an earlier result, not re-run;
- **not verified**;
- **owner action**.

## 1. Current state

**Repository** (verified now):
- `master` at `9fad7df` = `origin/master`. The release is committed on a
  local branch only (`release/account-deletion-export`); nothing is pushed.
- Every file that existed at the start of the work is preserved, checked
  against an archive taken first. `stash@{0}` is untouched and not part of
  the release.

**Production, read-only (2026-10-16):**

| Observed (UTC) | Fact |
|---|---|
| 17:4x | Vercel project `legacyvault-ai-uh7s` only. Latest production deployment `dpl_44gx75eJREseHPs3y58qBTJQiSRh`: a dashboard **redeploy of `9fad7df`** at 16:16 UTC by the owner's account; READY |
| 17:4x | **The duplicate project `legacyvault-ai` no longer exists** (`vercel project ls`; the API returns 404). Its Preview exposure of 25 secrets is gone |
| 17:4x | `uh7s` variables, counts only: 30 Production, 7 Preview/Development (unchanged; owner action 2) |
| 17:4x | Clerk `delete_self = true` (owner action 3 not done) |
| 17:4x | Migrations: remote 0001–**0011**; local 0012–0014 not applied |
| 17:4x | Vault names: `legacyvault_app_url`, **`legacyvault_cron_secret` (added by the owner)**. `net._http_response`: **13 × 200**, no other status. Cron jobs `run-jobs` `*/10`, `dms-scan` `7,37`, `housekeeping` `17 3`, all active. Last DMS scan 17:07 |
| 17:4x | Jobs `RUNNING`/`QUEUED`/`FAILED`/`DEAD`: none |
| 17:53:04 | **Preflight** (11 counts): every deletion count **0**; `function_present` 0, `scheduler_status_present` 0 (expected before 0012/0014); `targets_0013` 3; `dependencies_0014` 2. **All as expected**; time-bound |

**Not verified:**
- a production backup (none has been run; § 6);
- live Clerk deletion (never tested against a real account, by design);
- opening the export files in Microsoft Excel, Numbers or Google Sheets
  (openpyxl and Chromium downloads only);
- GitHub notification delivery.

## 2. Release contents

One commit on `release/account-deletion-export`, reviewed file by file:

- **Account deletion** (2026-10-14/15): migrations 0012–0014; delete-now and
  scheduled deletion; `user.hard-delete` job; Clerk webhook hardening;
  notification suppression; audit minimization; `/account-deleted`.
- **Operations** (2026-10-15): health signals and `assessHealth`;
  `recoverAbandoned`; workflow alert step; 11-count preflight; hardened
  backup script; Next.js 16.3.8 and scoped overrides.
- **Landing redesign** (2026-10-14): the Three.js scene replaced by a static
  hero image.
- **Export** (2026-10-16): Excel and CSV ZIP besides JSON; see below.

**Export, this pass (verified now):**
- Coverage now matches the schema. New: AI document analyses (decrypted, like
  asset secrets), AI usage, Dead Man's Switch contacts and check-in history,
  emergency requests, access links, document attachments, and a Deleted items
  sheet for rows still inside their retention window. 26 sheets.
- **Fixed:** every list is read in pages. PostgREST returns at most 1,000 rows
  per request, so notifications, activity and other long lists were cut off
  silently; activity was also capped at 1,000. Child reads send ids in chunks.
- Still excluded, and stated in the file: file contents;
  `identification_details` (write-only, no read path exists); access-link
  token hashes, verification codes and emergency OTP hashes (no column grant);
  AI chats (never stored); will-plan version snapshots (JSON only; each
  finalized plan's content is in the workbook).
- UI: per-format descriptions are announced with each button
  (`aria-describedby`); subtle hover on the format tiles; copy updated.
- Dependency: `shadcn` moved to `devDependencies` (§ 4).

## 3. Commands run in this pass (all verified now, on the final tree)

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | pass |
| `pnpm lint` | 0 | pass, 0 warnings |
| `pnpm format:check` | 0 | all matched files pass |
| `pnpm test --no-file-parallelism` | 0 | **653 passed / 0 failed / 0 skipped**, 66 files |
| `pnpm test:integration --no-file-parallelism` | 0 | **239 passed / 0 failed / 1 skipped**, 22 files; the skip is the opt-in scale test |
| `LV_SCALE_TESTS=1 … account-deletion.test.ts -t scale` | 0 | **1 passed**: 1,050 stored objects purged across storage list pages |
| `pnpm build` | 0 | Next.js 16.3.8 |
| client-bundle scan (values from `.env.local`, never printed) | 0 | 15 server-only values × 103 client files: none; no export code in client chunks |
| `pnpm audit --prod` / `pnpm audit` | 0 / 1 | 0 / 1 high (§ 4) |
| local server `:3100` + `playwright test data-export.spec.ts smoke.spec.ts --workers=1` | 0 | **4 passed**: signed-in export (existing `+clerk_test` user, local Supabase) downloads a valid `.xlsx` and CSV ZIP; public smoke 3/3 |
| desktop 1280 px and phone 390 px screenshots of Settings → Your data | — | no horizontal overflow; layout checked by eye |
| production read-only queries and preflight | — | § 1 |

## 4. Test totals, build and audit

- **Totals:** unit + security **653/653**; integration **239 + scale 1**, 0
  failed; E2E **4/4** (1 signed-in, 3 public); build **pass**.
- **Audit:** `pnpm audit --prod` **0**. `pnpm audit` **1 high**: `braces`
  3.0.3, GHSA-vfj7-8cjw-p6xm (stack exhaustion on deeply nested patterns).
  - **No fix exists:** patched is ≥ 3.0.4 and npm's latest is 3.0.3, so an
    override cannot be applied.
  - **Paths:** `shadcn` → `fast-glob` → `micromatch` → `braces` (and via
    `ts-morph`), and `eslint-config-next` → `@next/eslint-plugin-next` →
    `fast-glob`.
  - **Change:** `shadcn` is a CLI; the app only imports its CSS at build time
    (`@import "shadcn/tailwind.css"`). It moved to `devDependencies`. Vercel
    already installs dev dependencies (Tailwind is one), and the build passes.
    The lockfile change is that move only.
  - **Residual risk:** low; dev tooling only, never fed untrusted patterns.
    Recheck when `braces` 3.0.4 ships.

## 5. Migration and backup review conclusions (historical, 2026-10-15)

### Migrations

- **Order and dependencies:** 0012 → 0013 → 0014 in one `db push`, before the
  application release.
  - 0012 creates `begin_account_deletion`, which the new application needs.
  - 0013 and 0014 are independent and safe under either application version.
  - The runner applies one transaction per file and stops at the first
    failure (verified earlier today with a failing probe).
- **Account deletion is safe on three counts:**
  - **Authorization:** the account comes from the session, never from input;
    the step-up check and typed phrase are server-enforced; the function is
    service_role only.
  - **Race-safe and idempotent:** a compare-and-set on `deleted_at` means one
    `user.deleted` audit under concurrency.
  - **Contained to the owner:** the purge refuses unsafe identifiers and
    accounts that are not deleted, and a bystander's rows and objects are
    untouched (integration tests).
- **Partial failure:** storage, then Clerk, then rows; every step retries.
  The account is reported complete only when all are done. Stalled purges
  show in health and are requeued daily; jobs left `RUNNING` are now
  recovered too.
- **Audit minimization:** `create or replace` of three function bodies;
  signatures and grants unchanged; the existing rows are untouched
  (append-only).
- **`scheduler_status()`:** SECURITY DEFINER, owner `postgres`,
  `search_path = ''`, service_role only. It reads Vault entry *names* only
  (never `decrypted_secrets`) and pg_net status codes only, never response
  bodies. If it errors, the app reports the scheduler as unknown, i.e.
  degraded.
- **Preflight:** one definition per count, 11 counts, labels identical in the
  SQL, the guard test, `DEPLOYMENT.md` § 7d-2 step 1 and the readiness record.

### Backup (`scripts/backup/backup-verify.sh`)

The review found and fixed:

1. **A busy production database would always FAIL the restore check.** The
   checksums were taken after the dumps, in another transaction. They now
   bracket the `public` dump.
2. **A failed dump could leave a file that looked complete.** Files are now
   staged as `.partial` and renamed only on success.
3. **The full data dump was never checked.** Completion markers are now
   verified.
4. **The restore container had a published port and network access.** Now
   `--network none` and no port.
5. **Smaller gaps:** xtrace, file permissions, extra arguments, disk space,
   signal cleanup, and silent CLI errors (the Supabase CLI prints errors to
   stdout).

What it does not back up:
- stored file contents;
- Clerk identities;
- Vault and external secrets;
- platform configuration.

Platform schemas restore only into a real Supabase project.

**Status:** safe to run; **not run against production** (owner action 4).

## 6. Remaining blockers

**Engineering: none.** Gate status for this release:

| Gate | Status |
|---|---|
| Action 1 — duplicate project | **resolved**: the project was deleted |
| Action 2 — `uh7s` Preview/Development scopes | open. **Not a release gate any more**: those 7 entries are public `NEXT_PUBLIC_*` values (Preview) and Development-only Brevo keys; pushes to `master` build Production only. Hygiene |
| Action 3 — Clerk `delete_self` | **open; required before release.** While it is on, a person can delete themselves in Clerk's own UI, which skips the purge and leaves their data behind (no Clerk webhook is configured) |
| Decisions R1, R3, R4 | open; their documented defaults ("keep until decided") are safe, so they do not block |
| Clerk isolation | open. Authenticated testing is done with existing `+clerk_test` users against the local database |
| **Action 4 — production backup** | **open; the blocking gate.** Migrations may not run without a verified backup, and the app may not be released before the migrations |
| Action 7 — Vault scheduler secret | **done** (13 × 200) |

## 7. Owner actions (ordered by risk and dependency)

### Required before migrations

3. **Clerk Dashboard**, application of `needed-turkey-5633`: turn off the
   users' ability to delete their own account.
   - Verify:
     `curl -s https://needed-turkey-5633.clerk.accounts.dev/v1/environment | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).user_settings.actions.delete_self))"`
     must print `false`.
4. **Backup**, in your own terminal (it refuses to run without one):
   `bash scripts/backup/backup-verify.sh "<empty, owner-only folder outside the repo, not cloud-synced>" --production`.
   Type a new passphrase when asked and keep it in a password manager. It
   must end in **PASS**.
   - It backs up the database only: **not** stored files, Clerk identities,
     Vault or other secrets, or platform configuration. Account deletion
     only removes data when someone deletes their account, and the
     preflight shows no account is due, so no stored file is at risk at
     release.

### Hygiene (not release gates)

2. **Vercel → `legacyvault-ai-uh7s` → Settings → Environment Variables:**
   remove the Development `BREVO_API_KEY` and `BREVO_EMAIL_FROM`, untick
   Preview on the four public `NEXT_PUBLIC_*` rows and remove the
   Preview-only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` row. Expected count
   `30/0`.
8. **Optional:** the Clerk webhook (`DEPLOYMENT.md` § 7d-2 step 7), only
   after action 3.

### Decisions (recommendations in `docs/release/DATA_RETENTION_DECISIONS.md`)

- **R1:** existing audit values. Recommended: audited redaction; until
  decided, keep.
- **R3:** IP and user agent. Recommended: 90 days.
- **R4:** the audit log as a whole. Recommended: keep until advised.
- **Clerk isolation:** a separate free Clerk application for testing remains
  recommended.

### External verification

9. **Alert delivery:** confirm a failed workflow run's email arrives (GitHub →
   Settings → Notifications → Actions).

## 8. Production release checklist (stop at any failed condition)

1. **Gates:** action 3 verified `false`; backup **PASS** (action 4).

   **STOP** if the backup prints FAIL, or names a table you need in its
   "changed while the backup ran" note (re-run at a quiet time).
2. **Preflight**, immediately before step 3:
   `cat supabase/.temp/project-ref` must print `zlgmthrdoxyfkldeaxyl`; then
   `pnpm exec supabase db query --linked -f scripts/account-deletion/preflight.sql`.

   **STOP** unless:
   - `purged_on_first_sweep`, `files_on_first_sweep`, `unsafe_clerk_ids`,
     `existing_hard_delete_jobs`, `function_present` and
     `scheduler_status_present` are all 0, and
   - `targets_0013` = 3 and `dependencies_0014` = 2.

   A non-zero deletion count needs **written** approval of exactly those
   permanent deletions.
3. **Dry run:** `pnpm exec supabase db push --linked --dry-run`.

   **STOP** unless it lists exactly `0012_account_deletion.sql`,
   `0013_audit_minimization.sql`, `0014_scheduler_status.sql`.
4. **Apply:** `pnpm exec supabase db push --linked`.
   - Then re-run the preflight: `function_present` 1,
     `scheduler_status_present` 1, `targets_0013` 3.
   - Then the privilege query in `DEPLOYMENT.md` § 7d-2 step 4.

   **STOP** on any difference. A partial push resumes cleanly; never use
   `migration repair`.
5. **Release:** fast-forward `master` to the release commit and push it.
   - The new deployment must be READY in
     `npx --yes vercel ls legacyvault-ai-uh7s`, with that commit.
   - `/`, `/account-deleted` and `/api/v1/health` must answer 200; protected
     APIs must answer 401 anonymously; `scheduler.configured: true` in the
     operator health.

   Rollback: Vercel → Deployments → the `9fad7df` deployment → Instant
   Rollback (compatible with 0012–0014).

   **Export check:** signed in with a test account (never delete the owner's
   account as a test), Settings → Account → Your data: download the Excel
   workbook and the CSV ZIP. The workbook must open in Excel (or Numbers /
   Google Sheets) without a repair prompt, and the ZIP must hold
   `README.txt` plus 26 CSVs. Delete both files afterwards: they contain
   decrypted values.
6. **Scheduler and CI:** 200s keep arriving in `net._http_response`; the
   next `production-jobs` workflow run is green.
7. **Watch for 24 h:**
   - operator health `failures` all 0, `housekeeping` and `scheduler` fresh;
   - Vercel runtime logs: no new 5xx;
   - `select type, status, count(*) from jobs where type = 'user.hard-delete' group by 1, 2;`
   - **Any purge is irreversible.**

## 9. Verdict: **READY FOR OWNER APPROVAL — blocked on the production backup**

Engineering is complete and verified on the final tree (§ 3): every check,
the build, a signed-in export journey and the public smoke pass, and the
release is committed locally for review.

It is **not** released. Before migrations: action 3 and a backup **PASS**
(action 4), which only the owner can run. Then the checklist in § 8.
Nothing beyond read-only production queries was done here.
