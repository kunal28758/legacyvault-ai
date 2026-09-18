# Requirements Traceability — LegacyVault AI

**Purpose**: A pointer matrix from requirement **groups** to the architecture
decisions, design documents, implementation tasks and test tasks that satisfy
them. It exists so reviewers can answer "where is FR-X handled?" without
searching, and so gaps are visible.

**Authority**: `specs/001-baseline-product-spec/spec.md` is the **only**
source of requirements (FR/NFR/UX/AC/SC identifiers and text). This document
does not restate requirement text and must never be used to interpret a
requirement; when it disagrees with `spec.md`, `spec.md` wins. Task IDs
refer to `tasks.md`; ADR numbers to `docs/ARCHITECTURE_DECISIONS.md`.

**Status**: as of 2026-09-18 every row is 📐 specified / 📋 planned; **no
task is complete and nothing is implemented**. Test columns list the task
that will provide automated coverage (constitution XVII).

---

## Functional requirement groups

| Group (spec.md § Requirements) | Key decisions | Design / explainer docs | Implementation tasks | Automated tests |
|---|---|---|---|---|
| **A. Authentication & Account** (FR-A001–A018) | ADR-003 (Clerk), ADR-014 | `security/SECURITY_ARCHITECTURE.md` § 2; `contracts/api-contracts.md` § Auth | T040, T041, T047, T048, T056, T114, T115, T182, T195, T198, T201, T203 (verification), T204, T220 | T214, T241 |
| **B. User Profile** (FR-B001–B007) | ADR-003; Clarifications 2026-09-18 (idle timeout) | `data-model.md` § 1 | T034, T035, T118, T200, T220 | T214, T241 |
| **C. Legacy Plan** (FR-C001–C012) | ADR-002/004 r2 (guarded functions); Clarifications 2026-09-18 (acknowledged finalization) | `workflows/WILL_WORKFLOW.md`; `data-model.md` § 9–10 | T057–T070, T102, T103, T221–T224 | T225 |
| **D. Beneficiary Management** (FR-D001–D011) | ADR-014 (recipient/token model); Clarifications 2026-09-18 (allocation, lifecycle) | `workflows/BENEFICIARY_WORKFLOW.md`; `data-model.md` § 2, 16, 21 | T071–T076, T097–T101, T219, T230, T231 | T226, T229, T228 |
| **E/F/G. Assets** (FR-E001–E005, F001–F004, G001–G005) | Research D13 (field encryption); ADR-004 r2 | `security/ENCRYPTION.md`; `data-model.md` § 3–5, 26 | T079–T089, T227 | T213, T214, T241 |
| **H. Secure Document Vault** (FR-H001–H017) | ADR-005 (storage), ADR-015 (scanning), ADR-013 (deferred) | `database/DATABASE_ARCHITECTURE.md` § 7; `security/SECURITY_ARCHITECTURE.md` § 6 | T029, T032, T090, T091, T093, T095, T096, T181, T205, T227, T247 | T216, T228 |
| **I. Dead Man Switch** (FR-I001–I012) | ADR-006 (jobs), ADR-014 (release tokens) | `workflows/DEAD_MAN_SWITCH_WORKFLOW.md`; `data-model.md` § 12, 13, 25 | T123–T133, T183, T193, T207, T211 | T235, T217 |
| **J. Emergency Access** (FR-J001–J010) | ADR-014; Clarifications 2026-09-18 (bootstrap, OTP, timeout rules) | `workflows/BENEFICIARY_WORKFLOW.md` § 6; `data-model.md` § 14–15 | T134–T140, T208 | T236 |
| **K. Video Legacy** (FR-K001–K008) | ADR-005, ADR-015; Clarifications 2026-09-18 (upload-only) | `database/DATABASE_ARCHITECTURE.md` § 7 | T141, T142, T144, T247 | T228 (shared upload path), T241 |
| **L. AI Assistant** (FR-L001–L010; L010 deferred) | ADR-008 | `integrations/INTEGRATIONS.md` § OpenAI and Google Gemini | T104–T113, T206 | T232 |
| **M. AI Will Generator** (FR-M001–M014) | ADR-008, ADR-016 (drafts) | `workflows/WILL_WORKFLOW.md` § 7; `data-model.md` § 27–28 | T119–T122, T233 | T232, T241 |
| **N. AI Document Analysis** (FR-N001–N008) | ADR-016 | `data-model.md` § 27–28 | T145–T147, T233 | T232 |
| **O. Security Center** (FR-O001–O009) | ADR-003 | `security/SECURITY_ARCHITECTURE.md` § 2 | T114–T118, T182, T220 | T241 |
| **P. Administration** (FR-P001–P012; P003, P008–P010 deferred) | ADR-003/004 | `security/SECURITY_ARCHITECTURE.md` § 3 | T033, T148–T154 | T214, T241 (authorization matrix) |
| **Q. Security Requirements** (FR-Q001–Q018) | ADR-001 (cache), ADR-004 r2, ADR-007, ADR-015 | `security/*` | T007, T020–T030, T032, T181, T185, T192, T212–T218, T247 | T212–T216 |
| **R. AI Safety** (FR-R001–R010) | ADR-008 | `integrations/INTEGRATIONS.md` § OpenAI and Google Gemini | T104–T108, T113, T206 | T232 |

