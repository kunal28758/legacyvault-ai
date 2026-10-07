# Legacy Intelligence — Asset Vault, Relationship Graph, Findings

What the "what do I own, what supports it, who receives it, what is missing,
stale or inconsistent" layer does, and the exact rules behind every finding.
Everything is deterministic and derived from the owner's own records; nothing
here is AI and nothing is a legal conclusion.

## Data flow

```
owner-scoped APIs (same queries as the Command Centre — no new requests)
  └─ hooks/use-legacy-snapshot.ts   waits until every source has loaded
       ├─ lib/client/legacy-snapshot.ts   buildLegacySnapshot()
       ├─ lib/client/legacy-graph.ts      buildLegacyGraph()      typed edges
       └─ lib/client/intelligence.ts      analyzeLegacy()         rules → findings → recommendations
            ├─ mergeActions()  → Action Centre (deduplicated)
            └─ coverage        → Legacy Readiness (3 conditional criteria)
```

Server copy (Copilot only): `lib/services/intelligence.service.ts` runs the same
engine over the same owner-scoped service reads and gives the model **counts per
rule and type, never names** (`describeForAssistant`). It only reads.

The Asset Vault renders progressively: assets and values show as soon as the
three asset lists load (the same queries, so no extra requests); findings,
document links and the attention stats fill in when every source has loaded.

Consumers: Asset Vault (`/assets`), asset page (`/assets/:type/:id`), Legacy
Intelligence (`/intelligence`), Action Centre, dashboard "Legacy Intelligence"
card, Legacy Readiness, command palette, Copilot "Verified from your account"
panel, document cards ("Supports N assets").

## Stored data (no new tables)

| What | Where | Write path |
|---|---|---|
| Asset profile: `status` (ACTIVE · SOLD · CLOSED · TRANSFERRED), `acquiredOn`, `reviewOn`, `expiresOn`, `lastReviewedOn`, `nominee {name, relationship?, beneficiaryId?}`, `instructions` | `<asset table>.metadata.profile` | create: `create_asset()` (allow-lists `metadata`); update: the existing owner-only Class A `metadata` column grant through `PATCH /api/v1/assets/:type/:id`. Audited as `asset.updated` with `changed: ["profile"]` and `profileFields` (names only). Other metadata keys are preserved. A nominee linked to a beneficiary must be the caller's own (404 otherwise). |
| Supporting documents | `document_attachments` (existing) | `attach_document()` / `detach_document()` (existing, ownership-checked, audited). `GET /documents` now returns each document's `attachments` in one owner-scoped query. |
| Dismissed findings | `users.preferences.dismissedFindings` (≤ 200 ids) | existing preferences write, validated, audited as `user.preferences_updated` |

Secrets never go in the profile: `instructions` refuses PEM private keys,
12–24-word recovery phrases (alone, or after a label such as "Seed phrase:"),
64-hex private keys, Bitcoin WIF keys and BIP32 extended private keys
(`xprv…`); the form tells the owner to describe *where* a credential is kept.
Rejected values are never logged — validation errors carry the message only.
Encrypted account numbers / credentials are unchanged.

The beneficiary portal never sees the profile: `assetView()` selects named
columns only (`id, name, category, notes, estimated_value, currency`) —
covered by `tests/integration/legacy-intelligence.test.ts`.

**Migration `0008_asset_categories.sql`** (additive only): enum values
financial `INVESTMENT`, `CRYPTOCURRENCY`, `OTHER`; physical `OTHER`; digital
`WEBSITE`, `DIGITAL_BUSINESS`, `INTELLECTUAL_PROPERTY`. No table, column, grant,
policy or function changes. Apply it before deploying code that offers these
categories.

## Relationship graph (lib/client/legacy-graph.ts)

| Edge | From → to | Source |
|---|---|---|
| `owns` | user → asset / document | every loaded record |
| `documents` | document → asset | `document_attachments` |
| `assigned_to` | asset → beneficiary (with allocation) | `beneficiary_assignments` |
| `beneficiary_of` | reverse of `assigned_to` (`graph.in`) | — |
| `nominee_of` | beneficiary → asset | asset profile `nominee.beneficiaryId` |
| `referenced_by` | asset / beneficiary / document → Will | Will sections (`assetIds`, `beneficiaryIds`, `documentIds`) and `LEGACY_PLAN` attachments |
| `protected_by` | asset / document → switch / emergency config | release scopes |
| `released_to` | switch / emergency config → beneficiary | trusted / emergency contacts |
| `expires_on`, `reviewed_on` | asset / document → date | profiles |

A reference to a record that is not loaded is reported as **dangling** only
when that list is complete (API total ≤ loaded). A record on page 2 is never
called "missing". `related_to` is not modelled — no deterministic source
supports it yet.

## Findings

Severity reuses the Action Centre vocabulary. No intelligence rule is
Critical; Critical stays reserved for time-bound emergencies.

