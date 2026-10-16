# LegacyVault AI — release readiness (authoritative report)

**Current as of 2026-10-16, ~20:30 UTC.** This is the only readiness report;
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
- `master` at `9fad7df` = `origin/master` (re-fetched 20:2x UTC; unmoved).
  The release is on `release/account-deletion-export`, a fast-forward of
  `master`: `adf5bce` (the release), `7f32c03` (image type declarations for
  CI), `046a052` (report), `bee2ce6` (backup-script JSON fix and tests) and
  this report's update.
- Every file that existed at the start of the work is preserved, checked
  against an archive taken first. `stash@{0}` is untouched and not part of
  the release.

**Production, read-only (2026-10-16):**

| Observed (UTC) | Fact |
|---|---|
| 17:4x | Vercel project `legacyvault-ai-uh7s` only. Latest production deployment `dpl_44gx75eJREseHPs3y58qBTJQiSRh`: a dashboard **redeploy of `9fad7df`** at 16:16 UTC by the owner's account; READY |
| 17:4x | **The duplicate project `legacyvault-ai` no longer exists** (`vercel project ls`; the API returns 404). Its Preview exposure of 25 secrets is gone |
| 17:4x | `uh7s` variables, counts only: 30 Production, 7 Preview/Development (unchanged; owner action 2) |
| 17:4x | Clerk `delete_self = true` (owner action 3 not done at that time) |
| 19:29:37 | **Owner action 3 done.** Clerk `delete_self = false` (public environment), and after the owner's "Apply to existing users": 19 users, `delete_self_enabled` **0 true / 19 false** (Backend API read, counts only) |
| ~19:38 | **Production backup attempt FAILED** (owner's terminal): `FAIL: reading the source checksums (checksums-before.json) failed`. Not a backup: `D:/legacyvault-backups/release-2026-10-17` holds an unverified `schema.sql.gpg` (46,762 bytes) and a 0-byte `checksums-before.json`; kept untouched. Production was only read |
| 17:4x | Migrations: remote 0001–**0011**; local 0012–0014 not applied |
| 17:4x | Vault names: `legacyvault_app_url`, **`legacyvault_cron_secret` (added by the owner)**. `net._http_response`: **13 × 200**, no other status. Cron jobs `run-jobs` `*/10`, `dms-scan` `7,37`, `housekeeping` `17 3`, all active. Last DMS scan 17:07 |
| 17:4x | Jobs `RUNNING`/`QUEUED`/`FAILED`/`DEAD`: none |
| 20:13:42 | **Production backup PASS** (owner's terminal, fixed script): `D:/legacyvault-backups/release-2026-10-17-b`, 28 of 28 public tables exact (899 rows restored), migration 0011 at backup time |
| 20:2x | Backup re-verified independently: `sha256sum -c SHA256SUMS` OK for all 5 listed files; `compare-checksums.mjs` on the stored checksum files PASS 28 of 28; source checksums identical before and after the dump; all three dumps carry the OpenPGP AES-256 header (`8c 0d 04 09`). No passphrase used or seen |
| 20:2x | Identity: Supabase `zlgmthrdoxyfkldeaxyl` linked, ACTIVE_HEALTHY (ap-northeast-1); Vercel `legacyvault-ai-uh7s` → `kunal28758/legacyvault-ai`, production branch `master`. Every server secret is Production-only (names and scopes read only) |
| 20:27:58 | **Preflight** again: migrations exactly 0001–0011 (11 rows); all 11 counts as expected (deletion counts 0, `function_present` 0, `scheduler_status_present` 0, `targets_0013` 3, `dependencies_0014` 2); 0 scheduled and 0 soft-deleted of 13 users; no job outside SUCCEEDED; Clerk `delete_self` false, 0 of 19 per-user flags; `net._http_response` 33 × 200 (latest 20:20) |
| 20:2x | `supabase db push --linked --dry-run`: exactly `0012_account_deletion.sql`, `0013_audit_minimization.sql`, `0014_scheduler_status.sql`; no seeds, no roles |
| 17:53:04 | **Preflight** (11 counts): every deletion count **0**; `function_present` 0, `scheduler_status_present` 0 (expected before 0012/0014); `targets_0013` 3; `dependencies_0014` 2. **All as expected**; time-bound |

**Not verified:**
- an **off-disk** copy of the backup: this machine has one physical disk
  (NVMe, 512 GB); C: and D: are partitions of it, and no removable or
  network drive is attached. The backup folder inherits D:'s permissions
  (Authenticated Users may modify); its files are AES-256 encrypted;
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
| `pnpm test --no-file-parallelism` (re-run at `bee2ce6`) | 0 | **673 passed / 0 failed / 0 skipped**, 66 files |
| `pnpm test:integration --no-file-parallelism` (re-run at `bee2ce6`) | 0 | **239 passed / 0 failed / 1 skipped**, 22 files; the skip is the opt-in scale test, run next |
| `LV_SCALE_TESTS=1 … account-deletion.test.ts -t scale` | 0 | **1 passed**: 1,050 stored objects purged across storage list pages |
| `pnpm build` | 0 | Next.js 16.3.8 |
| client-bundle scan (values from `.env.local`, never printed) | 0 | 15 server-only values × 103 client files: none; no export code in client chunks |
| `pnpm audit --prod` / `pnpm audit` | 0 / 1 | 0 / 1 high (§ 4) |
| local server `:3100` + `playwright test data-export.spec.ts smoke.spec.ts --workers=1` | 0 | **4 passed**: signed-in export (existing `+clerk_test` user, local Supabase) downloads a valid `.xlsx` and CSV ZIP; public smoke 3/3 |
| desktop 1280 px and phone 390 px screenshots of Settings → Your data | — | no horizontal overflow; layout checked by eye |
| clean detached worktree of `adf5bce`: `pnpm install --frozen-lockfile`, `tsc --noEmit` | 0 / 2 | **found a CI break**: the hero's `.webp` import has no type without the git-ignored `next-env.d.ts`. Fixed in `7f32c03` (`images.d.ts`) |
| same worktree with the fix: typecheck, lint, `prettier --check --end-of-line auto`, `pnpm build` (no `.env.local`), `pnpm test` | 0 each | pass; **653/653**. Plain `format:check` flags every file there only because a Windows worktree checks out CRLF |
| local server `:3100`, anonymous: delete-now, `DELETE /users/me`, export, cron | — | 401 each; `/api/v1/health` and `/account-deleted` 200 |
| migration static check (0012–0014) | — | no top-level `update`/`insert`/`delete`/`drop`/`alter table`: they only define or replace functions and set grants, so applying them changes no data |
| production read-only queries, preflight, backup verification, dry run | — | § 1 |

## 4. Test totals, build and audit

- **Totals (at `bee2ce6`):** unit + security **673/673**; integration
  **239 + scale 1**, 0 failed; E2E **4/4** (1 signed-in, 3 public); build
  **pass**.
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

**Status (2026-10-16):** the first production run **failed** on a CLI
output-format bug, since fixed and rehearsed in terminal and agent mode (§ 6).
No production backup has passed yet (owner action 4).

## 6. Remaining blockers

**Engineering: none.** Gate status for this release:

| Gate | Status |
|---|---|
| Action 1 — duplicate project | **resolved**: the project was deleted |
| Action 2 — `uh7s` Preview/Development scopes | open. **Not a release gate any more**: those 7 entries are public `NEXT_PUBLIC_*` values (Preview) and Development-only Brevo keys; pushes to `master` build Production only. Hygiene |
| Action 3 — Clerk `delete_self` | **done** (19:29 UTC): instance `false`, and 0 of 19 existing users keep the per-user flag |
| Decisions R1, R3, R4 | open; their documented defaults ("keep until decided") are safe, so they do not block |
| Clerk isolation | open. Authenticated testing is done with existing `+clerk_test` users against the local database |
| **Action 4 — production backup** | **done**: PASS at 20:13:42 UTC (28 of 28, 899 rows), independently re-verified (§ 1). The first attempt had failed on a script bug, fixed in `bee2ce6` (below) |
| Backup off-disk copy | **not available**: one physical disk (§ 1). The backup protects against a faulty migration or release, not against losing this disk |
| Action 7 — Vault scheduler secret | **done** (33 × 200 at 20:27) |

**The failed backup (2026-10-16, cause confirmed).** The script read
`supabase db query` output as agent-style JSON (`{ rows: [...] }`). The CLI
picks its format by detecting an AI agent: in a normal terminal it prints a
text table, and with `--output-format json` a bare array. Neither was seen
before: the 2026-10-15 rehearsal ran inside an AI agent session, where the
real CLI detected the agent and printed agent-style JSON, and the unit tests
used a stand-in CLI that only printed that same shape. Both queries (source
checksums and migration version) were affected.

**Fix (`bee2ce6`):** both queries request
`--output-format json` and go through `scripts/backup/query-value.mjs`, which
accepts either JSON shape and refuses text, malformed, empty or multi-row
output with a reason that never quotes the output. Verified:
- `tests/unit/backup-verify-script.test.ts`: **33 passed** (20 new: both
  shapes end to end, text table, malformed JSON, no output, an empty checksum
  set, the migration-version failure, the parser cases, no output quoted);
- the **old** script against a terminal-like stand-in CLI fails exactly as in
  production; the fixed one does not;
- **local rehearsal in terminal mode** (agent variables cleared, so the CLI
  prints tables as in the owner's terminal), new empty folder
  `D:/legacyvault-backups/rehearsal-2026-10-17-terminal-mode`: **PASS, 28 of
  28 public tables exact (31,980 rows)**, migration 0014;
- local rehearsal in agent mode (`…-agent-mode`): **PASS, 28 of 28**.
Rehearsal files are encrypted with a random passphrase that was never kept,
so they cannot be read; the owner may delete both folders.

## 7. Owner actions (ordered by risk and dependency)

### Required before migrations

3. ~~**Clerk Dashboard**: turn off self-deletion~~ **done 2026-10-16**
   (User & authentication → User model → User permissions → "Allow users to
   delete their account" off, then "Apply to existing users").
   - Re-verify any time:
     `curl -s https://needed-turkey-5633.clerk.accounts.dev/v1/environment | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).user_settings.actions.delete_self))"`
     must print `false`.
4. ~~**Backup**~~ **done 2026-10-16 20:13:42 UTC (PASS)**. For a future
   backup: the fixed script, in your own terminal (it refuses to run without
   one), into a **new, empty** folder (never the failed `release-2026-10-17`
   one):
   `bash scripts/backup/backup-verify.sh "D:/legacyvault-backups/release-2026-10-17-b" --production`.
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

1. **Gates:** action 3 verified `false` (done); backup **PASS** (done,
   20:13:42 UTC; same physical disk only).

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

## 9. Verdict: **ALL RELEASE GATES PASSED — migrations not yet applied**

Engineering is complete and verified at `bee2ce6` (§ 3). Every gate in § 6
is met: the production backup passed and was re-verified, Clerk self-deletion
is off for the instance and every user, and the read-only preflight and dry
run at 20:27 UTC match expectations exactly.

The one limitation: the backup exists only on this machine's single physical
disk. Nothing beyond read-only production queries has been done; migrations
0012–0014 and the release (§ 8 steps 3–7) are next.
