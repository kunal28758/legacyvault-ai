# Project Status — LegacyVault AI

**Snapshot date**: 2026-09-18
**Phase**: 0 — Foundation (governance complete; implementation not started)
**Constitution**: v2.0.1 (amended 2026-09-18) · **Architecture**: ADR-001 … ADR-016 (ADR-004 r4, ADR-014 r4) · **Git checkpoint**: `4cac2d3`

> This file records what is *actually true* about the repository right now.
> It complements `docs/BRAIN.md` (context) and `docs/ARCHITECTURE_DECISIONS.md`
> (decisions). Update it at every phase checkpoint (task T180).

---

## 1. One-line summary

The architecture drift between the 2026-09-16 specification (Express/Prisma/
S3/Redis two-project plan) and the 2026-09-17 root-level Next.js 16 scaffold
has been **formally resolved** in favour of a single Next.js application with
Clerk, Supabase PostgreSQL/Storage, a Postgres job table + Vercel Cron, and
OpenAI/Gemini behind an abstraction. **No application feature has been
implemented.** Implementation (`/speckit-implement`) has not started.

---

## 2. What exists

| Area | State | Evidence |
|------|-------|----------|
| Governance | ✅ Constitution v2.0.1; ADR log (016 records); project brain | `.specify/memory/constitution.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/BRAIN.md` |
| Specification | ✅ Complete and consistent with the ADRs; `/speckit-analyze` findings remediated 2026-09-18 r2 (write-protection model, unified access tokens, attachments, AI drafts, webhook idempotency, clarifications session 2026-09-18); targeted remediation r3 (H1-A, M1–M4, N1) and post-gate r4 (S1 sensitive-field boundary, C1 delivery policy) applied | `specs/001-baseline-product-spec/{spec,research,plan,tasks,data-model,quickstart}.md`, `contracts/api-contracts.md` |
| Task list | ✅ 219 active tasks, **0 complete**; 28 retired IDs listed; r1 added T192–T212, r2 added T213–T247 (incl. the constitution-XVII test suites); r4 moved T210 to Phase 1 (IDs unchanged) | `tasks.md` |
| Documentation layer | ✅ Organized explainer docs (documentation only — no code): index + architecture, development, product, security, database, integrations, monitoring, ui, workflows; each defers to its canonical Spec Kit source | `docs/README.md`, `docs/**` |
| Next.js scaffold | 🔧 Present, unmodified template | `app/layout.tsx`, `app/page.tsx` (template), `app/globals.css`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs` |
| Supabase wiring | 🔧 Packages installed; scaffold-era clients remain until T028; **temporary connectivity probe removed 2026-09-19** (`public.connection_test` confirmed absent via PostgREST `PGRST205`) | `package.json` (`@supabase/ssr`, `@supabase/supabase-js`), `lib/supabase/{client,server}.ts` (no importers) |
| Environment | 🔧 `.env.local` with Supabase URL + publishable key (gitignored; values not recorded anywhere else) | — |
| Agent skills | ✅ 70 skills in `.agents/skills` (+ speckit backup) | `.agents/`, `.agents-backup/` |
| Clerk | ⬜ Not installed, not configured | — |
| Database schema / RLS / functions | ⬜ None (`supabase/` directory does not exist) | — |
| API `/api/v1` | ⬜ None (no Route Handlers exist; `app/api/` removed with the probe) | — |
| Jobs / cron / webhooks | ⬜ None | — |
| Storage buckets / policies | ⬜ None | — |
| AI, email, Sentry, logging | ⬜ None | — |
| Tests / CI / deployment | ⬜ None | — |

---

## 3. Git state

- Branch: `master` (environment reports the intended main branch as `main` —
  owner decision pending; the plan expects a `001-baseline-product-spec`
  feature branch for implementation).
- Commits: 2 — `fd11acc chore: initialize LegacyVault AI specification`
  (2026-09-16: `.specify/`, `specs/`, root `BRAIN.md`, `.gitignore`) and
  **`4cac2d3 chore: establish LegacyVault AI baseline`** (2026-09-18 20:16
  +05:30; 54 files changed; 73 tracked files: constitution v2.0.1, ADR-001…016,
  Spec Kit artifacts through r3, the `docs/` layer, the Next.js scaffold and
  configs, `README.md`, `AGENTS.md`, `CLAUDE.md`). `.agents/`,
  `.agents-backup/` and `.env.local` are ignored and not tracked.
- Working tree at the checkpoint: **clean** (final read-only gate ran against
  `4cac2d3`). The r4 remediation described in § 7 was committed as
  **`affa27f docs(spec): complete r4 post-gate remediation`**. The probe
  cleanup of 2026-09-19 (§ 7) is the only uncommitted change at the time of
  writing.

### ⚠️ Repository hygiene items (tracked as T009)

1. `create-next-app` overwrote `.gitignore` on 2026-09-17; on 2026-09-18
   (00:32) it was restored to the tracked version plus `node_modules/` and
   `.next/`. As of 01:10 the file ignores `.agents/`, `.agents-backup/`,
   `.env`, `.env.*`, `!.env.example`, `node_modules/`, `.next/` — verified
   with `git check-ignore`. **Still missing** the Next.js/tooling entries
   (`next-env.d.ts`, `*.tsbuildinfo`, `coverage/`, `/out/`, `.vercel`,
   `*.pem`, `*.log`). `next-env.d.ts` is **tracked** since `4cac2d3`; T009
   completes the file and must also `git rm --cached next-env.d.ts`.
2. `.env.local` **is** ignored (`.env.*` rule) — verified. It must never be
   committed; its values are not copied into any document.

---

## 4. Architecture at a glance (decided, not built)

| Concern | Baseline decision | ADR |
|---------|-------------------|-----|
| App | Next.js 16 + TS, App Router, Route Handlers for `/api/v1`, services layer | 001 |
| Auth | Clerk only (sessions, MFA, lockout, reverification, webhooks) | 003 |
| Authorization | Service-layer checks + RLS keyed on Clerk subject | 004 |
| Database | PostgreSQL on Supabase; SQL migrations; no ORM; transactional SQL functions | 002 |
| Storage | Supabase Storage private buckets; quarantine → validate/scan → promote; signed URLs; 50 MB / 500 MB | 005 |
| Jobs | Postgres `jobs` table + Vercel Cron (+ `pg_cron` redundancy); no Redis/BullMQ | 006 |
| Rate limiting | Clerk + Vercel WAF + Postgres limiter | 007 |
| AI | OpenAI + Gemini behind `AIProvider`; structured outputs; confirmation gates | 008 |
| Email | Abstraction; Resend + React Email | 009 |
| Monitoring | Sentry, pino JSON logs + correlation ids, health checks | 010 |
| Deployment | Vercel + Supabase + Clerk; GitHub Actions; gated migrations; backups + PITR | 011 |
| Deferred | App-layer envelope encryption of file bodies | 013 |
| Write protection | Privilege baseline + column allow-lists + guarded `SECURITY DEFINER` functions | 004 r2 |
| External access | Beneficiary = every recipient; one `access_tokens` entity; token exchanged once for an httpOnly cookie | 014 |
| Malware scanning | ClamAV in production; `noop` refused at start-up | 015 |
| AI drafts | `ai_drafts` + encrypted versions; sanitized `ai_interactions` | 016 |

---

## 5. Open items requiring an owner decision or verification

| # | Item | Why it matters | Where tracked |
|---|------|----------------|---------------|
| 1 | Default branch (`master` vs `main`) and creating the feature branch | CI/deploy configuration; plan references | this file |
| 2 | Vercel plan tier | Minute-level cron and `maxDuration` are required for the job runner / DMS scan (ADR-006) | T210 (Phase 1 since r4), T202 |
| 3 | Supabase plan tier | ≥ 500 MB file-size limit (videos) and PITR (production) | T196, T210 (Phase 1 since r4) |
| 4 | Clerk event coverage for FR-A014 (failed sign-in attempts) | Determines whether a custom sign-in capture endpoint is needed | T203 |
| 5 | Clerk/Supabase/Resend/Sentry accounts and dev instances | Blocks Phase 0 completion | T195, T196, T202 |
| 6 | `ADMIN_EMAIL` for the first Super Admin | Seed script | T033 |
| 7 | **ClamAV hosting** (container platform such as Fly.io/Render/Railway, or a VM in the Supabase region) | Production malware scanning is mandatory (FR-H016); the app refuses to start in production without it | ADR-015, T247, T210 |
| 8 | **Audit-log retention schedule** (legal/compliance) | Baseline keeps audit rows indefinitely; a formal schedule needs a legal decision | data-model § Retention, T245 |
| 9 | Clerk plan features (inactivity timeout, session-token customization, reverification) | FR-A008 / FR-A018 depend on them | T195, T210 |

---

## 6. Next steps (in order)

1. Commit the r4 remediation (this working tree) as one focused commit on top
   of `4cac2d3`.
2. Owner confirms items 1–3 above.
3. Create the feature branch; begin Phase 1 (Setup) tasks — including T009
   (`.gitignore`, un-track `next-env.d.ts`) and T210 (platform prerequisites)
   — **only after** explicit go-ahead for `/speckit-implement`. Phase 2 must
   not start before T210 is recorded.

---

## 7. Change log for this file

| Date | Change |
|------|--------|
| 2026-09-18 | Created. Architecture drift resolved (ADR-001…013, constitution 2.0.0); spec artifacts re-baselined; no implementation. |
| 2026-09-18 | Final document-only consistency cleanup: constitution 2.0.1 (Principle IX wording), research renumbered 1–17 in ADR order, duplicate upload row merged in API contracts, 2025→2026 metadata dates in spec/checklist, checklist path fixed. Still no implementation. |
| 2026-09-18 r2 | `/speckit-analyze` remediation: ADR-004 r2 (write-protection model), ADR-014 (unified access tokens + cookie exchange), ADR-015 (ClamAV), ADR-016 (AI drafts); data-model r2 (29 entities, function catalog, retention); API contracts r2; spec Clarifications session 2026-09-18 (8 entries); plan r2; tasks r2 (T213–T247, T036/T155 moved to Phase 2); research Decisions 18–20; quickstart scenarios 4.1/5.1/7.1/7.2/12.3. Still no implementation. |
| 2026-09-18 (docs pass) | Documentation organization pass: `docs/README.md` index and topic explainers created; BRAIN § 11 and this file updated minimally; no Spec Kit artifact, ADR, constitution text or application file changed. Still no implementation. |
| 2026-09-18 r3 | Targeted remediation of the final-analysis findings H1-A (session-scoped client-held assistant history, `GET /ai/assistant/interactions`), M1 (`webhook` auth mode, CSRF scope), M2 (`delete_asset()`), M3 (`dms.scan` job heartbeat), M4 (strict video delivery-condition mapping), N1 (DIRECT_SHARE scope ⊆ assignments); 219/0/28 tasks and 29 entities unchanged. Still no implementation. |
| 2026-09-18 | **Baseline committed as `4cac2d3`** (`chore: establish LegacyVault AI baseline`). Final read-only specification gate on the checkpoint: 0 BLOCKER, 0 HIGH, 4 MEDIUM (S1 direct-write boundary, C1 access-link delivery, T210 ordering, stale status docs), 10 LOW, 10 INFO. |
| 2026-09-18 r4 | Post-gate remediation (committed as `affa27f`): ADR-004 § 8 sensitive-field boundary + `audit_class_a_change()` triggers (`create_asset()`, `set_encrypted_fields()`); ADR-014 § 6 access-link delivery policy (`access.deliver`, reissue-on-retry, `resend_access_token()`, audited owner/admin resend); T210 moved to Phase 1; `webhook` added to auth-mode enumerations; VideoMessage class A + B/C; 28-table wording; spec status; ADR r3/r4 revision notes; quickstart health example; documentation paths (T175/T178/T234, plan Documentation Plan); this file, BRAIN and CHANGELOG refreshed for `4cac2d3`. Still no implementation. |
| 2026-09-19 | **Implementation start — probe cleanup only**: deleted the temporary connectivity probe `app/api/db-test/route.ts` (and the now-empty `app/api/`); `public.connection_test` confirmed absent (PostgREST `PGRST205`), nothing to drop. `lib/supabase/{client,server}.ts` and `@supabase/ssr` deliberately left for T028 per T002. No task marked complete; no feature implemented. |
