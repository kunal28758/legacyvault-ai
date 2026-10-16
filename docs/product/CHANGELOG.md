# Changelog — LegacyVault AI

**Purpose**: Project-level change history. Entries are recorded only when
supported by repository history, Spec Kit revision notes, ADR dates, or the
`docs/PROJECT_STATUS.md` change log. This file is the pre-implementation
baseline for the changelog scheduled by task T234.

**Evidence limits**: the repository has **three commits** — `fd11acc`
(2026-09-16), the baseline checkpoint `4cac2d3` (2026-09-18 20:16 +05:30) and
`affa27f` (r4 post-gate remediation). The probe-cleanup entry under
*Unreleased* is uncommitted working-tree state; the r4 entry is contained in
`affa27f`; everything else below is contained in `4cac2d3`. Times are local (+05:30) where known. No
application feature has been implemented; there are **no releases**.

Format: newest first. Categories: *Governance*, *Specification*,
*Architecture*, *Repository*, *Documentation*.

---

## [Unreleased]

### Released 2026-10-16

Production `3a02fcd` (deployment `dpl_2MdiqH72UVYTwjWJPWftjM9Jgw1v`) with
migrations 0012–0014 carries everything below: account deletion (scheduled
and immediate), the Excel/CSV export, the landing redesign and the release
hardening. Evidence: `docs/release-readiness-final.md` § 0. Also: CI sets
`APP_URL` for integration tests (`d22f6b8`); CI is green again.

### Excel and CSV export — 2026-10-16

- Added: Settings → Account → Your data offers an **Excel workbook** (primary),
  **CSV files** (ZIP, one UTF-8 CSV per category plus a README) and the
  existing **JSON** (now labelled advanced). `GET /users/me/export?format=`
  `xlsx|csv|json`; JSON stays the default for API callers.
- The workbook has 26 sheets in a fixed order: About, Profile,
  Beneficiaries, three asset classes, Assignments, Documents, Document
  versions, Document attachments, Folders, Video messages, Will plans, plan
  content, plan history, Dead Man's Switch, Check-in history, Emergency
  contacts, Emergency requests, Access links, AI analyses, AI drafts, AI
  usage, Notifications, Account activity, Deleted items. Names replace ids,
  labels replace enum codes, dates are real date cells, empty categories keep
  their header row.
- Coverage (also in JSON): AI document analyses are decrypted like asset
  secrets; check-in history, Dead Man's Switch contacts, emergency requests,
  access links (never their token or code hashes), attachments, AI usage, and
  deleted rows still inside their retention window. Not exported, by design:
  file contents, identification details (write-only), AI chats (not stored).
- Safety: text is always a text cell in the workbook; CSV text starting with
  `= + - @`, tab or CR is prefixed with `'`. Storage locations, key ids and
  internal ids are never in the spreadsheets; file contents are not included,
  and the About sheet says so. Built with the existing `fflate` dependency (no
  new package).
- Fixed: the export read at most 500 assets of each kind, and every other
  list stopped at PostgREST's 1,000-row page without saying so (activity was
  also capped at 1,000). Every list is now read in pages.
- Changed: `shadcn` moved to `devDependencies` (the app only imports its CSS
  at build time), so `pnpm audit --prod` reports 0. `braces` (GHSA-vfj7-8cjw-p6xm)
  remains in dev tooling with no patched release.
- Added: `tests/e2e/data-export.spec.ts`, a signed-in export journey.
- Added: "Download your data (.xlsx)" in the account-deletion card, so a copy
  can be taken before leaving.
- Added: a solid-surface fallback for glass panels in browsers without
  `backdrop-filter`.

### Account deletion and landing redesign — 2026-10-14

- Fixed (2026-10-15): a job claimed by a run-jobs invocation that then died
  (its 300 s limit, a crash) stayed `RUNNING` for ever. A purge would never
  be retried; a release delivery would be lost. Each run now first takes such
  jobs back: requeued, or `DEAD` once their attempts are spent
  (`recoverAbandoned`, 15-minute lease). Production had none at the time.
- Hardened (2026-10-15): `scripts/backup/backup-verify.sh`.
  - Source checksums are taken just before and just after the dump, so a busy
    database no longer fails a good backup; tables written to during the dump
    are named.
  - Staged `.partial` files mean a failed dump never leaves a file that looks
    complete.
  - Every dump is checked for its completion marker.
  - The restore container has no network and no port.
  - Hardening: `set +x`, `umask 077`, argument and disk checks, signal-safe
    cleanup.
  - 13 tests.
