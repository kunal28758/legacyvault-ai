# Workflow — Dead Man Switch (Legacy Execution Engine)

**Purpose**: How the owner's emergency release workflow behaves — configuration,
check-ins, the warning and grace stages, contact notices, release, beneficiary
verification, recovery and failure handling — as implemented. Canonical rules
live in the migrations (`0003_functions.sql`, `0009_legacy_execution.sql`) and
the services cited below.

**Canonical sources**: `spec.md` User Stories 10 and 19, FR-I001–I012;
`data-model.md` § 12, § 13, § 21, § 25; ADR-006, ADR-014;
`supabase/migrations/0009_legacy_execution.sql`.

**Status**: ✅ implemented (2026-09-24), hardened as the Legacy Execution
Engine on 2026-10-07 (migration `0009`).

> **Principle.** No recent activity is never treated as proof of death or of
> anything else. LegacyVault runs a release the owner configured in advance; it
> is not a legal authority and transfers no ownership. Wording in the product,
> notifications and emails says "no recent activity" and "release workflow",
> and a unit test keeps death/legal claims out of every release message.

---

## 1. Configuration (`POST /api/v1/dead-man-switch` → `dms_configure()`)

Step-up verified (`strict`): choosing who receives what must not be possible
from a borrowed session.

| Setting | Constraint (validated by Zod **and** in the function) |
|---|---|
| Check-in interval | 1–90 days |
| Inactivity threshold | 7–365 days, **longer than the check-in interval** (`WARNING_WINDOW_INVALID`) |
| Grace period (escalation delay) | 1–168 hours; also the wait between later steps |
| Escalation steps | `escalation_rules.steps`, 1–10, default 2 |
| Trusted contacts | ≥ 1 of the owner's own beneficiaries, not deleted, not INACTIVE |
| Release scope | documents, assets, videos (delivery condition Immediate or On release) and plan sections the owner owns; never empty; never the whole vault |

Being a beneficiary releases nothing: only contacts named here receive the
release, and only the scope named here is released.

## 2. States

The database states are kept; the brief's vocabulary maps onto them:

| State | Meaning | Brief |
|---|---|---|
| `INACTIVE` | disabled, nothing monitored | DISABLED |
| `ACTIVE` | on schedule | ACTIVE |
| `REMINDER_SENT` | check-in due, owner reminded | WARNING |
| `GRACE_PERIOD` | final window; contacts not told | GRACE_PERIOD |
| `ESCALATING` | contacts told the workflow started; nothing released | PENDING (release pending) |
| `RELEASING` | release authorized; links about to be issued | RELEASE_AUTHORIZED / IN_PROGRESS |
| `RELEASED` | links issued; each contact must verify by code | RELEASED |
| `PAUSED` | owner pause; no deadline runs | — |
| `RECOVERY` event → `ACTIVE` | owner check-in or recovery cancelled it | CANCELLED / RECOVERED |

Transitions (each writes a `dead_man_switch_events` row and an audit row):

```
owner   configure            INACTIVE|ACTIVE|PAUSED → ACTIVE
owner   check-in (verified)  ACTIVE|REMINDER_SENT|GRACE_PERIOD → ACTIVE          (CHECK_IN)
                             ESCALATING|RELEASING → ACTIVE                       (RECOVERY, dms.release_cancelled)
owner   recover (verified)   REMINDER_SENT … RELEASED → ACTIVE, revokes links   (RECOVERY)
owner   pause                ACTIVE → PAUSED            (only on schedule)
owner   resume               PAUSED → ACTIVE
owner   disable (verified)   any → INACTIVE, revokes links
system  dms_transition       ACTIVE → REMINDER_SENT → GRACE_PERIOD → ESCALATING (×steps)
                             → RELEASING → RELEASED
```

Pausing is refused outside `ACTIVE`: before 0009 a pause + resume could end an
escalation, or hide a completed release, without the step-up verification
recovery requires.

## 3. Schedule (hourly scan, `lib/jobs/handlers/dms-scan.ts`)

| When | Transition | Owner notification (always emailed except the reminder) |
|---|---|---|
| last check-in + interval | → `REMINDER_SENT` | `dms.reminder` (honours "check-in reminders") |
| last check-in + threshold | → `GRACE_PERIOD` | `dms.grace_period` |
| + one delay | → `ESCALATING` (step 1); one `dms.contact-notice` per eligible contact | `dms.escalating` |
| + one delay per step | → `RELEASING` **only if a warning to the owner was confirmed delivered this cycle** (§ 3a); otherwise *held* | `dms.release_held` while held, at most daily |
| next tick | → `RELEASED`; one `access.deliver` per eligible contact | `dms.released` |

The owner's page projects these dates ("If you stop checking in") with the
same rules (`projectSchedule()` in `lib/client/dms-presentation.ts`).

## 3a. Release gate: what "the owner was warned" means

Release is authorized only when a grace-period, escalation or held-release
notice for this switch, created since the last check-in, has
`delivery_status = DELIVERED` **and** a provider message id.