## Non-functional requirements

| NFR group | Where satisfied | Tasks | Verification |
|---|---|---|---|
| Security (NFR-SEC-001–003) | ADR-004 r2, ADR-005; `security/*` | T185 (review), T246 (blocking gate) | T212–T215 |
| Privacy (NFR-PRV-001–003) | constitution II; `ENVIRONMENT_MATRIX.md` (no production data in lower environments); city/country-only device detection | T182, T188 (PII scrubbing) | T214 |
| Reliability (NFR-REL-001–002) | guarded transactional functions; idempotent jobs; provider fallback | T019, T197, T107 | T217, T225, T229, T232 |
| Availability (NFR-AVL-001–002) | DMS scan health check; `pg_cron` redundancy; uptime monitoring | T183, T211, T239 | T235 |
| Performance (NFR-PER-001–004) | direct-to-storage uploads; job progress polling | T147 (progress), T191 (load test) | T191 |
| Scalability (NFR-SCL-001–002) | serverless Route Handlers (ADR-001) | T191 | T191 |
| Accessibility (NFR-ACC-001–004) | `ui/DESIGN_SYSTEM.md` | T168, T170, T173, T237 | T237 |
| Responsiveness (NFR-RSP-001) | `ui/DESIGN_SYSTEM.md` § 7 Responsiveness | T170 | T237 |
| Maintainability (NFR-MNT-001–003) | `development/CODING_STANDARDS.md` | T005, T006 | CI lint/type-check (T016) |
| Observability (NFR-OBS-001–003) | `monitoring/OBSERVABILITY.md` | T022, T023, T188, T239 | T214 (correlation id, redaction) |
| Auditability (NFR-AUD-001–002) | append-only `audit_log`, guarded functions write audit rows | T027, T218, T019 | T215 |
| Disaster Recovery (NFR-DR-001–002) | Supabase backups + PITR, off-platform `pg_dump`, runbook | T186, T187 | restore drill (T187) |
| Compliance readiness (NFR-CMP-001) | export/deletion endpoints, retention policy | T189, T245 | T241 |

## UI/UX requirements (UX-001–UX-018)

`ui/DESIGN_SYSTEM.md`; tasks T010–T012, T017, T164–T170, T173, T184; verified
by T237 (automated a11y) and T170 (responsive audit).

## Success criteria (SC-001–SC-010)

| SC | Evidence path | Note |
|---|---|---|
| SC-001, SC-002 | usability validation (not implementation tasks — `tasks.md` Notes) | onboarding T200 targets < 3 min |
| SC-003 (uploads < 10 s for < 50 MB) | direct-to-storage design (ADR-005) | **no dedicated measurement task** — see *Coverage notes* |
| SC-004 | T191 load test (p95 < 500 ms) | — |
| SC-005 | T212, T215, T241 authorization matrix | — |
| SC-006 | T113, T119, T232 | disclaimers + confirmation gates |
| SC-007 | T235 (recovery at every stage), T183 (scan health) | false-trigger rate observed in operation |
| SC-008 | T237 | automated a11y |
| SC-009 | T215 (guarded functions write audit rows), T185 | — |
| SC-010 | T239 (uptime monitoring), T211 | measured in operation |

## Coverage notes (observations only — not changes)

- **SC-003** has no explicit measurement task; it could be attached to the
  load-test task (T191) when that task is executed. Recorded for later review;
  `tasks.md` is not modified by this document.
- **FR-A014** (failed sign-in attempts) depends on the outcome of the T203
  verification of Clerk event coverage (ADR-003 open item).
- Deferred by the specification: FR-L010 (voice input), FR-P003/P008–P010
  (multi-tenancy). In-browser video recording is deferred (Clarifications
  2026-09-18).