- Release tooling (2026-10-15):
  - `scripts/backup/backup-verify.sh` takes a gpg-encrypted logical backup
    (AES-256, streamed: no plaintext on disk), then restore-tests it in a
    throwaway container. Rehearsed locally: PASS, 28 tables.
  - The preflight has 11 counts, adding migration prerequisites:
    `targets_0013`, `dependencies_0014`, `scheduler_status_present`.
- Dependencies (2026-10-15): scoped pnpm overrides lift
  `@modelcontextprotocol/sdk` to 1.32.1 (GHSA-6qxp-vccf-f47h) and
  `source-map-js` to 1.2.2 (GHSA-68fv-2mgg-jv7q). `braces` GHSA-vfj7-8cjw-p6xm
  stays open: no patched release exists.
- Tests (2026-10-15):
  - `assessHealth()` makes every health transition unit-tested;
  - the workflow's health step is tested against ok, degraded, down, a refused
    call, an empty body and an HTML error page;
  - `.gstack/` is in `.prettierignore`, so `pnpm format:check` exits 0.
- Security (2026-10-15): Next.js 16.3.6 → **16.3.8**, with `@next/env` and
  `eslint-config-next` to match. It fixes published advisories: a high SSRF in
  Image Optimization, cache poisoning and information disclosure.
  `pnpm audit --prod` goes from 8 advisories to 2. The 2 left (`braces` via
  the `shadcn` CLI, the MCP SDK via `@google/genai`) are not reachable at
  runtime.
- Monitoring (2026-10-15): migration 0014 adds `scheduler_status()`.
  - The operator health gains a `scheduler` component, so the GitHub Actions
    fallback can no longer hide a dead database scheduler.
  - The production-jobs workflow fails, and GitHub emails, when health is not
    `ok`.
- Tests (2026-10-15):
  - the Clerk webhook fails closed (500, no side effect) without a signing
    secret;
  - the scheduler-boundary guard now pins exactly two `net`/`vault` paths.
- Privacy (2026-10-15): new audit rows no longer keep personal values.
  - Migration 0013 narrows the Class A trigger to non-personal state; changed
    fields are still listed, values written as `[protected]`.
  - `create_asset`/`delete_asset` no longer record the asset name.
  - `diffForAudit` withholds values outside a non-personal allowlist.
  - Admin actions no longer store the subject's email.
  - Existing rows are untouched; their retention is an open owner decision.
- Fixed (2026-10-15): a notification email queued before an account deletion
  could still be sent to the deleted owner while the purge was pending. It is
  now skipped.
- Monitoring (2026-10-15): the operator health breakdown adds housekeeping
  freshness and counts of dead jobs, failed webhook deliveries and overdue
  purges in the last day. Any of them degrades the public status.
- Fixed (2026-10-15): an account deleted **in Clerk** (Clerk's own *Delete
  account*, reachable from the account menu while the instance allows
  self-deletion, or the Clerk dashboard) was only marked deleted — its Dead
  Man's Switch kept running and could tell trusted contacts a release had
  started, and live access links and emergency requests stayed open. The
  `user.deleted` webhook now goes through `begin_account_deletion()` (0012)
  with `p_purge => false`: everything stops at once, the data is kept until
  the owner decides whether Clerk-side deletions should also erase it.
- Fixed (2026-10-15): webhook idempotency was at-most-once — the delivery id
  was recorded before processing, so a delivery that failed was ignored as a
  duplicate when Clerk or Resend retried it. A failed delivery is now
  forgotten so the retry runs (`processWebhookOnce`).
- **Delete account permanently now** (`POST /api/v1/users/me/delete-now`):
  no grace period. Needs a session, a same-origin request, Clerk `strict_mfa`
  re-verification (both factors within 10 minutes when the account has a
  second factor) and the typed phrase `DELETE PERMANENTLY`. Migration 0012's
  `begin_account_deletion()` closes access in one transaction — marks the
  account deleted (RLS, guarded functions and `requireUser()` all refuse it,
  including sessions issued earlier), revokes access links, stops the Dead
  Man's Switch and emergency access, and queues the hard delete. The route then
  runs the hard delete inline and answers `DELETED` or `CLEANUP_PENDING`; the
  queued `user.hard-delete` job retries until it completes, and a second job
  sweeps objects written later through an already-issued upload URL.
