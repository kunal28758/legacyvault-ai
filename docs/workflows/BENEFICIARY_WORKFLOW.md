# Workflow — Beneficiaries, Assignments and Scoped Access

**Purpose**: Describe how external recipients are created and managed, how
resources are assigned to them with allocation rules, and how they obtain
time-limited scoped access — including the emergency-access request flow.
It narrates rules defined elsewhere and cites them; it defines none.

**Canonical sources**: `spec.md` User Stories 3, 11, 18, FR-D001–D011,
FR-J001–J010, FR-H011–H014, FR-K005–K007, Clarifications 2026-09-16
(token-based access, no accounts) and 2026-09-18 (recipient model,
per-resource allocation, lifecycle and removal cascade, emergency-access
bootstrap/OTP/timeout rules, plan sections); `data-model.md` § 2, 14, 15,
16, 21, 25, 26 and § Write-Protection Model 5; `contracts/api-contracts.md`
§ Beneficiaries, § Assets (Assignments), § Emergency Access, § Beneficiary /
Contact Access; ADR-014; tasks T071–T076, T097–T101, T134–T140, T208, T219,
T226, T229, T230, T231, T236.

**Status**: 📐 specified / 📋 planned; **not implemented** as of 2026-09-18.

---

## 1. One recipient model

Every external person — ordinary beneficiary, Dead Man Switch trusted
contact, emergency contact — is a **Beneficiary** record owned by the user
(Clarifications 2026-09-18). Recipients never create platform accounts
(FR-D011); they receive scoped access through the mechanism in § 5. Roles are
expressed by relations, not flags: trusted contact = linked through
`dead_man_switch_contacts`; emergency contact = has an
`emergency_access_configs` row ("emergency beneficiary", FR-D010).

## 2. Lifecycle (FR-D007; Clarifications 2026-09-18)

| Status | Meaning | How entered |
|---|---|---|
| `PENDING` | created / invited; no access link used yet | `POST /beneficiaries` (Class A insert) |
| `ACTIVE` | has used an access link at least once, or owner marked active | first successful token exchange, or `set_beneficiary_status()` |
| `INACTIVE` | deactivated by the owner; existing tokens revoked; no new assignments or tokens | `set_beneficiary_status()` |

- Duplicate email per user is rejected with 409 (FR-D003).
- Contact-field edits are direct (allow-list); name/email changes require
  `confirmed: true` (FR-D008); every change is audited with previous/new
  values (FR-D009).
- Invitation email (`POST /beneficiaries/:id/invite`) sets `invitedAt`.
- **Removal** (`DELETE /beneficiaries/:id` with `confirmed: true`) runs
  `remove_beneficiary()` which, in one transaction, deletes the
  beneficiary's assignments, revokes their access tokens, removes their Dead
  Man Switch contact link, deactivates their emergency-access configuration,
  soft-deletes the record and audits each step (US3 scenario 4).

## 3. Assignments and allocation (FR-D004–D006, FR-D008, FR-E002, FR-F002, FR-G002, FR-K005)

- Resources that can be assigned: financial, physical and digital assets,
  documents (share), video messages. Each assignment links one beneficiary
  to one resource, optionally with an **allocation percentage**.
- Allocation is recorded **per resource**; the sum for one resource must not
  exceed **100 %**. Beneficiary-level or category-level percentages are not
  modeled in the baseline; the UI may show an informational aggregate
  (Clarifications 2026-09-18).
- `POST /assets/:type/:id/assign` (and document share / video assign) →
  `assign_beneficiary()`: verifies ownership of both sides, refuses INACTIVE
  beneficiaries, locks the resource row, enforces the sum (422
  `ALLOCATION_EXCEEDED` with the remaining percentage — FR-D005), audits.
  `beneficiary_assignments` has no direct write grants, so the rule cannot be
  bypassed.
- Assignments are removed with `unassign_beneficiary()`; they are also
  removed when the beneficiary is removed or the resource is deleted.

## 4. Documents and videos for recipients

- Sharing a document = an assignment with resource type DOCUMENT
  (FR-H013); revoking the share removes it. Temporary access is bounded by
  the access token's expiry (FR-H014).
