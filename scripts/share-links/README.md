# Duplicate share-link cleanup (before migration 0011)

Migration 0011 enforces **one live share-following DIRECT_SHARE link per
beneficiary** and refuses to run (`DUPLICATE_LIVE_SHARE_LINKS`) while any
beneficiary holds more than one unrevoked such link. Links minted before the
fix can be in that state. This is how they are resolved — an operator action,
approved per environment, never part of a migration.

## The rule (same in both files)

For each beneficiary with more than one unrevoked share-following link:

| Link | Action | Effect |
|---|---|---|
| Already expired | `REVOKE_EXPIRED` → revoked as `EXPIRED` | none: it opened nothing already |
| Live, used most recently (`last_used_at`), else newest (`created_at`), else highest id | `KEEP` (canonical) | unchanged |
| Every other live one | `REVOKE_DUPLICATE` → revoked as `ADMIN` | that link stops working; the beneficiary keeps the canonical link, which shows the same documents |

Rows whose token owner is not the beneficiary's owner, or whose beneficiary is
removed or inactive, are `AMBIGUOUS`: reported, never touched.

## Procedure

1. **Diagnose (read-only).**
   `pnpm exec supabase db query --linked -f scripts/share-links/diagnose.sql`
   (assert first that `supabase/.temp/project-ref` is the intended project).
   Output: counts, every involved link (ids, timestamps, state, action — never
   a token or hash), and `approvedIds`.
2. **Review and approve** the exact ids. Note any `REVOKE_DUPLICATE` used in
   the last 24 hours (`usedInLast24h`) — its holder loses that link.
3. **Clean up (writes).** Copy `cleanup.sql`, paste the approved ids into
   `array[…]::uuid[]`, run it the same way. One transaction; each id is
   re-checked against the rule (anything that no longer qualifies aborts the
   whole run); each revocation is audited (`access.token_revoked`, reason
   `DUPLICATE_SHARE_LINK` or `EXPIRED`, `operation: share-link-cleanup-0011`,
   with the canonical link kept). Re-running skips ids already revoked.
   The final line must read `0`.
4. **Apply migration 0011** (`supabase db push --linked --dry-run`, then for real).

## Rollback

Revocation is not undone in place (that would bypass the audit trail). If a
beneficiary needs a link back, the owner resends it from the Access links
panel, which mints a fresh one; the canonical link keeps working throughout.