- **Hard delete** (`purgeAccount`, T189): private storage (row keys and the
  owner's prefixes, re-listed to prove nothing remains), then the Clerk user
  (404 = already gone), then the account's documents and the `users` row,
  which cascades to every domain table. `audit_log` is retained (data-model §
  Retention); it can hold values entered in the account, such as names.
- **Scheduled deletion now actually deletes**: housekeeping used to mark an
  account deleted after its 30 days and keep every row, file and the Clerk
  identity. It now calls `begin_account_deletion()` with the deadline, so the
  same hard delete follows. Scheduling and cancelling are compare-and-set: a
  repeat request cannot restart the grace period, and a cancellation that
  loses the race with a deletion that began changes nothing.
- Fixed: `document_versions.uploaded_by` (no ON DELETE action) made any
  account that had uploaded a document impossible to delete by cascade.
- Fixed (review): an `access.deliver` job for an emergency grant approved just
  before deletion minted a new access link and emailed it while cleanup was
  pending — it now skips a deleted owner. The hard delete's document-version
  lookup is chunked (400 documents failed with "URI too long").
- Fixed (release audit): the purge refuses an empty or path-like identifier
  (an empty Clerk id would have listed — and swept — a bucket's root, i.e.
  every account's folder); `security.new-device` no longer records device data
  or alerts for a deleted account; a hard delete whose job ran out of attempts
  is requeued once a day by housekeeping while the account row still exists.
  Read-only release preflight: `scripts/account-deletion/preflight.sql`.
- Settings → Account shows the two options side by side; a scheduled deletion
  shows its exact date. `/account-deleted` explains the outcome truthfully.
- Landing page: static, original hero illustration
  (`public/images/legacy-hero.webp`, 42 KB) replaces the three.js scene —
  `three`, `@react-three/fiber` and `@types/three` removed; quieter surfaces;
  semantic blue/green/purple roles; FAQ; nav anchors work from every page.

### Production rollout — 2026-10-09

- Released `39f7bfc`; migrations 0010 and 0011 applied (0010 first — the
  release reads its column); the 3 duplicate share links revoked under audit;
  SSL enforcement on; a manual production dump taken and restore-tested.
- Free-tier limitations accepted by the owner (no PITR, Clerk development
  instance, no sending-domain authentication, no Sentry DSN) and the one step
  left to the owner (Vault `legacyvault_cron_secret`) are recorded in
  DEPLOYMENT.md § 7f.

### Share-link and access-token hardening — 2026-10-08

- **One live share link per beneficiary** (migration 0011): sharing again
  reuses the beneficiary's live link — no new secret is minted or emailed; a
  link-free notice tells them instead. The database refuses a second
  unrevoked share link (function check + partial unique index), so the
  owner's revoke always ends share access. Previously each share added a live
  link and revoking one left the others working. Existing duplicates must be
  resolved with the audited `scripts/share-links/` cleanup before 0011.
- **Access secrets out of URLs**: links carry the secret in the fragment
  (`/access#t=…`), which never reaches a server, request log, Referer or
  server-rendered page; legacy `?t=` links are redirected to that form before
  rendering; `/access` sends no Referer; Sentry strips query and fragment from
  events, transactions and breadcrumbs.
- **Fixed**: a link requested for exactly the 30-day maximum could be
  refused (`INVALID_EXPIRY`) when the server clock ran slightly ahead of the
  database's, so a share's link went unsent; expiries now keep a 5-minute
  margin.
- **Vault documents reach no AI in production by default**: with
  `AI_DOCUMENT_PROVIDERS` unset, production sends attachments and document
  analyses to no provider (fail closed, "no configured AI provider is
  approved to read vault documents"); the operator must name only providers
  whose account terms allow vault documents. Chat without attachments is
  unaffected. (Production's Gemini key had analysed one document on
  2026-10-04.) A regression test proves a quota or outage at the approved
  provider never moves vault documents to an unapproved fallback.
- **Copy accuracy**: the Security Centre no longer says access links are
  "exchanged once" (they are reusable until expiry or revocation; each visit
  gets a 30-minute session) or calls its controls "guarantees"; the
  invitation and contact-notice emails say LegacyVault *will send* a link
  rather than promising the recipient *will receive* one.
- **Internal cron routes**: regression tests prove every route refuses a
  missing, wrong, truncated or mis-schemed bearer and does no work.
- **Docs**: scheduler (pg_cron + pg_net, ADR-006 r5), email provider (Brevo,
  ADR-009 r2) and the production rollout runbook (DEPLOYMENT.md § 7e) now
  match the code.

### Production hardening — 2026-10-07

- **Scheduler**: pg_cron + pg_net call the protected cron routes from the
  database (run-jobs every 10 min, DMS scan twice an hour, housekeeping
  daily); URL and bearer live in Supabase Vault (migration 0010). The GitHub
  Actions schedule, throttled to every 3–7 h, remains a backup caller.
- **Emergency access**: a timeout AUTO_GRANT requires the owner's alert to be
  confirmed delivered; otherwise it is held (visible to the owner, audited
  once) and re-alerted at most daily. A timeout never grants an expired
  request or an inactive contact. The hourly scan now expires spent emergency
  grants (it asked for an impossible transition before).

### Legacy Execution Engine — 2026-10-07

- **Production gate (closing)**: release is authorized only on a warning the
  provider confirmed *delivered* — SENT, BOUNCED and FAILED never count;
  `notification.confirm` asks Brevo or Resend for the outcome; held releases
  are real state (`release_held_at`, `release_hold_checked_at`), audited once
  per hold and shown on the switch page, Action Centre, Security Centre and
  admin console; every email goes through the verified sender (Brevo); the
  beneficiary portal no longer overflows on phones with long names.

- **Database (migration `0009_legacy_execution.sql`, additive)**: release-link
  verification columns on `access_tokens` (code hash never granted to
  owners); `lv_live_scope()`; `dms_configure` requires the check-in interval
  to be shorter than the inactivity threshold; `dms_check_in` is authoritative
  until release (from `ESCALATING`/`RELEASING` it cancels the release);
  `dms_cancel_escalation` works from `REMINDER_SENT`; `dms_pause` only from
  `ACTIVE`; `dms_transition` queues a contact notice when escalation starts and
  holds release until a warning to the owner was accepted by the email
  provider; `system_issue_access_token` issues the live part of the scope.
  Apply it before deploying.
- **Security (fixed)**: configuring and disabling the switch now require
  step-up verification (the page already said so); pause + resume can no
  longer end an escalation or hide a release; release links open only after a
  one-time code to the contact's own email, for every new session; the portal
  refuses release links whose switch is no longer `RELEASED` and emergency
  links whose request is no longer granted.
- **Safety (fixed)**: turning off check-in reminders or all email no longer
  silences the grace, escalation and release warnings; emergency requests that
  wait for the owner, or were auto-granted by the timeout rule, now notify the
  owner by email; a deleted document or asset no longer breaks the whole
  release; deliveries left over after recovery do nothing.
- **Honesty (fixed)**: the escalation notice said trusted contacts were being
  notified when nothing contacted them — they are now told (no link, nothing
  released); the release email no longer says the owner "became unreachable";
  the "Cancel escalation & recover" button no longer fails in the warning and
  grace stages.
- **UI**: switch page with "If you stop checking in" schedule, plain-language
  state, contact status, scope health and per-contact release status; portal
  code step and "Why you can see this"; dashboard *Emergency plan* card; Action
  Centre released/schedule actions; Security Centre *Live access links*;
  intelligence rule ASSET-REL-001; Copilot grounding with release counts and
  explicit limits (prompt `assistant.v3`, `assistant.attachments.v2`).
- **API**: `GET /api/v1/access-links`; `POST /api/v1/access/exchange` accepts an
  optional `code`.

### Legacy Intelligence, Asset Vault and relationship graph — 2026-10-07

- **Assets (added)**: Asset Vault (`/assets`) and asset pages
  (`/assets/:type/:id`) with status, dates, nominee, instructions, supporting
  documents and activity. The profile lives in the owner-only `metadata`
  column — no new tables. Migration `0008_asset_categories.sql` adds enum
  values only; apply it before deploying.
- **Intelligence (added)**: typed relationship graph and deterministic findings
  (Missing, Expiring, Stale, Conflict RULE-001…010, Unlinked), merged into the
  Action Centre without duplicates, three conditional readiness criteria, a
  dashboard summary, `/intelligence`, palette commands. See
  [LEGACY_INTELLIGENCE.md](LEGACY_INTELLIGENCE.md).
- **Copilot (changed)**: grounded with finding counts per rule — never names;
  labels "Verified from your account", "System detected", "AI suggestion",
  "Your input". Prompt version `assistant.v2`.
- **Hardening (fixed)**: a beneficiary or asset beyond the first loaded page no
  longer makes an asset read as "no beneficiary" (ASSET-BEN-001) or a document
  as "not linked" (DOC-ASSET-001); `/intelligence` says when lists were
  partial. Duplicate findings say "potential" and ask the owner to check. The
  Will readiness criterion counts only conflicts that involve the Will. Asset
  instructions also refuse labelled recovery phrases and raw private keys
  (hex, WIF, `xprv`). The Asset Vault shows assets before intelligence has
  finished loading.

### Malware scanning removed — 2026-10-04

- **Uploads (changed)**: the ClamAV client, the `MALWARE_SCANNER_PROVIDER` /
  `CLAMAV_*` variables, the production start-up requirement for a scanner, the
  scanner status probe and the quarantine stage are gone (ADR-017, superseding
  ADR-015). Uploads go straight to the private `documents` / `videos` bucket;
  the server checks the real size and leading bytes before
  `promote_upload()` adds the file. Promoted rows record `NOT_SCANNED`, and no
  screen claims a file was scanned.
- **Database**: forward migration `0006_remove_malware_scanning.sql` (new
  `VALIDATED` / `NOT_SCANNED` enum values, `promote_upload()` gate, unused
  quarantine write policy dropped, stale scanning sessions closed). No file
  or row deleted.
- **Governance**: constitution 3.0.0 removes the malware-scanning MUST from
  Principle XI; FR-H016 / FR-Q011 are recorded as not met.

### Production-readiness pass — 2026-09-30
- **Upload / malware scanning (fixed)**: uploads no longer hang at "Malware
  scan". `readObjectHead()` reads the ranged response with `arrayBuffer()`
  instead of cancelling a (teed) stream; every step is bounded (head read,
  clamd connect/idle, per-size scan budget); the ClamAV client honours
  back-pressure and `CLAMAV_TLS`; completion claims the session atomically;
  a scanner outage leaves the file in quarantine as retryable instead of
  rejecting or passing it; stale mid-pipeline sessions are reclaimable.
  Accepted types are defined once (`lib/uploads/file-types.ts`), CSV/PPTX
  added (migration `0005_document_types.sql`), HEIC and text are now
  byte-checked. Upload UI: multi-file queue, honest stages, cancel, retry.
- **Create Will**: "Saved" only after server confirmation; failed saves keep
  their edits and retry; unsaved-changes guard; Save & continue; Skip for now
  on optional steps (persisted, shown in stepper/review); server-side draft
  shape validation; step 9 attaches real vault documents; review shows
  release & security settings. Fixed: the old "Save draft" toast claimed
  success before the save.
- **Rate limits**: reads and wizard auto-save have their own budgets (`read`,
  `autosave`); previously ordinary browsing exhausted the shared 100/15 min
  budget and auto-save failed with 429.
- **AI (ADR-008/016 implemented)**: OpenAI + Gemini providers with fallback;
  streaming assistant; document intelligence (summary, extraction, Q&A,
  explanation, text/OCR, translation, comparison) with grounding checks and
  encrypted stored results; usage records without content.
- **System status**: live probes of database, storage, Clerk, ClamAV and AI
  behind a "System online" indicator (breakdown for signed-in users only).
- **Landing**: new procedural 3D vault-shield hero; removed the hero's
  hard-coded "Vault status: protected / Dead Man's Switch · Active" card.
- **Structure**: components grouped by feature; browser API client moved to
  `lib/client/`; every server module marked `server-only`; boundary checks in
  `tests/security/`; debug route and local-rules assistant removed;
  `docs/ARCHITECTURE.md` added.

### Implementation — 2026-09-19 (website batch, college-evaluation sprint)
- Public site: `app/(marketing)` layout + landing (navbar, hero with procedural
  three.js vault and GSAP headline, trust strip, capabilities, how it works,
  feature showcase, security layers, CTA, footer with legal-tech disclaimer).
- Auth: `app/(auth)` layout + themed Clerk `<SignIn/>` / `<SignUp/>` pages with an
  honest “authentication not configured” fallback (no second auth system).
- Authenticated app: `app/(dashboard)` layout (Clerk `auth()` + dynamic
  rendering), `AppShell` (sidebar, mobile sheet, breadcrumbs, notifications,
  theme toggle, `<UserButton/>`), `loading.tsx` / `error.tsx`, and pages for
  dashboard, legacy plan + 11-step wizard, beneficiaries, assets (overview +
  three classes), document vault, video legacy, Dead Man’s Switch, emergency
  access, AI assistant, Security Center, notifications and settings.
- Demo workspace (`lib/demo/*`): deterministic seed, Zustand store in
  sessionStorage mirroring the guarded-function invariants, selectors,
  rule-based assistant. Labelled in the UI; nothing is persisted or sent.
- Reusable components: `components/shared` (page header, stat card, status
  badge, empty/error/loading states, confirm dialog, data table, timeline,
  activity feed, quick action, progress card/ring, security card, page
  transitions, masked field, file upload, AI disclaimer, demo badge),
  `components/wizard` (provider, stepper, step frame, resource picker),
  `components/forms` (form field, beneficiary/asset/assign/upload dialogs),
  `components/data-display` (asset/beneficiary/vault cards, allocation bar,
  asset list view), `components/three` (vault scene + resilient wrapper).
- Validators (Zod, task shapes): `legacy-plan`, `beneficiary`, `asset`.
- Dependencies (constitution IX): `three`, `@react-three/fiber`, `@types/three`
  (procedural 3D per the product direction; lazy-loaded with fallbacks).
- Tests: 8 demo-store invariant tests, 4 rendered-view smoke tests, 3 E2E
  smoke tests (identity + CSP, mobile overflow, fail-closed protected route).
- Task ledger: T040, T041, T045, T047, T049, T050, T062, T063, T164–T169
  complete; page tasks that include API wiring remain open.

### Implementation — 2026-09-19 (Phase 2 database foundation)
- `supabase/migrations/0001_init.sql` (T018): 32 enum types, 28 tables (29
  entities minus the Clerk-externalized Session) with PK/FK/CHECK/unique/partial
  indexes and `updated_at` triggers.
- `supabase/migrations/0002_rls_and_privileges.sql` (T218): privilege baseline
  (`REVOKE ALL` from anon/authenticated + default privileges), RLS on every
  table, SELECT-own policies, Class A insert/update policies with column
  allow-lists (no grant on `identification_details`, `account_number`,
  `policy_number`, `credentials`, `recovery_info`; asset tables UPDATE-only;
  `token_hash`/`otp_hash` never selectable), `protect_identity_columns`,
  append-only `audit_log`, `audit_class_a_change()` triggers, quarantine
  storage policy.
- `supabase/migrations/0003_functions.sql` (T019): 32 guarded `SECURITY
  DEFINER` functions (plan, assignments, attachments, tokens incl.
  `resend_access_token`, `create_asset`/`set_encrypted_fields`/`delete_asset`,
  DMS owner transitions, emergency access, AI drafts), 11 system functions
  (`promote_upload`, `dms_transition` with outbox `access.deliver`,
  `ea_*`, `system_issue_access_token`, `system_reissue_access_token`,
  `system_mark_token_delivered`, `claim_jobs`, `rate_limit_hit`,
  `record_webhook_event`) and internal helpers; error convention 42501 /
  LV409 / LV422.
- Applied on the local Supabase stack; `lib/types/database.ts` generated.

### Implementation — 2026-09-19 (Phase 1 setup batch, commit `556105f`)
- Tasks T001, T002, T003, T005, T006, T007, T008, T009, T010, T011, T012, T013,
  T014, T015, T017, T192, T193, T194 and T202 (initial) implemented; T195,
  T196 and T210 documented in `docs/DEPLOYMENT.md` with every external item
  marked *pending manual verification*. No user story, no Route Handler, no
  database schema.
- Dependencies added (constitution IX — all from the approved stack or its
  tooling): runtime `@clerk/nextjs`, `svix`, `file-type`, `unpdf`, `openai`,
  `@google/genai`, `resend`, `@react-email/components` (npm marks the package
  deprecated — successor to be confirmed at T039), `@sentry/nextjs`, `pino`,
  `server-only`, `framer-motion`, `gsap`, `zustand`, `@tanstack/react-query`,
  `zod`, `react-hook-form`, `@hookform/resolvers`, `@react-pdf/renderer`,
  `tus-js-client`; shadcn/ui runtime `@base-ui/react`, `cn`,
  `class-variance-authority`, `lucide-react`, `next-themes`, `sonner`,
  `tw-animate-css`, `shadcn`; dev `supabase` (CLI), `vitest`,
  `@vitejs/plugin-react`, `jsdom`, `@testing-library/{react,dom,jest-dom}`,
  `@playwright/test`, `@axe-core/playwright`, `@clerk/testing`, `jose`, `tsx`,
  `prettier`, `prettier-plugin-tailwindcss`, `@next/env`, `@types/node@22`.
  `@supabase/ssr` kept until T028. Build scripts allowed only for `supabase`,
  `@sentry/cli`, `esbuild` (`pnpm-workspace.yaml`).
- `next-env.d.ts` un-tracked (T009); generated files ignored.

### Repository — 2026-09-19 (implementation start: probe cleanup, commit `e87cb9a`)
- Removed the temporary Supabase connectivity probe `app/api/db-test/route.ts`
  (and the now-empty `app/api/` directory). The temporary table
  `public.connection_test` was confirmed absent (PostgREST `PGRST205`); no
  DDL was run. Scaffold-era `lib/supabase/{client,server}.ts` and
  `@supabase/ssr` remain until T028 as scheduled by T002. No task is marked
  complete; no application feature exists.

## 2026-09-18 — Commit `affa27f` "docs(spec): complete r4 post-gate remediation"

### Specification / Architecture / Documentation — 2026-09-18 (post-gate remediation, "r4")
- Final read-only specification gate run against `4cac2d3` (0 BLOCKER, 0
  HIGH, 4 MEDIUM, 10 LOW, 10 INFO); the two design findings resolved:
  - **S1** — ADR-004 § 8: application-encrypted columns lose every direct
    grant and are written only through `create_asset()` /
    `set_encrypted_fields()`; `audit_class_a_change()` triggers on the Class A
    tables; `data-model.md` § Write-Protection Model 6, allow-list, catalog;
    T019/T035/T080/T085/T087/T215/T218; security, database and coding docs.
  - **C1** — ADR-014 § 6: access-link delivery policy — `access.deliver` job
    with deterministic per-contact idempotency and reissue-on-retry,
    `AccessToken` delivery/replacement columns and partial unique indexes,
    `resend_access_token()` / `system_reissue_access_token()` /
    `system_mark_token_delivered()`, audited owner and Super Admin resend
    endpoints; T018/T019/T097/T098/T131/T135/T136/T138/T148/T149/T209/T229/
    T235/T236; DMS and beneficiary workflow docs.
- T210 (platform prerequisites) moved from Phase 25 to Phase 1 (ID unchanged);
  `webhook` added to the auth-mode enumerations; VideoMessage write class
  A + B/C; "28 tables (29 entities)" wording; `spec.md` status → *Baseline
  Complete — Implementation Pending*; ADR r3/r4 revision notes; quickstart
  health-check example; documentation paths re-pointed to the existing
  `docs/` topic files. **219 active tasks, 0 complete, 28 retired; 29
  entities = 28 tables.** Still no implementation.

## 2026-09-18 — Checkpoint `4cac2d3` "chore: establish LegacyVault AI baseline"

Commits the state described by every subsection below through 2026-09-17
(54 files changed, +11,152 / −2,621; 73 tracked files): constitution v2.0.1,
ADR-001…016, the Spec Kit artifacts at r3, the `docs/` layer, the Next.js
scaffold and configuration. `.env.local`, `.agents/` and `.agents-backup/`
remain ignored.

### Specification — 2026-09-18 (targeted remediation, "r3")
- Final-analysis findings applied: H1-A (session-scoped, client-held AI
  assistant history; `GET /ai/assistant/interactions`), M1 (`webhook` auth
  mode; CSRF limited to cookie/ambient modes; raw-body signature
  verification), M2 (`delete_asset()`), M3 (`dms.scan` job heartbeat), M4
  (strict video delivery-condition ↔ grant-type mapping), N1 (DIRECT_SHARE
  scope ⊆ beneficiary assignments); two spec Clarifications added; task and
  entity counts unchanged.

### Documentation — 2026-09-18 (documentation organization pass)
- Added the organized documentation layer under `docs/` (index
  `docs/README.md`; `architecture/`, `development/`, `product/`, `security/`,
  `database/`, `integrations/`, `monitoring/`, `ui/`, `workflows/`), each
  file pointing to its canonical Spec Kit source. No Spec Kit artifact, ADR,
  constitution text or application file was modified by this pass.

### Specification / Architecture — 2026-09-18 (post-analysis remediation, "r2")
- `docs/ARCHITECTURE_DECISIONS.md`: ADR-004 revised (write-protection model,
  RLS test strategy); ADR-001 cache-safety rule; new **ADR-014** (unified
  access-token model and cookie exchange), **ADR-015** (production malware
  scanning with ClamAV), **ADR-016** (AI draft persistence and versioning).
- `spec.md`: Clarifications session 2026-09-18 (8 entries) — recipient
  model, per-resource allocation, beneficiary lifecycle, acknowledged
  finalization, idle-timeout preference, emergency-access bootstrap/OTP/
  timeout rules, plan-section scope, upload-only video; related FR wording
  points to the clarifications; API-security exception list corrected.
- `data-model.md` r2: Write-Protection Model; 29 entities (`AccessToken`,
  `DeadManSwitchContact`, `DocumentAttachment`, `AiDraft`,
  `AiDraftVersion`, `ProcessedWebhookEvent` added); guarded-function
  catalog; retention policy.
- `contracts/api-contracts.md` r2: access-cookie exchange endpoints,
  attachments, plan-section access, AI draft resources, emergency-access
  timeout rules, `Cache-Control: private, no-store`.
- `plan.md` r2, `research.md` (Decisions 18–20), `quickstart.md` scenarios.
- `tasks.md` r2: T213–T247 added (mandatory test suites, privileges/RLS
  migration, wizard steps 3–7/11, attachments, access exchange, AI drafts,
  ClamAV, operations, documentation); T036 and T155 moved to Phase 2;
  **219 active tasks, 0 complete**.

### Governance / Specification — 2026-09-18 (consistency cleanup)
- Constitution **2.0.1** (PATCH): Principle IX wording aligned to the
  single-application architecture.
- `research.md` renumbered to a sequential decision list in ADR order;
  duplicate upload row merged in the API contract; metadata dates corrected
  from 2025 to 2026 in `spec.md` and the checklist; checklist link fixed.

### Architecture / Governance — 2026-09-18 (architecture drift resolution, "r1")
- Constitution **2.0.0** (MAJOR, ADR-012): Principle VIII and the Technology
  Stack redefined — single Next.js application replaces the mandated separate
  Express.js backend; Principle III allows delegated authentication (Clerk)
  with authorization retained in the platform's server code; ratification
  date corrected to 2026-09-16.
- `docs/ARCHITECTURE_DECISIONS.md` created with ADR-001 … ADR-013 (single
  Next.js app; Supabase PostgreSQL with SQL migrations; Clerk; service-layer +
  RLS authorization; Supabase Storage two-step uploads; Postgres job table +
  Vercel Cron; rate limiting without Redis; AI provider abstraction; Resend;
  Sentry + structured logging; Vercel deployment; constitution amendment;
  application-layer file encryption deferred).
- `research.md`, `plan.md`, `tasks.md` (T192–T212 added, 28 tasks retired),
  `data-model.md`, `contracts/api-contracts.md`, `quickstart.md` re-baselined
  to the new architecture.
- `BRAIN.md` moved to `docs/BRAIN.md` (constitution XVIII) with a pointer
  stub at the root; `docs/PROJECT_STATUS.md` created.

### Repository — 2026-09-18
- `.gitignore` restored to the tracked entries plus `node_modules/` and
  `.next/` (the 2026-09-17 scaffold had overwritten it). Next.js/tooling
  ignore entries are still missing (task T009).

### Repository — 2026-09-17
- Next.js **16.3.5** application scaffolded at the repository root
  (`create-next-app`: React 19.2.8, TypeScript, Tailwind CSS v4, ESLint,
  pnpm). Supabase packages (`@supabase/supabase-js`, `@supabase/ssr`) added;
  scaffold-era Supabase client files and a temporary `app/api/db-test`
  connectivity probe created; local `.env.local` created (git-ignored). These
  are normalized/replaced by tasks T002 and T028.

## 2026-09-16 — Initial commit `fd11acc` "chore: initialize LegacyVault AI specification"

### Governance / Specification
- Constitution **1.0.0** ratified (22 principles).
- Baseline feature `specs/001-baseline-product-spec/` created: `spec.md`
  (20 user stories, FR groups A–R, NFRs, success criteria, Clarifications
  session 2026-09-16), `plan.md`, `research.md`, `data-model.md`,
  `contracts/api-contracts.md`, `quickstart.md`,
  `checklists/requirements.md`, `tasks.md` (T001–T191; T181–T191 added
  after an initial `/speckit-analyze` run).
- Project brain `BRAIN.md` created.
- Committed contents: `.specify/`, `specs/`, `BRAIN.md`, `.gitignore`.

## 2026-09-15 — Spec Kit initialization
- Spec Kit v1.0.7 initialized with the `agy` integration and PowerShell
  scripts (`.specify/`); `speckit-*` agent skills installed under
  `.agents/skills/` (per `.specify/integrations/*.manifest.json` and
  `.specify/workflows/workflow-registry.json`).

---

*Nothing above constitutes a software release. The first release entry will
be added when a deployable increment exists (see `docs/PROJECT_STATUS.md`).*
