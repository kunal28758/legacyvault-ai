# Workflow — Legacy Plan (Digital Will)

**Purpose**: Describe, end to end, how a user creates, auto-saves, reviews,
finalizes and versions a legacy plan, and how the plan relates to AI will
drafts and to external release. It narrates rules defined elsewhere and
cites them; it defines none.

**Canonical sources**: `spec.md` User Stories 2 and 20, FR-C001–C012,
Clarifications 2026-09-18 (acknowledged finalization, plan sections),
edge cases *Concurrent edits* and *Partial workflow completion*;
`data-model.md` § 9 LegacyPlan, § 10 LegacyPlanVersion, § 27–28 AiDraft,
§ Write-Protection Model 5 (functions); `contracts/api-contracts.md`
§ Legacy Plans and § AI; tasks T057–T070, T102, T103, T119–T122, T221–T225,
T231.

**Status**: 📐 specified / 📋 planned; **not implemented** as of 2026-09-18.

---

## 1. Actors and access

Only the **owner** creates, edits and finalizes a plan (spec § Resource-Level
Permissions: no direct beneficiary access to drafts). External recipients can
later view **sections of the latest finalized version** through a scoped
access token (Dead Man Switch release or emergency access) — never a draft
(Clarifications 2026-09-18).

## 2. Structure

A plan is a multi-step wizard with **eleven steps** (FR-C001). Nine steps
store data under section keys; two are UI steps:

| # | Step | Section key | Stores |
|---|---|---|---|
| 1 | Personal Details | `personal-details` | legal name for the plan (distinct from the Clerk display name), DOB, address, identification |
| 2 | Family Information | `family-information` | spouse, children, parents, dependents |
| 3 | Beneficiaries | `beneficiaries` | references to the user's beneficiary records (embedded beneficiary module) |
| 4–6 | Financial / Physical / Digital Assets | `financial-assets`, `physical-assets`, `digital-assets` | references to asset records, or an explicit "none" |
| 7 | Witness Details | `witness-details` | witness rows |
| 8 | Special Wishes | `special-wishes` | wishes and instructions |
| 9 | Document Attachments | `document-attachments` | documents attached to the plan (`document_attachments`, resource type LEGACY_PLAN) |
| 10 | Review | — | completeness summary, finalize action |
| 11 | Confirmation | — | post-finalization confirmation |

Section keys are also the vocabulary for plan-section release scope.

## 3. Create

`POST /api/v1/legacy-plans` → `create_legacy_plan()`. A user may have **at
most one DRAFT** at a time (FR-C010; partial unique index) — a second create
returns 409. The plan starts at step 1 with `lockVersion = 0`.

## 4. Fill and auto-save (FR-C002, C004, C011, C012)

- The wizard auto-saves each step (debounced) with
  `PATCH /legacy-plans/:id/steps/:step` → `save_plan_step(plan, step, data,
  expectedLockVersion)`.
- Step data is validated server-side before progression (Zod per section;
  422 with field errors). Validation concerns the data **entered** in a step,
  not mandatory completion of every step.
- Optimistic locking: the request carries the client's `lockVersion`; a
  mismatch (another tab saved first) returns **409** and the UI prompts a
  reload — no silent data loss (edge case *Concurrent edits*).
- Users navigate freely between completed steps; progress survives leaving
  the wizard (edge case *Partial workflow completion*).
- Steps 3–7 and 9 embed the beneficiary, asset and document modules; the plan
  stores **references** to those records.

## 5. Review (US20, FR-C005, C006)

`POST /legacy-plans/:id/review` returns per-section completeness plus
cross-entity checks: beneficiary count and status, asset assignment coverage,
unassigned assets, beneficiaries without allocations, document attachments,
allocation totals per resource, and the exact list of incomplete sections
that finalization will use. The review step highlights gaps with actionable
links.

## 6. Finalize (FR-C003, C007; US20 scenario 2; Clarifications 2026-09-18)

`POST /legacy-plans/:id/finalize` with `{ confirmed: true, lockVersion,
acknowledgeIncomplete? }` → `finalize_legacy_plan()`:

1. Ownership and lock version are checked; the plan must be DRAFT.
2. **Personal Details must be complete** — otherwise `PERSONAL_DETAILS_REQUIRED`
   (cannot be acknowledged away).
3. If any other section is incomplete and `acknowledgeIncomplete` is not
   true → `PLAN_INCOMPLETE` with `incompleteSections`; the UI shows the list
   and an acknowledgment checkbox.
4. On success, in one transaction: status → FINALIZED, `finalizedAt`,
   `confirmedBy`; a **LegacyPlanVersion** snapshot is written with the plan
   resolved **by value** (beneficiaries, assets, attachments), `completeness`,
   `acknowledgedIncomplete`, `incompleteSections`; an audit row; a
   notification job.
5. Step 11 (Confirmation) shows the version number, timestamp, acknowledged
   sections (if any) and next actions.

Finalization is never automatic and never triggered by AI (FR-C007,
constitution V).

## 7. Versions and new drafts (FR-C008, C009)

- Every finalization creates version N (immutable). Version history is
  readable at `GET /legacy-plans/:id/versions[/:versionId]` and shows the
  acknowledged-incomplete badge where applicable.
- To change a finalized plan the user creates a **new draft** from it
  (`POST /legacy-plans/:id/new-draft` → `create_plan_draft()`), which copies
  the data forward and increments the version counter; previous versions are
  preserved and never deleted.

## 8. Relationship to the AI Will Generator (FR-M001–M014; ADR-016)

The will generator produces an **AiDraft** (kind WILL_DRAFT) linked to the
plan from natural-language input plus plan data. It is reviewed, edited
(user versions), regenerated, and only becomes authoritative after the
explicit, reverified confirm endpoint (`confirm_ai_draft()`); the confirmed
draft is referenced by the next finalize snapshot and is the source for PDF
export. AI never modifies plan data directly (FR-R007).

## 9. External release of plan sections (FR-I012, FR-J001; ADR-014)

Release scopes (Dead Man Switch) and emergency-access scopes may include
section keys. Recipients view a read-only rendering of those sections through
`GET /api/v1/access/plan-sections/:section` after the access-cookie exchange;
the rendering always comes from the owner's **latest finalized version**.

## 10. Audit and protection

All plan writes go through guarded functions (Class B): the `legacy_plans`
table has no direct write grants, so status, version and lock fields cannot
be tampered with by a direct update. Every function writes its audit row in
the same transaction (`plan.created`, `plan.step_saved`, `plan.finalized`,
`plan.draft_created`).

## 11. Verification

Integration tests (T225): one-DRAFT rule, lock conflict, step validation,
finalize without confirmation, `PERSONAL_DETAILS_REQUIRED`, `PLAN_INCOMPLETE`
then success with acknowledgment, snapshot content, new draft versioning,
cross-user denial. Quickstart scenarios 3.1 and 3.2.
