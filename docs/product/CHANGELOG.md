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
