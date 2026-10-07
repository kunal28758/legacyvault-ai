# Command Centre — Action Centre, Legacy Readiness, Life Events

How the "what needs attention / is my legacy ready" layer works. Everything here
is derived on the client from data the app already loads; no new tables.

## Data flow

```
existing hooks (profile, plan, beneficiaries, assets ×3, documents, switch, emergency)
  └─ hooks/use-legacy-snapshot.ts  — waits until ALL sources loaded (no false "you have none")
       └─ lib/client/legacy-snapshot.ts  buildLegacySnapshot()   pure, `now` passed in
            ├─ lib/client/action-centre.ts  deriveActions()        rules → actions
            ├─ lib/client/intelligence.ts   analyzeLegacy()        findings → merged actions
            └─ lib/client/readiness.ts      readiness()            6 weighted categories
```

Consumers: Dashboard (Command Centre), `/actions`, command palette ("Needs
attention", only while open), Copilot "Verified from your account" panel,
Security Centre "Who has access", `/life-events`.

## Action Centre rules (lib/client/action-centre.ts)

Priorities: **Critical** (time-bound, act now) · **Important** · **Upcoming**
(has a near deadline) · **Recommended**. Completed actions stay listed
(collapsed). A rule whose condition does not apply emits nothing.

| Source | Raised when | Completed when |
|---|---|---|
| Emergency | a verified emergency request awaits a decision (Critical, deadline = request expiry) | — |
| Dead Man's Switch | escalating / releasing (Critical); reminder sent or grace period (Critical); next check-in < 7 days (Upcoming); armed with no trusted contacts or empty release scope (Important) | — |
| Will | not started / draft incomplete / draft complete but not finalized (Important) | a finalized version exists |
| Beneficiaries | none (Important); pending invitations (Important); nothing assigned or shared (Recommended) | ≥1 beneficiary; something assigned |
| Security | 2FA off, email unverified (Important); no recovery email (Recommended) | the control is on |
| Vault | no documents (Important); expired (Important); expiring ≤ 60 days or review date ≤ 14 days (Upcoming); uncategorized documents, no Will & estate document (Recommended) | — |
| Assets | held assets without a beneficiary (Important — now raised by Legacy Intelligence rule ASSET-BEN-001, same id `assets-unassigned`); no online accounts recorded (Recommended, worded as "if you have…") | all held assets assigned; ≥1 digital asset |
| Legacy Intelligence | every other open finding not already covered by an action above — see [LEGACY_INTELLIGENCE.md](LEGACY_INTELLIGENCE.md) | the records change so the rule no longer applies, or the owner dismisses a heuristic finding |
| Life events | each step of a recorded event | proven by state, or marked done by the owner |

## Legacy Readiness (lib/client/readiness.ts)

Overall = Σ category score × weight. Every point comes from a named criterion
shown in the UI. Wording is "preparation", never legal completeness.

| Category (weight) | Criteria (points) |
|---|---|
| Documents (20) | stored (40) · categorized share (30) · Will & estate doc (15) · none expired (15) |
| Will (25) | started (20) · sections complete share (50) · finalized (30) |
| Beneficiaries (20) | ≥1 (40) · invitations accepted share (30) · something assigned/shared (30) |
| Emergency access (15) | emergency contact (35) · switch monitoring (35) · trusted contacts + release scope (15 + 15) |
| Digital assets (10) | ≥1 recorded (50) · all assigned share (50) |
| Security (10) | 2FA (50) · email verified (25) · recovery email (25) |

Three conditional criteria come from Legacy Intelligence (documents: assets
with a supporting document (20); Will: no unresolved conflicts involving the Will (20);
beneficiaries: every held asset has a beneficiary (30)). Each counts only where
it applies; weights are unchanged. Details in [LEGACY_INTELLIGENCE.md](LEGACY_INTELLIGENCE.md).

"Improve readiness" opens the highest-priority open action.

## Stored owner data (no migrations)

- **Document profile** — `documents.metadata.profile` = `{ category?, expiresOn?, reviewOn?, aiSuggested? }`,
  written through the existing `PATCH /api/v1/documents/:id` (owner-only column
  grant + RLS from 0002; audited as `document.updated`). System keys in
  `metadata` (e.g. `scan`) are preserved. AI suggestions come only from an
  already-stored AI summary and are applied only when the owner chooses;
  applied values stay labelled until edited. Model: `lib/types/document-profile.ts`;
  validation: `lib/validators/document-profile.ts`.
- **Life events** — `users.preferences.lifeEvents` (owner-writable), validated by
  `lib/validators/life-event.validators.ts`; catalogue and step logic in
  `lib/legacy-plan/life-events.ts`. To add an event type, add it to
  `LIFE_EVENT_TYPES` and the catalogue.

## Limits

- The snapshot reads the first 100 documents (the list API maximum); category
  and expiry counts cover those.
- Access links are managed per beneficiary; the Security Centre links there
  rather than aggregating every token (that would need one request per person).
