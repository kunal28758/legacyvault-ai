# Data retention and deletion — owner decisions (2026-10-15)

Proposals only. **Nothing here has been applied to existing data.** Until a
decision is recorded below, the system keeps what it keeps today. This is not a
statement of legal compliance; take legal advice where it matters.

## Account lifecycle as implemented

| State | Set by | Access | Data | Code |
|---|---|---|---|---|
| Active | sign-up | full | kept | — |
| Deletion scheduled | `DELETE /api/v1/users/me` (explicit `confirmed: true`, `strict` re-verification, `sensitive` rate limit) sets `deletion_requested_at` | read-only (edits refused); can cancel until it begins | kept for the 30-day grace period | `lib/repositories/user.repository.ts` (`setDeletionRequested`), `ACCOUNT_DELETION_GRACE_DAYS` |
| Deletion begun (access closed) | `begin_account_deletion()`, from the daily sweep after 30 days or at once from delete-now. Sets `deleted_at`, revokes access links, stops the Dead Man's Switch and emergency access | none (`requireUser` 401, RLS refuses) | kept until the purge (minutes) | migration 0012 |
| Permanently purged | the `user.hard-delete` job, or delete-now inline | none | rows, stored files and the Clerk user removed; `audit_log` kept | `purgeAccount` in `lib/services/account.service.ts` |
| Deleted in Clerk only | Clerk `user.deleted` → `begin_account_deletion(p_purge => false)` | none | **kept; no purge queued** | `app/api/webhooks/clerk/route.ts` |

There is no separate "deactivated" state and no legal-hold exception in the
product.

## Production facts (read-only, 2026-10-15)

- 13 accounts. The preflight found 0 scheduled, 0 soft-deleted and 0 due for
  the first sweep.
- `audit_log`: 576 rows since 2026-10-03.
  - **122 were written before 0013 and may hold personal values**: 110
    trigger rows and 12 asset create/delete rows.
  - 223 carry an IP address or user agent.
  - 0 admin rows carry a subject email.

## Required behaviour (implemented; not open for decision)

- **Deletion is recorded.** Every account deletion writes `user.deleted`
  (the account is closed: who, when, how) and `user.purged` (objects removed,
  row deleted) to `audit_log`. These rows outlive the account by design.
- **Access closes first.** From the moment deletion begins, sessions are
  refused. Access links, the Dead Man's Switch and emergency access stop, and
  no email goes to the owner.
- **The purge is complete or retried.** It is never reported as complete
  unless storage, the Clerk user and the rows are gone; otherwise it retries,
  and a stalled purge shows in the operator health.
- **New audit rows hold no personal values.** Migration 0013, `diffForAudit`
  and the admin audits record which fields changed, not their values.

## Decisions (all PENDING owner approval)


| # | Decision | Options | Recommended | Consequence of the recommendation |
|---|---|---|---|---|
| R1 | Existing audit rows that hold personal values | **A** keep · **D** one-time audited redaction: values → `[protected]`; action, actor, resource and time kept. Crypto-shredding (C) cannot apply to rows already written | **D**, as one reviewed migration. Until approved: **A** | until redacted, a purged account's earlier values stay in `audit_log` |
| R2 | New audit rows | already minimized (0013, `diffForAudit`, admin audits) | — | — |
| R3 | IP address and user agent | keep · null them after a period, e.g. 90 days | 90 days | older investigations keep actor, action and time, without IP or user agent |
| R4 | Audit log as a whole | indefinite (current; `data-model.md` § Retention) · fixed period | indefinite until advised otherwise | small growth: 576 rows in 12 days |
| R5 | Accounts soft-deleted before 0012, or deleted in Clerk | keep · reviewed purge | moot today (0 exist). Going forward, close the Clerk path with R6 | Clerk-side deletions would otherwise keep data indefinitely |
| R6 | Clerk's own self-service *Delete account* | off · on | **off** (`DEPLOYMENT.md` § 5 row 16) | Settings → Account is the only path; it confirms, re-verifies and purges |

**Implementing R1 or R3 requires a migration.** `audit_log` is append-only by
trigger, so either one needs a narrowly scoped, audited exception: a function
that only nulls the named keys or columns and writes its own audit row. It is
not built; it waits for these decisions.
