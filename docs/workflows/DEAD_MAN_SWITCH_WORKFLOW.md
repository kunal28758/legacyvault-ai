# Workflow — Dead Man Switch

**Purpose**: Describe the Dead Man Switch lifecycle — configuration,
scheduled check-ins, escalation, conditional release, recovery and
monitoring — as established by the specification and design artifacts. It
narrates rules defined elsewhere and cites them; it defines none.

**Canonical sources**: `spec.md` User Stories 10 and 19, FR-I001–I012,
NFR-AVL-002, Clarifications 2026-09-16 (release scope) and 2026-09-18
(recipient model, plan sections), edge cases *Dead Man Switch false trigger*
and *Missed check-ins*; `data-model.md` § 12 DeadManSwitch (state machine),
§ 13 DeadManSwitchEvent, § 25 DeadManSwitchContact, § 21 AccessToken,
§ 22 Job, § Write-Protection Model 5; `contracts/api-contracts.md`
§ Dead Man Switch and § Internal Endpoints; ADR-006, ADR-014; tasks T123–T133,
T183, T193, T207, T211, T235.

**Status**: 📐 specified / 📋 planned; **not implemented** as of 2026-09-18.

---

## 1. Purpose of the feature

Detect prolonged inactivity of the account owner and, only after a
multi-step escalation with recovery opportunities at every stage, release
**explicitly selected** resources to **explicitly chosen** trusted contacts.
It never grants account access (FR-I012, ADR-006).

## 2. Configuration (FR-I001, I006, I012; T123, T124, T127)

`POST`/`PATCH /api/v1/dead-man-switch` → `dms_configure()` (guarded
function; one switch per user):

| Setting | Constraint |
|---|---|
| Inactivity period | 7–365 days |
| Check-in frequency | 1–90 days |
| Delay between escalation steps | 1–168 hours (default 24) |
| Trusted contacts | ≥ 1 of the owner's beneficiaries, not INACTIVE (stored in `dead_man_switch_contacts`, with notify order) |
| Release scope | subset of the owner's documents, assets, videos and plan-section keys (validated at configuration) |
| Escalation rules | step count / channels |

Configuration computes `nextCheckInAt`, sets status **ACTIVE**, writes a
CONFIG_CHANGE event and an audit row. The owner can **pause** / **resume**
(`dms_pause()` / `dms_resume()`) and **disable** (`dms_disable()`, requires
Clerk reverification `strict`) at any time (FR-I010). The status page always
shows the current state and next check-in date (FR-I011).

## 3. States (data-model § 12)

```
INACTIVE → ACTIVE        configure / enable
ACTIVE → REMINDER_SENT   job: check-in sent
REMINDER_SENT → ACTIVE   owner checks in
REMINDER_SENT → GRACE_PERIOD   window expired
GRACE_PERIOD → ACTIVE    owner checks in
GRACE_PERIOD → ESCALATING      grace expired
ESCALATING → ACTIVE      owner cancels escalation (reverified)
ESCALATING → RELEASING   escalation steps exhausted
RELEASING → RELEASED     release executed
RELEASED → ACTIVE        owner recovers (reverified; release tokens revoked)
ANY → PAUSED / PAUSED → ACTIVE / ANY → INACTIVE   owner
```

Owner transitions use guarded functions; job transitions use the service-
role `dms_transition()`, each guarded on the current state. Every transition
writes a `dead_man_switch_events` row and an audit row (FR-I009).

## 4. Scheduling (ADR-006; T128, T129, T193)

Scheduling is **data-driven**: the hourly `dms-scan` cron enqueues one
idempotent `dms.scan` job (`dms.scan:{YYYY-MM-DDTHH}`); its handler reads
switches whose deadlines have passed and enqueues idempotent per-switch jobs
(idempotency key `dms:{switchId}:{deadline}`), which the `run-jobs` cron
drains every five minutes. The SUCCEEDED `dms.scan` job's `finished_at` is
the scheduler heartbeat used in § 8:

| Job | When | Effect |
|---|---|---|
| `dms.send-checkin` | ACTIVE and `nextCheckInAt` reached | check-in notification (email + in-app, with a link to the check-in page); ACTIVE → REMINDER_SENT |
| `dms.advance` | REMINDER_SENT / GRACE_PERIOD / ESCALATING past their deadline | REMINDER_SENT → GRACE_PERIOD (secondary reminder); GRACE_PERIOD → ESCALATING (trusted contacts notified, escalation step counter advances with the configured delay); steps exhausted → RELEASING |
| `dms.release` | RELEASING | § 6 |

Notification delivery failures are logged and retried with backoff by the
job runner; multiple channels are used where configured (edge case *Missed
check-ins*).

## 5. Check-in (FR-I002–I004; T130, T133, T207)

The owner opens the check-in link (or the status page), signs in if needed,
and completes Clerk **reverification** (`multi_factor` when MFA is enabled,
otherwise `strict`) — identity verification is mandatory (FR-I003).
`POST /dead-man-switch/check-in` → `dms_check_in()` resets `nextCheckInAt`
and the escalation step, returns the switch to ACTIVE, records a CHECK_IN
event and audit row (FR-I004). The check-in page also offers a "this wasn't
me" path to the Security Center.

## 6. Conditional release (FR-I005, I012; ADR-014; T131)

When escalation steps are exhausted, `dms.release`:

1. issues a **DMS_RELEASE access token** for each trusted-contact beneficiary
   through `system_issue_access_token()`, scoped **exactly** to the
   configured release scope (documents, assets, videos, plan sections of the
   latest finalized plan) and nothing else;
2. emails each contact an access link (`/access?t=…`) — the contact exchanges
   it for an access cookie and views resources read-only through the shared
   `/api/v1/access/*` endpoints (audited);
3. moves the switch to **RELEASED**, records a RELEASE event and audit row.

Unselected resources remain inaccessible; account access is never granted.

## 7. Recovery (FR-I007, I008; edge case *false trigger*)

At **every** stage — reminder, grace period, escalation, and even after
release — a returning owner who completes reverification can cancel
(`POST /dead-man-switch/cancel-escalation` → `dms_cancel_escalation()`):
the switch returns to ACTIVE, a RECOVERY event is recorded, and any
DMS_RELEASE tokens are revoked. Cancellation without identity verification is
impossible by design (FR-I008).

## 8. Availability safeguards (NFR-AVL-002; T183, T211, T239)

- A **scan-freshness health check** (in `/api/v1/health` detailed mode and in
  `run-jobs`) flags a stalled scheduler when the last successful `dms.scan`
  is older than twice the scan interval: CRITICAL audit row
  `dms.job_health_failure`, Super Admin email, Sentry alert.
- Production adds a **redundant trigger** — Supabase `pg_cron` + `pg_net`
  calling the same idempotent endpoints — so a cron-platform outage cannot
  silently stall check-ins or escalations.
- Jobs are idempotent and retry-safe; unknown job types stay queued.

## 9. Protection summary

`dead_man_switches`, `dead_man_switch_contacts` and `access_tokens` are Class
B tables (no direct write grants); all owner actions go through guarded
functions, all job actions through service-role functions guarded on state.
Sensitive actions (disable, check-in, cancel) require Clerk reverification
in the Route Handler.

## 10. Verification

T235 (integration, with a controllable clock): configuration validation, scan
idempotency, every transition and deadline, invalid transitions rejected,
recovery at each stage incl. token revocation after release, release tokens
carry exactly the release scope, direct writes denied, health check on a
stalled scan. Quickstart scenarios 6.1–6.3.
