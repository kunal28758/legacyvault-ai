# LegacyVault AI — Documentation Map

**Purpose**: Entry point and index for all project documentation. It tells you
where each topic's **canonical source** lives so that no topic has two
competing definitions.

**As of**: 2026-09-18 — the project is in Phase 0 (governance and
specification complete; **no application feature is implemented**; the
repository contains a Next.js 16 scaffold only). See
[`PROJECT_STATUS.md`](./PROJECT_STATUS.md).

---

## Read in this order

1. [`../.specify/memory/constitution.md`](../.specify/memory/constitution.md) — engineering constitution **v2.0.1** (supreme governance document)
2. [`ARCHITECTURE_DECISIONS.md`](./ARCHITECTURE_DECISIONS.md) — ADR-001 … ADR-016 (authoritative for architecture)
3. [`BRAIN.md`](./BRAIN.md) — project brain: identity, scope, architecture summary, decisions, risks, agent rules (root `../BRAIN.md` is a pointer stub to this file)
4. [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) — what actually exists today, open owner decisions
5. The Spec Kit feature directory `../specs/001-baseline-product-spec/` — see *Canonical sources* below

## Canonical sources (authoritative — never duplicated in `docs/`)

| Topic | Canonical file |
|---|---|
| Requirements, user stories, acceptance criteria, edge cases, success criteria, clarifications | `specs/001-baseline-product-spec/spec.md` |
| Implementation plan, phases, project structure, constitution check | `specs/001-baseline-product-spec/plan.md` |
| Implementation tasks (T001–T247; 219 active, 0 complete) | `specs/001-baseline-product-spec/tasks.md` |
| Entities, fields, state machines, write-protection model, function catalog, retention | `specs/001-baseline-product-spec/data-model.md` |
| API contracts (`/api/v1`, access-cookie endpoints, internal endpoints) | `specs/001-baseline-product-spec/contracts/api-contracts.md` |
| Technology decisions with rationale and superseded history | `specs/001-baseline-product-spec/research.md` |
| End-to-end validation scenarios | `specs/001-baseline-product-spec/quickstart.md` |
| Specification quality checklist | `specs/001-baseline-product-spec/checklists/requirements.md` |
| Architecture decisions (ADRs) | `docs/ARCHITECTURE_DECISIONS.md` |
| Engineering principles | `.specify/memory/constitution.md` |

The documents under the topic folders below **explain and organize** these
sources. When a `docs/` file and a canonical source disagree, the canonical
source wins and the `docs/` file must be corrected.

## Topic documentation (`docs/`)

| Folder / file | Purpose | Status legend used inside |
|---|---|---|
| `architecture/SYSTEM_ARCHITECTURE.md` | How the single Next.js application is put together: layers, request pipeline, background processing, platform boundaries | 📐 specified / 📋 planned / ✅ implemented |
| `ARCHITECTURE_DECISIONS.md` *(kept at `docs/` root — see path note)* | ADR log | — |
| `development/CODING_STANDARDS.md` | Code conventions derived from the constitution and plan | — |
| `development/DEVELOPMENT_RULES.md` | How work is done: Spec-Driven Development gates, agent rules, definition of done | — |
| `development/ENVIRONMENT_MATRIX.md` | Environments × services × configuration categories (names only, never values) | — |
| `product/CHANGELOG.md` | Project change history supported by repository/artifact evidence | — |
| `product/REQUIREMENTS_TRACEABILITY.md` | Requirement groups → design docs → tasks → tests (pointer matrix, not a second spec) | — |
| `PROJECT_STATUS.md` *(kept at `docs/` root — see path note)* | Implementation state snapshot | — |
| `security/SECURITY_ARCHITECTURE.md` | Security controls by layer, each labelled specified / planned / implemented | 📐 / 📋 / ✅ |
| `security/THREAT_MODEL.md` | Assets, actors, trust boundaries, threats → specified controls | 📐 / 📋 |
| `security/ENCRYPTION.md` | What is encrypted, how, where keys live, rotation | 📐 / 📋 |
| `database/DATABASE_ARCHITECTURE.md` | Database platform, migrations, clients, write classes, transactions, RLS, storage (pointers into `data-model.md`) | 📐 / 📋 |
| `database/DATABASE_SCHEMA.md` | The schema as applied: tables, enums, write classes, guarded and system functions, error convention, storage buckets (T242) | ✅ |
| `integrations/INTEGRATIONS.md` | External services (Clerk, Supabase, Resend, Sentry, OpenAI/Gemini, Vercel, ClamAV): role, adapter, configuration names, failure behaviour | 📐 / 📋 |
| `monitoring/OBSERVABILITY.md` | Logging, correlation ids, error monitoring, health checks, metrics, alerts | 📐 / 📋 |
| `ui/DESIGN_SYSTEM.md` | Established UI/UX direction (dark-first, glassmorphism, motion, accessibility) | 📐 / 📋 |
| `workflows/WILL_WORKFLOW.md` | Legacy plan creation, auto-save, review, finalization, versioning | 📐 |
| `workflows/BENEFICIARY_WORKFLOW.md` | Beneficiary lifecycle, assignments, allocation rule, scoped access | 📐 |
| `workflows/DEAD_MAN_SWITCH_WORKFLOW.md` | Dead Man Switch configuration, check-ins, escalation, release, recovery | 📐 |