| Rule | Type | Severity | Raised when | Dismissible | Action Centre |
|---|---|---|---|---|---|
| ASSET-BEN-001 | Missing | Important | a held asset has no beneficiary (its own assignment list, so a beneficiary beyond the loaded page still counts) | no | replaces `assets-unassigned` (was Recommended; completed when none left) |
| ASSET-DOC-001 | Missing | Recommended | a held financial/physical asset has no linked document (only with all documents loaded) | yes | new |
| ASSET-INSTR-001 | Missing | Recommended | a held asset has no instructions | yes | new |
| ASSET-REL-001 | Missing | Recommended | a held asset with a beneficiary is in neither the switch's release scope nor any emergency access scope (only when one of them exists) | yes | new |
| DOC-CAT-001 | Missing | Recommended | documents without a category | no | covered by `documents-categorize` |
| EA-CONTACT-001 | Missing | Recommended | no emergency contact | no | covered by `emergency-contact` |
| WILL-001 | Missing | Important | Will not started / draft incomplete (same condition as `will`) | no | covered by `will` |
| BEN-RES-001 | Unlinked | Recommended | an active/pending beneficiary has nothing assigned or shared, is no trusted/emergency contact and is not named in the Will | yes | new (covered by `beneficiary-assign` while nobody has anything) |
| DOC-EXP-001 | Expiring | Important (expired) / Upcoming (≤ 60 days) | a document's expiry date; names the assets it supports | no | covered by `documents-expired` / `document-expiring-*` |
| DOC-REVIEW-001 | Expiring | Upcoming | a document's review date ≤ 14 days or passed | no | covered by `document-review-*` |
| ASSET-EXP-001 | Expiring | Important (passed) / Upcoming (≤ 60 days) | a held asset's expiry/renewal date | no | one action per asset, with deadline |
| ASSET-REVIEW-001 | Expiring | Upcoming | a held asset's review date ≤ 14 days or passed | no | one action per asset, with deadline |
| ASSET-STALE-001 | Stale | Recommended | a held asset not changed or marked reviewed in 365 days (`STALE_AFTER_DAYS`) | no | new |
| WILL-STALE-001 | Stale | Recommended | the current Will was finalized > 365 days ago | yes | new |
| DOC-ASSET-001 | Unlinked | Recommended | a Property / Insurance / Financial / Business document has no attachment at all (its own attachment list) and is not referenced by the Will | yes | new |
| RULE-001 | Conflict | Important (some with %, some without) / Recommended (all with %, total < 100) | potentially conflicting assignments on one asset | yes | new |
| RULE-002 | Conflict | Important (Will section marked "none") / Recommended | a held asset is absent from a Will asset section the owner has started | yes | new |
| RULE-003 | Conflict | Important | the Will, a release scope or a link references a deleted asset/document | no | new |
| RULE-004 | Conflict | Recommended | held assets with the same class + category + normalized name, or the same platform + username — titled "Potential duplicate", action "Check whether they are the same asset" | yes | new |
| RULE-005 | Conflict | Important | an expired document is still linked to a held asset | no | new |
| RULE-006 | Conflict | Important | an assignment, nominee, Will entry or contact refers to an inactive or removed beneficiary | no | new |
| RULE-007 | Conflict | Important | a beneficiary receives held assets but is not in the Will's (started) beneficiaries section | yes | new |
| RULE-008 | Conflict | Recommended | documents with the same normalized name, MIME type and size — a heuristic (contents are not compared), titled "Potential duplicate document", action "Check whether they are copies" | yes | new |
| RULE-009 | Conflict | Important | an asset marked sold/closed/transferred is still assigned, in the Will (the Will is then a source record), or in a release scope | no | new |
| RULE-010 | Conflict | Recommended | a beneficiary named in the Will has nothing assigned or shared in the vault | yes | new |

Finding contract: `id` (`ruleId:record ids`, stable), `type`, `severity`,
`title`, `explanation`, `sourceRecords`, `recommendedAction`, `destination`,
`ruleId`, `createdAt` (evaluation time), `status` (open / dismissed),
`dismissible`, `coveredBy`, `deadline`.

Recommendations: one action per rule (the finding itself when there is one,
"N assets …" with a filtered destination when there are several), one per
finding for dated rules. Findings an existing action covers produce no action.
Intelligence actions carry `ruleId` and show "System detected".

Wording: "potential inconsistency", "review recommended", "consider confirming
with a qualified professional". Never "invalid" or "legally" — enforced by a
unit test.

## Legacy Readiness additions

Category weights are unchanged (20/25/20/15/10/10). Each new criterion exists
only where it applies, so an account without assets or a Will is not scored on it.

| Category | Criterion (points) | Applies when | Score |
|---|---|---|---|
| Documents | Assets you hold have a supporting document (20) | held financial/physical assets > 0 and every document loaded | share without an open ASSET-DOC-001 |
| Will | No unresolved conflicts between your Will and vault (20) | a Will exists | all or nothing: no open Conflict finding that has the Will as a source record (RULE-002, -003, -006, -007, -009, -010 when they involve the Will) |
| Beneficiaries | Every asset you hold has a beneficiary (30) | held assets > 0 | share without ASSET-BEN-001 |

## Limits

- Reads the first page of each list: 100 assets per class and 100 documents
  (the API maximum) and 50 beneficiaries (the shared default page); the
  Copilot's server copy reads the same pages. Nothing outside the page is ever
  reported missing: per-record rules use each record's own server-provided
  relationships (assignments, attachments); dangling references (RULE-003,
  removed beneficiaries in RULE-006) and supporting-document coverage
  (ASSET-DOC-001, its readiness criterion, the asset page's document chip) are
  evaluated only when the list is complete; `/intelligence` says which lists
  were partial. Larger accounts therefore get fewer findings, never wrong ones.
  Full pagination is not implemented — it would multiply requests per page
  view against the 600 / 15 min read budget for exactly those accounts.
- Duplicate documents are detected by name + type + size; there is no content
  hash (uploads go straight to private storage and are not re-read), so RULE-008
  says "potential", is dismissible and never claims the files are identical.
- Contradictory instructions are detected through the structured status, not
  by reading free text.
- Reads use the `read` budget (600 requests / 15 minutes per user, applied
  by `withApi()` to every GET); the vault and asset pages reuse the Command
  Centre queries (TanStack Query dedupes them) rather than adding their own.