- Video messages carry a **delivery condition** (IMMEDIATE, DEAD_MAN_SWITCH,
  EMERGENCY_ACCESS — FR-K006) that is enforced on every access with a strict
  grant-type mapping (`data-model.md` § 11): IMMEDIATE → any grant that
  includes the video; DEAD_MAN_SWITCH → DMS_RELEASE only; EMERGENCY_ACCESS →
  EMERGENCY_ACCESS only; mismatch → 422 `DELIVERY_CONDITION_MISMATCH`. Expiry
  follows the token (FR-K007).

## 5. Scoped access: tokens and the access cookie (FR-D011, FR-H009, FR-K008; ADR-014)

1. The owner issues a **DIRECT_SHARE** token for a beneficiary
   (`POST /beneficiaries/:id/tokens` with a scope of documents, assets,
   and/or videos, TTL ≤ 30 days) → `issue_access_token()` validates that
   every scoped id belongs to the owner **and is currently assigned to that
   beneficiary** (FR-D011; otherwise 422 `SCOPE_NOT_ASSIGNED` — plan sections
   are not assignable and are released only through Dead Man Switch or
   emergency grants), that videos in scope are `IMMEDIATE` (§ 4), and stores
   only the SHA-256 hash; the plaintext link (`/access?t=…`) is emailed and shown once.
2. The recipient opens the link. The public `/access` page immediately calls
   `POST /api/v1/access/exchange` with the token, removes it from the URL,
   and receives an encrypted httpOnly cookie scoped to `/api/v1/access`
   (30-minute sliding lifetime, never beyond the token's expiry). First use
   sets `usedAt` and moves a PENDING beneficiary to ACTIVE.
3. Resource endpoints (`/access/resources`, `/access/documents/:id[/download]`,
   `/access/assets/:type/:id`, `/access/videos/:id`,
   `/access/plan-sections/:section`) re-check revocation, expiry, scope and
   beneficiary status on every request; asset views never include encrypted
   fields; downloads use 15-minute signed URLs; every access is audited with
   the beneficiary as actor.
4. The owner can list and revoke tokens at any time; deactivating or removing
   the beneficiary revokes them; housekeeping expires them.

The same mechanism delivers Dead Man Switch releases (grant type
DMS_RELEASE — see the Dead Man Switch workflow) and emergency grants
(EMERGENCY_ACCESS — § 6).

## 6. Emergency access (US11, FR-J001–J010; Clarifications 2026-09-18)

**Designation.** The owner designates an existing (non-INACTIVE) beneficiary
as an emergency contact (`POST /emergency-access/contacts` →
`ea_configure_contact()`), choosing the access scope, the unreachable-owner
rule (`WAIT` default, `AUTO_GRANT` after N hours, or `DENY` after N hours),
request expiry (default 72 h) and access duration (default 72 h). The
contact receives a **designation email with a personal request link**
(re-sendable).

**Request.** From the link, the contact submits their email
(`POST /emergency-access/request`, public, rate-limited per IP and per
config). The email must match the beneficiary's; responses are generic so
nothing can be enumerated. A 6-digit **OTP** (15-minute expiry) is emailed;
`POST /emergency-access/verify` allows 3 attempts, then FAILED. The owner is
notified of the request (FR-J004).

**Decision.** The owner approves (reverified) or denies
(`ea_decide_request()`); approval issues an EMERGENCY_ACCESS token scoped
exactly to the configured scope and emails the access link. If the owner does
not act, the configured rule applies through housekeeping jobs:
AUTO_GRANT → granted, DENY → denied, WAIT → remains pending until the request
expires. The contact can check a generic status page.

**Access and end.** The contact uses the shared `/access` flow (§ 5); access
ends automatically at expiry (token revoked) or when the owner revokes it;
every event is audited (FR-J007, J009, J010). Request states are listed in
`data-model.md` § 15.

## 7. Protection summary

- Class B tables (`beneficiary_assignments`, `access_tokens`,
  `emergency_access_*`, `dead_man_switch_contacts`) accept writes only
  through guarded functions; beneficiary status changes and removals are
  functions too.
- Tokens never appear in request paths or logs; cookies are httpOnly,
  Secure, SameSite=Strict, path-scoped.
- Rate limits: `publicEmergency`, `accessExchange`, `tokenAccess` (ADR-007).

## 8. Verification

T226 (lifecycle, cascade), T229 (allocation invariants and races), T228
(document permissions and scopes), T236 (emergency lifecycle incl. all
timeout rules), T241 (end-to-end and authorization matrix); quickstart
scenarios 4.1, 5.1, 7.1, 7.2, 12.1.