| Status | Written when | Counts for the gate |
|---|---|---|
| `PENDING` | notification created | no |
| `SENT` | the provider accepted the request (`notification.deliver`) | **no** — accepted is not delivered |
| `DELIVERED` | the provider reports the recipient's mail server accepted it (email webhook, or `notification.confirm` asking the provider) | **yes**, with a provider id |
| `DELIVERED` without a provider id | in-app only / email suppressed | no |
| `BOUNCED` | the provider reports a bounce | **never** |
| `FAILED` | send failed, blocked, invalid, complaint | never |

`notification.confirm` runs two minutes after every security-critical send
and asks the provider that carried it (Brevo's event log or Resend's message
lookup). No outcome yet, or an unreachable provider, is a retried failure —
never a confirmation. Only a delivery event confirms; an event for another
message, or an unknown event, cannot. DELIVERED is terminal, so a later
`sent` event cannot overwrite it. Human reading cannot be proven by any
provider, so "the recipient's mail server accepted it" is the strongest
milestone used.

**Held release.** Without a delivered warning the switch stays `ESCALATING`:
`release_held_at` records when the hold began (one `dms.release_held` audit
row) and `release_hold_checked_at` each later check (no audit row). Every
hourly scan re-asks the provider about warnings still at `SENT`, and when no
warning is in flight sends a fresh `dms.release_held` notice, at most once a
day. A hold ends when a warning is delivered (`dms.release_hold_cleared`), or
when the owner checks in, recovers or disables (a trigger clears it on any
move out of `ESCALATING`). The owner sees it on the switch page, in the
Action Centre and the Security Centre; operators see the count in the
admin console. A mailbox that only ever bounces keeps the release held:
fail closed by design.

## 4. Release (`access.deliver` → `system_issue_access_token()`)

- Runs only while the switch is `RELEASED`; a delivery left over after
  recovery or disabling does nothing.
- The grant is the **live part** of the configured scope (`lv_live_scope()`):
  deleted resources and videos no longer deliverable on release are dropped,
  the rest is re-validated and must stay inside the configured scope. When
  nothing is left, no link is issued and `access.delivery_skipped` is audited.
- One live link per (switch, contact); a retry reissues an undelivered link,
  never a second one. Links expire after 30 days and are stored as hashes.

## 5. Beneficiary verification (portal)

A release link opens nothing by itself. `POST /api/v1/access/exchange` answers
`verificationRequired` and emails a six-digit code to the contact's own
address (`system_start_release_verification`: hash only, 15 minutes). The same
call with the code (`system_check_release_verification`: three attempts per
code) issues the session. Every new session needs a fresh code, so a forwarded
or reused link alone is useless. The owner sees *that* a contact verified
(`verified_at`), never the code.

Identity (code to the contact's address), authorization (named trusted
contact, not deleted or inactive) and resource release (the live scope) are
checked separately; every portal request re-checks all three, plus that the
switch is still `RELEASED` (and, for emergency links, that the request is
still granted).

## 6. Recovery

Before release a verified check-in cancels everything. After release,
recovery revokes every release link in the same transaction and the portal
refuses them on the next request; what a contact already opened cannot be
taken back, and the audit trail keeps it.

## 7. Failure model

| Failure | Outcome |
|---|---|
| Email provider down | Warnings are retried; the switch is **held in `ESCALATING`** until one is confirmed delivered (§ 3a). A code that cannot be sent opens nothing (503). |
| Warning bounces | Held; a bounce is never counted. A fresh notice goes out at most daily. |
| Provider cannot be asked | The confirmation is retried; nothing is counted until it answers. |
| Contact notice fails | Retried; the timeline does not wait on it and nothing is released by it. |
| Owner checks in during the scan | `dms_transition` checks the state under `FOR UPDATE`; the check-in wins. |
| Duplicate scan / delivery | Idempotency keys and the one-live-link index make the second run a no-op. |
| Scope deleted after configuration | Skipped item, never a failed release; the owner sees "N selected items no longer exist". |

## 7a. Email routing

Every message is sent through Brevo, the sender verified in production
(`lib/email/send.ts`, `VERIFIED`): owner warnings and alerts, contact notices,
release and access links, release and emergency codes, designations and
invitations. Without Brevo configured the client falls back to Resend; the
result records which provider carried it, so its outcome is asked of the
right one. Release links issued before migration `0009` have no
`verified_at` and must pass the code step like any other.

## 8. Where it shows up

Dashboard *Emergency plan* card; Action Centre (`dms-overdue`,
`dms-escalating`, `dms-released`, `dms-schedule`, `dms-contacts`,
`dms-scope`); Readiness (`dms-armed`, `dms-ready`, counting only items that
still exist); Security Centre (switch control state, *Live access links* with
revoke); Legacy Intelligence (RULE-003 deleted item in scope, RULE-006 inactive
contact, ASSET-REL-001 assigned asset outside every release); Copilot overview
(counts only; the assistant cannot configure, authorize or verify anything).

## 9. Verification

`tests/unit/legacy-execution.test.ts`, `tests/unit/dms-scan.test.ts`,
`tests/unit/access-portal-scope.test.ts`,
`tests/unit/access-portal-release.test.tsx`, `tests/integration/protection.test.ts`
(§ "dead man switch", "legacy execution engine"), and the browser journeys in
`tests/e2e/legacy-execution.spec.ts` (start the dev server with
`RESEND_BASE_URL` pointing at the local capture to run the release and
emergency-access journeys end to end).
