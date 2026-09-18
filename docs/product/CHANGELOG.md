# Changelog — LegacyVault AI

**Purpose**: Project-level change history. Entries are recorded only when
supported by repository history, Spec Kit revision notes, ADR dates, or the
`docs/PROJECT_STATUS.md` change log. This file is the pre-implementation
baseline for the changelog scheduled by task T234.

**Evidence limits**: the repository has a **single commit** (`fd11acc`,
2026-09-16); everything after it is uncommitted working-tree state described
by artifact revision notes and file metadata. Times are local (+05:30) where
known. No application feature has been implemented; there are **no releases**.

Format: newest first. Categories: *Governance*, *Specification*,
*Architecture*, *Repository*, *Documentation*.

---

## [Unreleased]

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