**Status legend**: ✅ Implemented (code exists and is verified) · 📐 Specified
(defined in an authoritative artifact) · 📋 Planned (a task exists) · ⬜ Not
started. As of 2026-09-18 **nothing is ✅**.

## Path notes (target organization vs. actual layout)

- `ARCHITECTURE_DECISIONS.md` and `PROJECT_STATUS.md` remain at the `docs/`
  root: the constitution (Principle VIII), the plan, the task list, the
  research file and the ADRs themselves reference these exact paths, and the
  Spec Kit artifacts are protected from modification. Moving them would break
  those references.
- `BRAIN.md` lives at `docs/BRAIN.md` (constitution XVIII); the root
  `BRAIN.md` is a pointer stub. This arrangement is preserved.
- Spec Kit files keep their Spec Kit layout: the API contract is
  `contracts/api-contracts.md` and the checklist is
  `checklists/requirements.md` inside the feature directory.
- There are **no** `frontend/` or `backend/` directories: the baseline is one
  Next.js application (ADR-001, constitution VIII). Creating those folders
  would contradict the established architecture.

## Documents planned by the implementation plan (not yet written)

`plan.md` § Documentation Plan and `tasks.md` schedule these for specific
phases; they are intentionally **not** pre-written here because they depend on
implemented code, configured environments, or decisions still pending:

| Planned document | Task | Why not yet |
|---|---|---|
| `docs/DEPLOYMENT.md` | ✅ created 2026-09-19 (T202 initial) → completed by T175/T211/T238/T239 | External checklists (T195/T196/T210) remain ⏳ pending manual verification |
| ~~`docs/SECURITY.md`~~ → `security/SECURITY_ARCHITECTURE.md` | T178 (r4: updates the existing file; no separate `SECURITY.md`) | Needs the T203 verification outcome and implemented controls |
| `docs/SECURITY_REVIEW.md` | T185 | Pre-production review of implemented code |
| `docs/DISASTER_RECOVERY.md` | T187 | Needs backup tooling (T186) and environments |
| `docs/SUPPORT_RUNBOOK.md` | T204 | Needs verified Clerk recovery flows |
| ~~`docs/DATABASE_SCHEMA.md`~~ → `database/DATABASE_SCHEMA.md` | T242 | ✅ created 2026-09-24 from migrations 0001–0004 |
| `docs/API_SPECIFICATION.md` | T176 | Derived from implemented handlers |
| `docs/RBAC.md` | T177 | Documents implemented authorization flow |
| `docs/BUSINESS_RULES.md` | T243 | Consolidates rules once services exist; the workflow docs here are the pre-implementation reference |
| `docs/AI_MODULE.md` | T244 | Needs prompts/schemas/validation code |
| `docs/PRD.md`, `FRD.md`, `ROADMAP.md`, `FEATURES.md` | T234 (r4: `UI_UX_GUIDELINES.md` and `CHANGELOG.md` are **not** created — T234 updates `ui/DESIGN_SYSTEM.md` and `product/CHANGELOG.md`) | Derivations of `spec.md`; not needed before implementation |

`docs/architecture/SYSTEM_ARCHITECTURE.md` and `docs/product/CHANGELOG.md`
are pre-implementation baselines for the documents T175 and T234 schedule;
since r4 the task texts and `plan.md` § Documentation Plan point at these
existing files (see *Path notes*).
