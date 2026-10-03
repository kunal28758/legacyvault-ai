# Feature Specification: LegacyVault AI — Baseline Product

**Feature Directory**: `specs/001-baseline-product-spec`

**Created**: 2026-09-16

**Status**: Baseline Complete — Implementation Pending (baseline checkpoint `4cac2d3`, 2026-09-18; requirements frozen, Clarifications maintained)

**Input**: Baseline product specification for LegacyVault AI, an AI-Powered
Digital Legacy Platform. Security-first legal-tech SaaS covering digital will,
beneficiary management, asset management, document vault, Dead Man Switch,
emergency access, video legacy, AI assistant, AI will generator, AI document
analysis, security center, and administration.

## Clarifications

### Session 2026-09-16

- Q: Should the baseline release include multi-tenancy (organizations, teams, team managers) or focus exclusively on individual users? → A: Individual-user baseline; defer organizations/teams to a later phase; only Super Admin and User roles in v1.
- Q: When the Dead Man Switch triggers conditional release, what exactly is released to trusted contacts? → A: Only the specific documents, assets, and plan sections the user explicitly selected during Dead Man Switch configuration.
- Q: Do beneficiaries create platform accounts or receive access through external channels? → A: Beneficiaries receive secure, time-limited email links with scoped access tokens. No platform account required for beneficiaries in v1.
- Q: What are the maximum file size limits for document and video uploads? → A: Documents: 50 MB max; Videos: 500 MB max.

### Session 2026-10-04 (owner decision — ADR-017)

- Q: Must production file processing run a malware scanner (FR-H016, FR-Q011)? → A: No. The owner removed malware scanning entirely. Uploads are validated for type, extension, size and content (magic bytes) and stored in private buckets; nothing may claim a file was scanned. FR-H016 and FR-Q011 are withdrawn.

### Session 2026-09-18 (post-analysis remediation)

- Q: Are Dead Man Switch trusted contacts and emergency contacts separate concepts from beneficiaries? → A: No. Every external recipient — beneficiary, trusted contact, emergency contact — is a **Beneficiary record** owned by the user. A trusted contact is a beneficiary linked to the Dead Man Switch; an emergency contact is a beneficiary with an Emergency Access configuration ("emergency beneficiary" in FR-D010 means exactly this). All scoped access, regardless of trigger (direct share, Dead Man Switch release, emergency grant), is delivered through the same time-limited scoped access-token mechanism.
- Q: At what level are beneficiary allocation percentages recorded? → A: Per **resource assignment** (a specific financial/physical/digital asset, document, or video). The sum of allocations for one resource MUST NOT exceed 100 %. Beneficiary-level ("this beneficiary gets 40 % of everything") and category-level ("50 % of all financial assets") percentages are **not modeled** in the baseline; the UI MAY show a beneficiary's aggregate as an informational summary only. FR-D002 and FR-D004 are read accordingly.
- Q: What do beneficiary statuses mean and what happens on removal? → A: `PENDING` = created/invited, the beneficiary has not yet used any access link; `ACTIVE` = the beneficiary has successfully used an access link at least once, or the owner explicitly marked them active; `INACTIVE` = deactivated by the owner — no new access tokens may be issued and existing tokens are revoked. Removing a beneficiary (FR-D001, US3 scenario 4) MUST atomically delete their resource assignments, revoke their access tokens, remove them as a Dead Man Switch trusted contact, deactivate any Emergency Access configuration for them, soft-delete the record, and audit every step.
- Q: Can a user finalize a legacy plan that still has incomplete sections (US20 scenario 2 vs FR-C004)? → A: Yes, with explicit acknowledgment. Minimum for finalization: the Personal Details step is complete and the user has confirmed. All other incomplete sections MUST be listed to the user and finalization MUST record `acknowledgedIncomplete = true` together with the list of incomplete sections in the version snapshot and the audit entry. FR-C004 governs validation of data *entered* in a step, not mandatory completion of every step.
- Q: FR-B006 lists "session timeout" as a user security preference; the identity provider applies session lifetime instance-wide. How is this satisfied? → A: The server-side session lifetime remains a platform-wide setting (24 h inactivity). The user preference is an **application-enforced idle timeout**: the user selects 15 min / 30 min / 1 h / 4 h / off; the application signs the user out client-side after that idle period, bounded above by the platform lifetime. FR-B006 is satisfied by this idle-timeout preference plus login-notification and MFA settings.
- Q: How does an emergency contact start a request, which verification methods exist, and what happens when the owner does not respond? → A: (1) When an owner designates an emergency contact, the contact receives a designation email containing their personal request link; the same link is re-sendable from the owner's Emergency Access page. (2) Baseline verification method is **email OTP** (6 digits, 15-minute expiry, 3 attempts) sent to the beneficiary's recorded email; other factors (e.g. SMS OTP) are future work. (3) The owner configures the unreachable-owner rule per contact: `AUTO_GRANT` after N hours, `DENY` after N hours, or `WAIT` (default — the request stays pending until the owner decides or the request expires after 72 hours). Every outcome notifies both parties and is audited.
- Q: Which "plan sections" can be included in Dead Man Switch release scope and emergency access scope, and how are they viewed? → A: The section keys of the finalized legacy plan (personal-details, family-information, beneficiaries, financial-assets, physical-assets, digital-assets, witness-details, special-wishes, document-attachments). Only sections of the **latest finalized version** are ever released — never a draft. Recipients view a read-only rendering of each granted section through the same scoped access-token mechanism used for documents, assets and videos.
- Q: Does the baseline include in-browser video recording (US12 says "records or uploads")? → A: Baseline is **upload-only** (FR-K001). In-browser recording is deferred to the roadmap; the camera permission is not requested by the baseline application.
- Q: Is AI-assistant conversation history persisted? → A: No. History is session-scoped and held by the client for the duration of the conversation (sent with each message, max 20 prior turns). The platform stores only sanitized AI interaction records without message content, consistent with data minimization.
- Q: Which access grants may deliver a video message under each delivery condition (FR-K006)? → A: Strict mapping, enforced server-side on every video access and validated when a scope is configured or a token is issued: `IMMEDIATE` → any valid grant whose scope includes the video; `DEAD_MAN_SWITCH` → `DMS_RELEASE` grants only; `EMERGENCY_ACCESS` → `EMERGENCY_ACCESS` grants only. No hierarchical or cross-acceptance; a mismatch is rejected with `422 DELIVERY_CONDITION_MISMATCH`.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Secure Registration and Onboarding (Priority: P1)

A new user discovers LegacyVault AI and creates an account. They provide their
email, create a strong password, verify their email address, and optionally
enable multi-factor authentication. The onboarding wizard introduces the
platform's core capabilities and guides them to begin their legacy plan.

**Why this priority**: Without authentication and onboarding, no other feature
is accessible. This is the gateway to the entire platform.

**Independent Test**: Can be fully tested by registering a new account,
verifying the email, logging in, and confirming the onboarding flow displays.
Delivers a secured, verified user account.

**Acceptance Scenarios**:

1. **Given** a visitor on the registration page, **When** they submit a valid
   email and strong password, **Then** the system creates the account and sends
   a verification email.
2. **Given** a registered user with unverified email, **When** they click the
   verification link, **Then** the system marks the account as verified and
   allows login.
3. **Given** a verified user, **When** they log in with correct credentials,
   **Then** they see the onboarding wizard or their dashboard.
4. **Given** a user during onboarding, **When** they enable MFA, **Then** the
   system configures the second factor and confirms activation.
5. **Given** a user submitting a weak password, **When** the form is submitted,
   **Then** the system rejects the password and displays strength requirements.

---

### User Story 2 — Creating a Digital Legacy Plan (Priority: P1)

An authenticated user initiates a digital legacy plan (will). They progress
through a structured multi-step workflow: personal details, family information,
beneficiaries, financial assets, physical assets, digital assets, witness
details, special wishes, document attachments, and review. The system auto-saves
progress, detects missing information, and requires the user to explicitly
review and confirm before finalization.

**Why this priority**: The legacy plan is the central product offering. Without
it, the platform has no core value.

**Independent Test**: Can be fully tested by creating a legacy plan, progressing
through each step, saving drafts, and finalizing with explicit confirmation.
Delivers a structured, user-confirmed legacy plan.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they start a new legacy plan,
   **Then** the system creates a draft plan and presents the first step.
2. **Given** a user on any step, **When** they navigate away or idle, **Then**
   the system auto-saves their progress.
3. **Given** a user completing all steps, **When** they reach the review step,
   **Then** the system displays all entered information and highlights missing
   or incomplete sections.
4. **Given** a user on the review step, **When** they confirm and finalize,
   **Then** the system marks the plan as finalized, records a version snapshot,
   and logs the finalization event.
5. **Given** a user with a finalized plan, **When** they want to make changes,
   **Then** the system creates a new draft version preserving the previous
   finalized version.

---

### User Story 3 — Adding and Managing Beneficiaries (Priority: P1)

A user adds one or more beneficiaries to their account. Each beneficiary has a
name, relationship, contact information, and optional allocation percentage. The
user assigns beneficiaries to specific assets or documents. The system enforces
allocation constraints and requires confirmation before authoritative changes.

**Why this priority**: Beneficiaries are the recipients of legacy information.
Without them, the platform cannot fulfill its core purpose of legacy transfer.

**Independent Test**: Can be fully tested by adding beneficiaries, assigning
allocations, attempting invalid totals, and confirming changes. Delivers a
complete beneficiary roster with validated allocations.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they add a beneficiary with valid
   details, **Then** the system saves the beneficiary and displays it in their
   beneficiary list.
2. **Given** a user assigning allocation percentages, **When** the total for a
   given asset, document, or video exceeds 100%, **Then** the system rejects the change
   and displays the constraint violation.
3. **Given** a user modifying a beneficiary's allocation, **When** they confirm
   the change, **Then** the system records the change and creates an audit
   entry.
4. **Given** a user removing a beneficiary, **When** they confirm deletion,
   **Then** the system removes the beneficiary and unlinks them from all
   assigned assets and documents, logging the action.

---

### User Story 4 — Managing Financial Assets (Priority: P2)

A user records financial assets (bank accounts, investments, insurance,
retirement). Each asset has appropriate metadata, optional valuation, notes,
document references, and beneficiary assignments. The user can create, view,
update, and delete financial asset records.

**Why this priority**: Financial assets are the most common legacy item users
need to organize.

**Independent Test**: Can be fully tested by adding various financial asset
types, attaching metadata, assigning beneficiaries, and verifying data
persistence.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they add a bank account asset with
   valid details, **Then** the system saves it and shows it in their financial
   assets list.
2. **Given** a user with financial assets, **When** they assign a beneficiary
   to an asset, **Then** the system records the assignment and enforces
   allocation constraints.
3. **Given** a user updating an asset, **When** they save changes, **Then** the
   system updates the record and creates an audit entry.

---

### User Story 5 — Managing Physical Assets (Priority: P2)

A user records physical assets (real estate, vehicles, valuables, personal
property, business assets). Each asset supports metadata, ownership
information, valuation, notes, document references, and beneficiary assignment.

**Why this priority**: Physical assets are critical legacy items that
beneficiaries need to know about.

**Independent Test**: Can be fully tested by adding physical assets of various
types, attaching documents, and assigning beneficiaries.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they add a property asset with
   valid details, **Then** the system saves and displays it.
2. **Given** a user with physical assets, **When** they attach a supporting
   document, **Then** the system links the document to the asset record.

---

### User Story 6 — Managing Digital Assets (Priority: P2)

A user records digital assets (crypto wallets, online accounts, domains,
subscriptions, social accounts). Each asset supports appropriate metadata,
notes, document references, and beneficiary assignment. Sensitive credentials
are stored with encryption.

**Why this priority**: Digital assets are increasingly important and easily lost
upon incapacitation or death.

**Independent Test**: Can be fully tested by adding digital assets with
encrypted credential fields and assigning beneficiaries.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they add a crypto wallet asset
   with wallet address and recovery information, **Then** the system encrypts
   and stores the sensitive fields and displays the asset.
2. **Given** a user adding an online account, **When** they provide login
   credentials, **Then** the system encrypts the credentials before storage.

---

### User Story 7 — Secure Document Vault (Priority: P2)

A user uploads sensitive documents to the vault. The system validates file type,
size, extension, and content. Documents are encrypted and stored privately. The
user can organize documents into folders, assign permissions, grant beneficiary
access, preview supported formats, download, and manage versions. All access is
audited.

**Why this priority**: Documents (deeds, insurance policies, identification)
are essential evidence and reference material for legacy planning.

**Independent Test**: Can be fully tested by uploading a document, verifying
encryption and private storage, setting permissions, and downloading.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they upload a valid PDF document,
   **Then** the system validates the file, encrypts it, stores it privately,
   and displays it in the vault.
2. **Given** a user uploading a file with a mismatched extension and content
   type, **When** the upload is submitted, **Then** the system rejects it with
   a clear error message.
3. **Given** a user granting a beneficiary view access, **When** the
   beneficiary later accesses the document (via authorized workflow), **Then**
   the system logs the access event.
4. **Given** a user requesting a document, **When** the system generates a
   temporary access URL, **Then** the URL expires after the configured time
   limit.

---

### User Story 8 — AI Assistant for Legacy Planning (Priority: P2)

A user interacts with the AI assistant to get help with legacy planning. The
assistant guides them through workflows, explains terminology in plain language,
identifies missing information in their plan, and suggests planning
considerations. The assistant clearly communicates that it provides
informational guidance, not legal advice.

**Why this priority**: AI guidance differentiates the platform and reduces the
cognitive burden of legacy planning.

**Independent Test**: Can be fully tested by asking the assistant questions
about legacy planning and verifying helpful, appropriately disclaimed responses.

**Acceptance Scenarios**:

1. **Given** an authenticated user in the AI assistant, **When** they ask about
   setting up beneficiaries, **Then** the assistant provides a clear,
   non-technical explanation and links to the relevant workflow.
2. **Given** a user with incomplete plan sections, **When** they ask the
   assistant for help, **Then** the assistant identifies missing information
   and suggests next steps.
3. **Given** any AI response, **When** the response is displayed, **Then** a
   visible disclaimer indicates the information is not legal advice.

---

### User Story 9 — AI Will Generator (Priority: P3)

A user uses the AI will generator to draft a legacy document. They provide
information through natural-language input or structured fields. The AI
extracts details, generates a draft, highlights missing information and areas
of uncertainty, and presents the draft for review. The user edits, regenerates,
and explicitly confirms the final version before it is persisted as an
authoritative record.

**Why this priority**: Will generation is a high-value differentiator but
depends on the core plan and beneficiary infrastructure being in place first.

**Independent Test**: Can be fully tested by providing input, generating a
draft, editing, and confirming. Verifying that the AI marks uncertainties and
requires explicit confirmation.

**Acceptance Scenarios**:

1. **Given** a user with populated legacy plan data, **When** they request a
   will draft, **Then** the AI generates a draft using the plan data and
   highlights any gaps.
2. **Given** an AI-generated draft, **When** the user reviews it, **Then** the
   system clearly marks sections as AI-generated and requires explicit
   confirmation.
3. **Given** an AI-generated draft with uncertain content, **When** displayed,
   **Then** the AI flags uncertainty with confidence indicators and does not
   present speculation as fact.
4. **Given** a confirmed draft, **When** the user finalizes, **Then** the
   system saves it as a versioned document with an audit record.

---

### User Story 10 — Dead Man Switch Configuration (Priority: P3)

A user configures a Dead Man Switch by setting an inactivity period, check-in
frequency, trusted contacts, and conditional release rules. The system sends
periodic check-in notifications. If the user fails to respond, the system
escalates through defined steps. The user can cancel false triggers and recover
their account.

**Why this priority**: The Dead Man Switch is a unique, high-impact feature but
is complex and depends on core infrastructure.

**Independent Test**: Can be fully tested by configuring a switch, simulating
check-in responses and missed check-ins, and verifying escalation behavior.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they configure a Dead Man Switch
   with a 30-day inactivity period, **Then** the system saves the
   configuration and schedules the first check-in.
2. **Given** a check-in notification, **When** the user responds within the
   window, **Then** the system resets the inactivity timer and logs the
   check-in.
3. **Given** a missed check-in, **When** the grace period expires, **Then**
   the system sends escalation notifications according to the configured
   sequence.
4. **Given** a completed escalation reaching conditional release, **When**
   the system releases information, **Then** only the documents, assets, and
   plan sections the user explicitly selected during configuration are shared
   with the designated trusted contacts.
5. **Given** a false trigger, **When** the user returns and verifies their
   identity, **Then** the system cancels the escalation and logs the recovery.

---

### User Story 11 — Emergency Access (Priority: P3)

A user designates emergency contacts. When an emergency arises, a designated
contact requests access. The system requires multi-step identity verification,
notifies the account owner, grants time-limited access to authorized resources
only, and logs everything.

**Why this priority**: Emergency access is critical for the platform's promise
but requires auth, permissions, and audit systems first.

**Independent Test**: Can be fully tested by configuring emergency contacts,
simulating an emergency request, verifying identity, granting and revoking
access, and checking audit logs.

**Acceptance Scenarios**:

1. **Given** a user with configured emergency contacts, **When** an emergency
   contact requests access, **Then** the system initiates the verification
   workflow.
2. **Given** a verified emergency access request, **When** access is granted,
   **Then** the contact can view only the resources the user authorized, with
   a visible expiration timer.
3. **Given** an active emergency access session, **When** the expiration time
   passes, **Then** the system automatically revokes access and logs the
   expiration.
4. **Given** an emergency access request, **When** the account owner is
   reachable, **Then** the system notifies the owner and gives them the
   ability to approve or deny.

---

### User Story 12 — Video Legacy (Priority: P3)

A user uploads personal video messages for specific beneficiaries (in-browser
recording is deferred — see Clarifications 2026-09-18).
Videos are stored securely with encryption. The user controls which
beneficiaries can view which videos and under what conditions (immediately,
after Dead Man Switch trigger, after emergency access).

**Why this priority**: Video legacy adds emotional depth but depends on storage,
encryption, and permission infrastructure.

**Independent Test**: Can be fully tested by uploading a video, assigning it
to a beneficiary, and verifying secure storage and access controls.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they upload a video message,
   **Then** the system validates, encrypts, and stores it privately.
2. **Given** a video assigned to a beneficiary, **When** the delivery
   condition is met, **Then** the beneficiary can access the video through the
   authorized workflow.

---

### User Story 13 — AI Document Analysis (Priority: P3)

A user uploads a document for AI analysis. The system extracts text (including
OCR where appropriate), summarizes content, detects important information
(potential assets, beneficiary references, key dates), and presents findings
for user review. Nothing is persisted as authoritative without user
confirmation.

**Why this priority**: Document analysis adds intelligence to the vault but
depends on the document vault and AI infrastructure.

**Independent Test**: Can be fully tested by uploading a document, viewing AI
analysis results, confirming or rejecting findings.

**Acceptance Scenarios**:

1. **Given** a user with an uploaded document, **When** they request AI
   analysis, **Then** the system processes the document and presents a
   summary with detected information.
2. **Given** AI-detected assets or information, **When** the user reviews
   findings, **Then** they can confirm individual items to add them to their
   plan, or dismiss them.
3. **Given** uncertain AI findings, **When** displayed, **Then** the system
   flags confidence level and does not auto-persist uncertain data.

---

### User Story 14 — Security Center (Priority: P2)

A user accesses the Security Center to review their security posture. They can
view active sessions, login history, device information, manage password and
MFA settings, review suspicious activity alerts, and view security-related
audit history.

**Why this priority**: Given the sensitivity of legacy data, users need
visibility and control over their account security.

**Independent Test**: Can be fully tested by viewing sessions, revoking a
session, reviewing login history, and changing security settings.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they open the Security Center,
   **Then** they see their active sessions, recent login history, and security
   settings.
2. **Given** a user viewing active sessions, **When** they revoke a session,
   **Then** the system terminates that session and logs the action.
3. **Given** a suspicious login from a new device, **When** detected, **Then**
   the system notifies the user and optionally challenges the session.

---

### User Story 15 — Platform Administration (Priority: P3)

A Super Admin manages the platform: user management, role assignment, security
monitoring, audit log review, system analytics, and support operations.
Organization and team management are deferred to a future release.

**Why this priority**: Administration is essential for production operation but
does not block individual user functionality.

**Independent Test**: Can be fully tested by logging in as a Super Admin,
managing users, viewing audit logs, and verifying role-based access restrictions.

**Acceptance Scenarios**:

1. **Given** a Super Admin, **When** they access the admin dashboard, **Then**
   they see platform-wide user and system management controls.
2. **Given** a regular user, **When** they attempt to access admin routes,
   **Then** the system denies access both on the frontend and the backend.

---

### User Story 16 — Account Login and Session Security (Priority: P1)

An existing user logs in with their email and password (and MFA if enabled).
The system creates a secure session, tracks the device, and provides session
management. The user can log out, which invalidates the session. Suspicious
login attempts are detected and handled.

**Why this priority**: Login and session security are prerequisites for all
authenticated features.

**Independent Test**: Can be fully tested by logging in, verifying session
creation, logging out, and attempting access after logout.

**Acceptance Scenarios**:

1. **Given** a verified user, **When** they submit valid credentials, **Then**
   the system creates a secure session and redirects to the dashboard.
2. **Given** a user with MFA enabled, **When** they submit valid credentials,
   **Then** the system prompts for the second factor before granting access.
3. **Given** multiple failed login attempts, **When** the threshold is reached,
   **Then** the system applies rate limiting and optionally locks the account
   temporarily.
4. **Given** a logged-in user, **When** they log out, **Then** the session is
   invalidated server-side and they cannot access protected resources.

---

### User Story 17 — Account Recovery (Priority: P2)

A user who has lost access to their account can recover it through a secure
password reset flow (email verification) and, if MFA is configured, through
defined recovery mechanisms (backup codes, alternative verification).

**Why this priority**: Account recovery is critical because losing access to a
legacy platform could mean losing access to a lifetime of important records.

**Independent Test**: Can be fully tested by initiating password reset,
verifying the email link, setting a new password, and logging in.

**Acceptance Scenarios**:

1. **Given** a user who forgot their password, **When** they request a reset,
   **Then** the system sends a time-limited reset link to their verified email.
2. **Given** a valid reset link, **When** the user sets a new password, **Then**
   the system updates the password, invalidates all existing sessions, and
   allows login with the new password.
3. **Given** a user who lost their MFA device, **When** they use backup codes,
   **Then** the system allows recovery and MFA reconfiguration.

---

### User Story 18 — Assigning Assets and Documents to Beneficiaries (Priority: P2)

A user assigns specific assets or documents to specific beneficiaries with
defined allocation percentages. The system enforces allocation constraints,
prevents invalid assignments, and requires confirmation for changes.

**Why this priority**: Assignment links assets/documents to beneficiaries,
completing the legacy transfer model.

**Independent Test**: Can be fully tested by assigning assets to beneficiaries,
validating constraints, and confirming assignments.

**Acceptance Scenarios**:

1. **Given** a user with assets and beneficiaries, **When** they assign an
   asset to a beneficiary with 50% allocation, **Then** the system records
   the assignment.
2. **Given** a user assigning multiple beneficiaries to one asset, **When**
   the total exceeds 100%, **Then** the system prevents the assignment and
   explains the constraint.
3. **Given** any assignment change, **When** confirmed, **Then** the system
   logs the change in the audit trail.

---

### User Story 19 — Responding to Dead Man Switch Check-ins (Priority: P3)

A user receives a check-in notification from their configured Dead Man Switch.
They verify their identity and confirm they are active. The system resets the
timer. If they fail to respond, the escalation process begins.

**Why this priority**: Depends on Dead Man Switch configuration being
implemented first.

**Independent Test**: Can be fully tested by triggering a check-in, responding
successfully, and then simulating a missed response.

**Acceptance Scenarios**:

1. **Given** a scheduled check-in, **When** the user responds and verifies
   identity, **Then** the system resets the inactivity timer.
2. **Given** a missed check-in, **When** the reminder period expires, **Then**
   the system sends escalation notifications to trusted contacts.

---

### User Story 20 — Final Review and Legacy Plan Completion (Priority: P2)

A user reviews their entire legacy plan — all assets, beneficiaries, documents,
special wishes, and assignments — in a comprehensive review view. The system
highlights incomplete sections, unassigned assets, and beneficiaries without
allocations. The user confirms and finalizes their complete legacy plan.

**Why this priority**: The final review is how users gain confidence that their
legacy plan is complete and correct.

**Independent Test**: Can be fully tested by completing a plan and reviewing
the summary, verifying completeness indicators, and finalizing.

**Acceptance Scenarios**:

1. **Given** a user with a populated legacy plan, **When** they enter the
   review step, **Then** the system displays a complete summary with
   completeness indicators for each section.
2. **Given** an incomplete plan, **When** the user attempts to finalize,
   **Then** the system warns about incomplete sections but allows the user
   to proceed with acknowledgment.
3. **Given** a finalized plan, **When** the system saves it, **Then** a
   version snapshot is created and the finalization is logged.

---

### Edge Cases

- **Invalid beneficiary allocations**: What happens when a user assigns >100%
  allocation to a single asset? The system MUST reject the assignment and
  display the remaining available percentage.
- **Duplicate beneficiaries**: What happens when a user tries to add a
  beneficiary with the same email as an existing one? The system MUST warn
  the user and prevent duplicates.
- **Unauthorized document access**: What happens when a user attempts to access
  another user's document via URL manipulation? The system MUST deny access
  with a 403 response and log the attempt.
- **Expired emergency access**: What happens when an emergency contact tries to
  access resources after their access window has expired? The system MUST
  deny access and show an expiration message.
- **Dead Man Switch false trigger**: What happens when a user is simply
  unavailable (traveling, hospitalized) and misses a check-in? The system
  MUST use multi-step escalation with increasing urgency and provide identity-
  verified recovery at every stage.
- **Missed check-ins**: What happens when the notification delivery fails? The
  system MUST use multiple notification channels where possible and log
  delivery failures.
- **Lost account access**: What happens when a user loses both password and MFA
  device? The system MUST provide backup code recovery, and if that fails,
  offer a manual identity verification process.
- **AI uncertainty**: What happens when the AI generates content it is not
  confident about? The AI MUST flag low-confidence content with visible
  indicators and never present uncertain information as fact.
- **AI provider outage**: What happens when the AI provider is unavailable? The
  system MUST gracefully degrade, inform the user that AI features are
  temporarily unavailable, and allow all non-AI workflows to continue.
- **AI-generated incorrect information**: What happens when AI output contains
  errors? The user MUST review and confirm all AI-generated content before it
  is persisted; incorrect content can be edited or regenerated.
- **Failed uploads**: What happens when a file upload fails mid-transfer? The
  system MUST notify the user, clean up partial uploads, and allow retry.
- **Corrupted files**: What happens when an uploaded file passes extension/type
  checks but is corrupted? The system MUST detect corruption during
  processing and notify the user.
- **Duplicate assets**: What happens when a user adds an asset that appears to
  duplicate an existing one? The system SHOULD warn the user about potential
  duplicates but allow them to proceed.
- **Concurrent edits**: What happens when a user has multiple browser tabs
  editing the same plan? The system MUST detect conflicts and prevent
  silent data loss (last-write-wins with notification, or optimistic locking).
- **Notification failures**: What happens when email/SMS notifications fail to
  deliver? The system MUST log delivery failures and retry with backoff.
- **Database/service failures**: What happens during a database outage? The
  system MUST return clear error messages without leaking internal details and
  MUST NOT corrupt data.
- **Partial workflow completion**: What happens when a user abandons a
  multi-step workflow midway? The system MUST auto-save progress and allow
  resumption from the last completed step.

---

## Requirements *(mandatory)*

### A. Authentication and Account

- **FR-A001**: System MUST allow users to register with email and password.
- **FR-A002**: System MUST enforce password strength requirements (minimum 12
  characters, uppercase, lowercase, number, special character).
- **FR-A003**: System MUST send a verification email upon registration with a
  time-limited verification link.
- **FR-A004**: System MUST NOT allow login to unverified accounts.
- **FR-A005**: System MUST support email/password login with server-side
  credential validation.
- **FR-A006**: System MUST support MFA/2FA (TOTP-based authenticator app as
  the primary method).
- **FR-A007**: System MUST create secure server-side sessions upon successful
  authentication.
- **FR-A008**: Sessions MUST have configurable expiry (default: 24 hours)
  with automatic invalidation.
- **FR-A009**: System MUST support secure logout that invalidates the session
  server-side.
- **FR-A010**: System MUST support password reset via time-limited email link.
- **FR-A011**: System MUST invalidate all existing sessions upon password
  reset.
- **FR-A012**: System MUST detect and rate-limit repeated failed login
  attempts per account and per IP address.
- **FR-A013**: System MUST lock accounts temporarily after a configurable
  number of failed login attempts.
- **FR-A014**: System MUST log all authentication events (login, logout,
  failed attempts, password reset, MFA changes).
- **FR-A015**: System MUST allow users to view and manage active sessions
  (see device, location, revoke sessions).
- **FR-A016**: System MUST detect logins from new devices or unusual locations
  and notify the user.
- **FR-A017**: System MUST provide account recovery via backup codes when MFA
  device is lost.
- **FR-A018**: System MUST support re-authentication for sensitive operations
  (changing email, password, MFA, or viewing highly sensitive data).

### B. User Profile

- **FR-B001**: System MUST allow users to manage their personal information
  (name, date of birth, address, identification details).
- **FR-B002**: System MUST allow users to record family information (spouse,
  children, parents, dependents).
- **FR-B003**: System MUST allow users to manage contact information (phone,
  alternate email, address).
- **FR-B004**: System MUST allow users to configure preferences (language,
  date format, currency).
- **FR-B005**: System MUST allow users to configure notification preferences
  (email, in-app, frequency).
- **FR-B006**: System MUST allow users to configure security preferences
  (idle session timeout — application-enforced, see Clarifications 2026-09-18;
  login notifications; MFA settings).
- **FR-B007**: Profile changes to security-relevant fields (email, password)
  MUST require re-authentication.

### C. Digital Will / Legacy Plan

- **FR-C001**: System MUST provide a structured multi-step legacy plan
  workflow with the following steps: Personal Details, Family Information,
  Beneficiaries, Financial Assets, Physical Assets, Digital Assets, Witness
  Details, Special Wishes, Document Attachments, Review, Confirmation.
- **FR-C002**: System MUST auto-save progress at each step without requiring
  explicit save actions.
- **FR-C003**: System MUST support draft state; plans remain as drafts until
  explicitly finalized.
- **FR-C004**: System MUST validate each step before allowing progression,
  clearly indicating required fields.
- **FR-C005**: System MUST detect and highlight missing information across
  steps before review.
- **FR-C006**: System MUST present a comprehensive review step showing all
  entered information before finalization.
- **FR-C007**: System MUST require explicit user confirmation to finalize a
  plan; finalization MUST NOT happen automatically.
- **FR-C008**: System MUST maintain version history for finalized plans,
  preserving previous versions.
- **FR-C009**: System MUST allow users to create a new draft version from a
  finalized plan.
- **FR-C010**: System MUST allow users to have at most one active draft at a
  time (plus any number of finalized versions).
- **FR-C011**: System MUST allow users to navigate freely between completed
  steps without losing data.
- **FR-C012**: System MUST display completion status indicators for each step.

### D. Beneficiary Management

- **FR-D001**: System MUST allow users to create, read, update, and delete
  beneficiaries.
- **FR-D002**: Each beneficiary MUST have: full name, relationship to user,
  contact information (email, phone), and optional allocation percentages
  recorded per resource assignment (see Clarifications 2026-09-18).
- **FR-D003**: System MUST prevent adding duplicate beneficiaries (identified
  by email address).
- **FR-D004**: System MUST enforce that allocation percentages for a given
  resource (asset, document, or video) do not exceed 100% in total.
- **FR-D005**: System MUST display remaining allocation percentage when
  assigning beneficiaries.
- **FR-D006**: System MUST allow asset-specific beneficiary assignments
  (different beneficiaries per asset).
- **FR-D007**: System MUST support beneficiary status tracking (active,
  pending verification, inactive) with the lifecycle defined in Clarifications
  2026-09-18.
- **FR-D008**: System MUST require user confirmation before authoritative
  beneficiary changes (additions, removals, allocation changes).
- **FR-D009**: System MUST log all beneficiary changes in the audit trail
  (who changed what, when, previous value, new value).
- **FR-D010**: System MUST allow users to designate emergency beneficiaries
  (beneficiaries with an Emergency Access configuration) with specific access
  rights for emergency access workflows.
- **FR-D011**: Beneficiaries MUST NOT be required to create platform accounts.
  Access to assigned resources MUST be provided via secure, time-limited,
  scoped email tokens. Each token MUST grant access only to the specific
  resources assigned to that beneficiary.

### E. Asset Management — Financial

- **FR-E001**: System MUST allow users to record financial assets in these
  categories: bank accounts, fixed deposits, mutual funds, stocks/equities,
  insurance policies, retirement/pension accounts.
- **FR-E002**: Each financial asset MUST support: asset name, institution/
  provider, account/policy number (encrypted), asset type, estimated value
  (optional), currency, notes, document references, and beneficiary
  assignment.
- **FR-E003**: System MUST encrypt sensitive asset fields (account numbers,
  policy numbers) at rest.
- **FR-E004**: System MUST allow users to attach documents from the vault to
  any asset.
- **FR-E005**: System MUST log all asset creation, modification, and deletion
  events.

### F. Asset Management — Physical

- **FR-F001**: System MUST allow users to record physical assets in these
  categories: real estate, vehicles, gold/jewelry/valuables, personal
  property, business assets.
- **FR-F002**: Each physical asset MUST support: asset name, description,
  location, estimated value (optional), ownership details, notes, document
  references, and beneficiary assignment.
- **FR-F003**: System MUST allow multiple document attachments per physical
  asset (deeds, titles, appraisals).
- **FR-F004**: System MUST log all physical asset changes.

### G. Asset Management — Digital

- **FR-G001**: System MUST allow users to record digital assets in these
  categories: cryptocurrency wallets, online accounts, domains/websites,
  digital subscriptions, social media accounts, other digital assets.
- **FR-G002**: Each digital asset MUST support: asset name, platform/service,
  username/identifier, access credentials (encrypted), recovery information
  (encrypted), estimated value (optional), notes, and beneficiary assignment.
- **FR-G003**: System MUST encrypt all credential and recovery fields at rest
  using strong encryption.
- **FR-G004**: System MUST display encrypted fields as masked values; viewing
  plaintext MUST require re-authentication.
- **FR-G005**: System MUST log all digital asset changes, including credential
  views.

### H. Secure Document Vault

- **FR-H001**: System MUST allow users to upload documents (PDF, images, text
  files, common office formats).
- **FR-H002**: System MUST validate uploaded files for type, extension, size
  (maximum 50 MB per document), and content (magic byte verification).
- **FR-H003**: System MUST reject files that fail validation with clear error
  messages describing the rejection reason.
- **FR-H004**: System MUST encrypt all stored documents at rest.
- **FR-H005**: System MUST store documents with private access controls; no
  document may be publicly accessible.
- **FR-H006**: System MUST support folder-based organization within the vault.
- **FR-H007**: System MUST store document metadata (name, type, size, upload
  date, last modified, uploader).
- **FR-H008**: System MUST support preview for common file types (PDF, images)
  without requiring download.
- **FR-H009**: System MUST support secure document download via temporary
  signed URLs with configurable expiration.
- **FR-H010**: System MUST support document versioning; uploading a new version
  preserves previous versions.
- **FR-H011**: System MUST support document-level permissions (owner, shared
  beneficiaries, emergency contacts).
- **FR-H012**: Document permissions MUST be enforced server-side.
- **FR-H013**: System MUST allow users to grant or revoke beneficiary access
  to specific documents.
- **FR-H014**: System MUST support temporary access grants with expiration.
- **FR-H015**: System MUST log all document uploads, downloads, views,
  permission changes, and deletions.
- **FR-H016**: ~~System MUST integrate malware-scanning hooks for production
  file-processing workflows.~~ **Withdrawn 2026-10-04** (Clarifications,
  ADR-017).
- **FR-H017**: System MUST handle document deletion by removing access while
  maintaining audit records.

### I. Dead Man Switch

- **FR-I001**: System MUST allow users to configure a Dead Man Switch with:
  inactivity period (days), check-in frequency, trusted contacts, escalation
  rules, conditional release rules, and explicit selection of which documents,
  assets, and plan sections are included in the conditional release.
- **FR-I002**: System MUST send check-in notifications to the user at the
  configured frequency via configured notification channels.
- **FR-I003**: System MUST accept check-in responses with identity
  verification (password, MFA, or biometric where available).
- **FR-I004**: System MUST reset the inactivity timer upon successful check-in.
- **FR-I005**: System MUST implement a multi-step escalation sequence upon
  missed check-ins: reminder notification → secondary reminder → trusted
  contact notification → conditional release of user-selected resources only.
- **FR-I006**: System MUST allow configurable delays between escalation steps.
- **FR-I007**: System MUST provide a recovery mechanism at every escalation
  stage; a returning user who verifies identity MUST be able to cancel the
  escalation.
- **FR-I008**: System MUST require identity verification for escalation
  cancellation to prevent unauthorized cancellation.
- **FR-I009**: System MUST log all Dead Man Switch events (configuration
  changes, check-ins, missed check-ins, escalation steps, recoveries,
  releases).
- **FR-I010**: System MUST allow users to pause and resume the Dead Man Switch.
- **FR-I011**: System MUST clearly display the current Dead Man Switch status
  and next check-in date.
- **FR-I012**: System MUST allow users to explicitly select which documents,
  assets, and legacy plan sections are included in the conditional release
  scope. Only selected resources MUST be accessible to trusted contacts upon
  release; unselected resources MUST remain inaccessible.

### J. Emergency Access

- **FR-J001**: System MUST allow users to designate emergency contacts with
  specific access scopes (which documents, assets, or plan sections they may
  view).
- **FR-J002**: System MUST allow emergency contacts to request access through
  a defined workflow.
- **FR-J003**: System MUST require multi-step identity verification for
  emergency access requests (email verification + one-time code; baseline
  factor is email OTP — see Clarifications 2026-09-18).
- **FR-J004**: System MUST notify the account owner of all emergency access
  requests.
- **FR-J005**: If the owner is reachable, the system MUST allow the owner to
  approve or deny the request.
- **FR-J006**: If the owner is unreachable (configurable timeout), the system
  MUST follow the contact's pre-defined rule (auto-grant, deny, or wait — see
  Clarifications 2026-09-18) for granting or denying access.
- **FR-J007**: Granted emergency access MUST be time-limited with automatic
  expiration.
- **FR-J008**: Emergency access MUST be scoped to the resources the owner
  explicitly authorized; it MUST NOT provide full account access.
- **FR-J009**: System MUST log all emergency access events (request,
  verification, approval/denial, access, expiration, revocation).
- **FR-J010**: System MUST allow the account owner to revoke emergency access
  at any time.

### K. Video Legacy

- **FR-K001**: System MUST allow users to upload video messages (common formats:
  MP4, WebM, MOV).
- **FR-K002**: System MUST validate video files for type, size (maximum
  500 MB per video), and format.
- **FR-K003**: System MUST encrypt and store video files privately.
- **FR-K004**: System MUST allow users to add metadata to videos (title,
  description, intended recipient, delivery condition).
- **FR-K005**: System MUST allow users to assign videos to specific
  beneficiaries.
- **FR-K006**: System MUST support configurable delivery conditions
  (immediate upon trigger, after Dead Man Switch, upon emergency access).
- **FR-K007**: System MUST support video access expiration where configured.
- **FR-K008**: System MUST log all video access events.

### L. AI Assistant

- **FR-L001**: System MUST provide a conversational AI assistant accessible
  from within the platform.
- **FR-L002**: The AI assistant MUST be able to guide users through legacy
  planning workflows step by step.
- **FR-L003**: The AI assistant MUST explain legal and financial terminology
  in plain, non-technical language.
- **FR-L004**: The AI assistant MUST identify missing information in the
  user's legacy plan and suggest next steps.
- **FR-L005**: The AI assistant MUST suggest planning considerations the user
  may not have thought of (e.g., digital subscriptions, social media accounts).
- **FR-L006**: The AI assistant MUST answer product and process questions about
  LegacyVault AI.
- **FR-L007**: The AI assistant MUST clearly disclaim that it provides
  informational guidance, not legal advice, in every conversation.
- **FR-L008**: The AI assistant MUST communicate uncertainty honestly; it MUST
  NOT invent facts or fabricate legal references.
- **FR-L009**: AI assistant API calls MUST be made server-side; provider API
  keys MUST NOT be exposed to the client.
- **FR-L010**: *(Deferred — baseline release)* The AI assistant SHOULD
  support voice input where technically appropriate. This is a SHOULD-level
  requirement and is deferred to a future release. It is tracked in the
  project roadmap.

### M. AI Will Generator

- **FR-M001**: System MUST allow users to provide natural-language input for
  will/legacy document generation.
- **FR-M002**: System MUST extract structured information from natural-language
  input (beneficiaries, assets, wishes).
- **FR-M003**: System MUST generate a draft will/legacy document from
  extracted and existing plan data.
- **FR-M004**: System MUST suggest relevant clauses based on the user's asset
  profile and beneficiary structure.
- **FR-M005**: System MUST detect and highlight missing information required
  for a complete draft.
- **FR-M006**: System MUST present the draft for user review before any
  persistence.
- **FR-M007**: System MUST allow users to edit AI-generated content inline.
- **FR-M008**: System MUST allow users to regenerate the draft after edits or
  additional input.
- **FR-M009**: System MUST validate the draft for internal consistency
  (beneficiary names match records, assets exist, allocations are valid).
- **FR-M010**: System MUST require explicit user confirmation before saving an
  AI-generated draft as an authoritative record.
- **FR-M011**: System MUST maintain version history for AI-generated documents.
- **FR-M012**: System MUST support export/download of finalized documents in
  PDF format.
- **FR-M013**: All AI-generated content MUST be clearly labeled as
  AI-generated.
- **FR-M014**: System MUST display a disclaimer that AI-generated documents
  are informational and not guaranteed legal instruments.

### N. AI Document Analysis

- **FR-N001**: System MUST allow users to submit vault documents for AI
  analysis.
- **FR-N002**: System MUST securely pass document content to the AI provider
  via server-side API calls.
- **FR-N003**: System MUST support text extraction from PDFs and OCR from
  images where appropriate.
- **FR-N004**: System MUST generate a document summary highlighting key
  information.
- **FR-N005**: System MUST detect potential assets, beneficiary references,
  important dates, and financial figures within documents.
- **FR-N006**: System MUST flag uncertain or low-confidence findings with
  visible confidence indicators.
- **FR-N007**: System MUST require user confirmation before persisting any
  AI-detected information into the user's plan or asset records.
- **FR-N008**: System MUST NOT auto-persist AI analysis results.

### O. Security Center

- **FR-O001**: System MUST provide a Security Center dashboard showing the
  user's security status.
- **FR-O002**: System MUST display active sessions with device information,
  approximate location, and last activity time.
- **FR-O003**: System MUST allow users to revoke any active session.
- **FR-O004**: System MUST display login history (date, device, location,
  success/failure).
- **FR-O005**: System MUST provide password change functionality with
  re-authentication.
- **FR-O006**: System MUST provide MFA management (enable, disable,
  reconfigure, generate backup codes).
- **FR-O007**: System MUST display suspicious activity alerts (new device
  logins, failed attempts, unauthorized access attempts).
- **FR-O008**: System MUST display a security-related audit history
  (authentication events, permission changes, security setting changes).
- **FR-O009**: System SHOULD provide a security score or security status
  indicators based on configured security features (MFA enabled, strong
  password, recent review, etc.).

### P. Administration

- **FR-P001**: System MUST provide a Super Admin dashboard with platform-wide
  management capabilities.
- **FR-P002**: Super Admin MUST be able to view, search, and manage all user
  accounts.
- **FR-P003**: *(Deferred — multi-tenancy)* Super Admin MUST be able to manage
  organizations (create, configure, deactivate).
- **FR-P004**: Super Admin MUST be able to assign and revoke roles (Super Admin,
  User).
- **FR-P005**: Super Admin MUST be able to view platform-wide audit logs.
- **FR-P006**: Super Admin MUST be able to view system analytics (user
  registrations, active users, storage usage).
- **FR-P007**: Super Admin MUST be able to perform support operations (unlock
  accounts, reset MFA, investigate issues).
- **FR-P008**: *(Deferred — multi-tenancy)* Organization Admin MUST be able to
  manage members within their organization.
- **FR-P009**: *(Deferred — multi-tenancy)* Organization Admin MUST be able to
  view organization-level reports and settings.
- **FR-P010**: *(Deferred — multi-tenancy)* Team Manager MUST be able to manage
  members within their assigned team.
- **FR-P011**: All admin actions MUST be logged in the audit trail.
- **FR-P012**: Admin interfaces MUST enforce the same RBAC rules as the API;
  backend authorization MUST NOT rely on frontend route protection.

### Q. Security Requirements

- **FR-Q001**: System MUST enforce server-side authentication for all protected
  API endpoints.
- **FR-Q002**: System MUST enforce server-side authorization (RBAC) for all
  protected resources and operations.
- **FR-Q003**: System MUST encrypt sensitive data at rest using AES-256 or
  equivalent.
- **FR-Q004**: System MUST encrypt all data in transit using TLS 1.2+.
- **FR-Q005**: System MUST store documents with private access controls.
- **FR-Q006**: System MUST implement secure session management with
  httpOnly, secure, sameSite cookie attributes (or equivalent token security).
- **FR-Q007**: System MUST protect APIs against injection attacks (SQL, NoSQL,
  command injection), XSS, and CSRF where applicable.
- **FR-Q008**: System MUST apply rate limiting to authentication endpoints and
  sensitive operations.
- **FR-Q009**: System MUST validate all input server-side using schema
  validation.
- **FR-Q010**: System MUST validate file uploads for type, size, extension,
  and content before processing.
- **FR-Q011**: ~~System MUST integrate malware-scanning hooks for production file
  processing.~~ **Withdrawn 2026-10-04** (Clarifications, ADR-017).
- **FR-Q012**: System MUST maintain tamper-resistant audit logs for all
  security-sensitive operations.
- **FR-Q013**: System MUST NOT store secrets, API keys, credentials, or
  encryption keys in source code.
- **FR-Q014**: System MUST NOT expose one user's data to another user.
- **FR-Q015**: System MUST apply secure HTTP headers (HSTS, CSP,
  X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
- **FR-Q016**: System MUST NOT leak stack traces, database details, file paths,
  or internal implementation details in error responses.
- **FR-Q017**: System MUST implement structured logging without logging
  passwords, tokens, encryption keys, or private document content.
- **FR-Q018**: System MUST manage encryption keys separately from the data
  they protect.

### R. AI Safety Requirements

- **FR-R001**: System MUST implement a provider-abstraction layer supporting
  multiple AI providers (OpenAI, Google Gemini).
- **FR-R002**: AI provider API keys MUST remain server-side and MUST NOT be
  exposed to the client.
- **FR-R003**: System MUST validate AI responses for completeness and
  reasonable content where practical.
- **FR-R004**: System MUST detect and flag potentially hallucinated content,
  unsupported claims, and missing information in AI outputs.
- **FR-R005**: AI MUST communicate uncertainty with visible confidence
  indicators rather than presenting uncertain information as fact.
- **FR-R006**: System MUST require explicit user confirmation before persisting
  any AI-generated content as an authoritative record.
- **FR-R007**: AI MUST NOT silently modify, overwrite, or delete existing
  legal records, beneficiary designations, or asset records.
- **FR-R008**: AI MUST NOT fabricate legal references, case citations, or
  claim guaranteed legal validity.
- **FR-R009**: System MUST display a legal-tech disclaimer with all AI-
  generated legal/legacy content, clearly distinguishing informational
  assistance from professional legal counsel.
- **FR-R010**: System MUST gracefully degrade when AI providers are
  unavailable, allowing all non-AI workflows to continue.

### Key Entities

- **User**: A registered individual who owns a legacy plan. Attributes: name,
  email (unique), hashed password, MFA configuration, profile, preferences,
  verification status, role.
- **Organization**: *(Deferred to multi-tenancy phase)* An optional grouping
  of users (for enterprise/team use). Not included in the baseline data model.
- **Beneficiary**: A person designated to receive legacy information or assets.
  Attributes: name, relationship to user, contact info (email, phone),
  allocation percentages, status, verification status. Belongs to a User.
  Beneficiaries do not create platform accounts; they access assigned resources
  via secure, time-limited, scoped email tokens.
- **Financial Asset**: A financial instrument or account. Attributes: type,
  institution, account number (encrypted), value, currency, notes, beneficiary
  assignments. Belongs to a User.
- **Physical Asset**: A tangible asset. Attributes: type, description,
  location, value, ownership details, notes, beneficiary assignments. Belongs
  to a User.
- **Digital Asset**: A digital account, credential, or online resource.
  Attributes: type, platform, identifier, credentials (encrypted), recovery
  info (encrypted), value, notes, beneficiary assignments. Belongs to a User.
- **Document**: An uploaded file in the vault. Attributes: name, type, size,
  encrypted file reference, folder, metadata, permissions, versions. Belongs
  to a User.
- **Legacy Plan**: A structured will/legacy document. Attributes: steps data,
  status (draft/finalized), version, finalization date, confirmation record.
  Belongs to a User.
- **Video Message**: A video file for legacy delivery. Attributes: title,
  description, encrypted file reference, assigned beneficiaries, delivery
  condition, metadata. Belongs to a User.
- **Dead Man Switch**: An inactivity monitoring configuration. Attributes:
  inactivity period, check-in frequency, status, escalation rules, trusted
  contacts, last check-in, next check-in. Belongs to a User.
- **Emergency Access Config**: Emergency contact configuration. Attributes:
  contact details, verification requirements, access scope, status. Belongs
  to a User.
- **Emergency Access Request**: A specific access request instance.
  Attributes: requester, verification status, access scope, granted/denied,
  expiration, status.
- **Audit Log**: An immutable record of a security-sensitive or legally
  significant action. Attributes: actor ID, actor role, action, resource type,
  resource ID, timestamp, outcome, metadata.
- **AI Interaction**: A record of an AI conversation or generation session.
  Attributes: user, session type (assistant/generator/analysis), input
  summary, output summary, provider used, confirmation status.
- **Notification**: A system notification or alert. Attributes: recipient,
  type, content, channel, delivery status, timestamp.
- **Session**: An active user session. Attributes: user, token reference,
  device info, IP address, location, created at, last active, expiry.
  *(Managed by the identity provider; the platform stores no session tokens —
  it records session events in the audit log.)*

---

## Non-Functional Requirements

### Security

- **NFR-SEC-001**: All sensitive data MUST be encrypted at rest (AES-256 or
  equivalent) and in transit (TLS 1.2+).
- **NFR-SEC-002**: The system MUST undergo security review before production
  deployment.
- **NFR-SEC-003**: Security regressions MUST be treated as release-blocking
  issues.

### Privacy

- **NFR-PRV-001**: System MUST minimize data collection to what is strictly
  necessary for platform functionality.
- **NFR-PRV-002**: System MUST NOT use production user data for development or
  testing without explicit authorization and appropriate protection.
- **NFR-PRV-003**: Production monitoring MUST NOT require access to raw user
  data.

### Reliability

- **NFR-REL-001**: Critical workflows (plan finalization, beneficiary changes,
  Dead Man Switch check-ins) MUST use transactional integrity to prevent
  partial state corruption.
- **NFR-REL-002**: System MUST handle graceful degradation during partial
  service outages (e.g., AI unavailable, notification service down).

### Availability

- **NFR-AVL-001**: System SHOULD target 99.9% uptime for core functionality
  (authentication, plan management, document vault).
- **NFR-AVL-002**: Dead Man Switch check-in and escalation systems MUST have
  high availability; missed system-side notifications could trigger false
  escalations.

### Performance

- **NFR-PER-001**: Pages MUST load initial content within 3 seconds on
  standard broadband connections.
- **NFR-PER-002**: API responses for standard CRUD operations MUST complete
  within 500ms under normal load.
- **NFR-PER-003**: Document upload/download MUST support files up to 50 MB
  and video upload/download MUST support files up to 500 MB without timeout.
- **NFR-PER-004**: AI operations MUST provide progress indicators for
  long-running tasks.

### Scalability

- **NFR-SCL-001**: The system architecture MUST support horizontal scaling of
  the backend.
- **NFR-SCL-002**: The system MUST support at least 1,000 concurrent
  authenticated users without degradation.

### Accessibility

- **NFR-ACC-001**: The platform MUST meet WCAG 2.1 AA compliance.
- **NFR-ACC-002**: All interactive elements MUST be keyboard accessible.
- **NFR-ACC-003**: The platform MUST NOT rely solely on color to convey
  information.
- **NFR-ACC-004**: The platform MUST respect `prefers-reduced-motion` user
  preferences.

### Responsiveness

- **NFR-RSP-001**: The platform MUST support responsive layouts across
  desktop (1200px+), tablet (768px–1199px), and mobile (320px–767px).

### Maintainability

- **NFR-MNT-001**: All code MUST use TypeScript.
- **NFR-MNT-002**: The codebase MUST follow consistent naming conventions and
  folder structures.
- **NFR-MNT-003**: New dependencies MUST be justified and reviewed before
  adoption.

### Observability

- **NFR-OBS-001**: System MUST implement structured logging with correlation
  IDs.
- **NFR-OBS-002**: System MUST implement error monitoring and alerting for
  production.
- **NFR-OBS-003**: Logs MUST NOT contain passwords, tokens, encryption keys,
  or private document content.

### Auditability

- **NFR-AUD-001**: All security-sensitive and legally significant operations
  MUST produce audit records.
- **NFR-AUD-002**: Audit records MUST be tamper-resistant or stored with
  appropriate integrity protections.

### Disaster Recovery

- **NFR-DR-001**: The system MUST support database backups with configurable
  frequency.
- **NFR-DR-002**: A disaster recovery plan MUST be defined before production
  launch.

### Compliance Readiness

- **NFR-CMP-001**: The system architecture MUST support future compliance
  requirements (GDPR, CCPA, etc.) through data minimization, user consent
  management, and data export/deletion capabilities.

---

## UI/UX Requirements

- **UX-001**: The platform MUST implement a dark-first design system as the
  default theme.
- **UX-002**: The platform MUST support an optional light mode.
- **UX-003**: The design MUST use glassmorphism, subtle gradients, and
  restrained visual effects.
- **UX-004**: The color palette MUST use blue, purple, and cyan accents on
  dark backgrounds.
- **UX-005**: Typography MUST be strong, modern, and high-contrast with a
  clear hierarchy.
- **UX-006**: Animations MUST use Framer Motion for React component
  transitions and GSAP for complex sequences.
- **UX-007**: Animations MUST be meaningful and purposeful, enhancing
  comprehension and user confidence.
- **UX-008**: Animations MUST NOT compromise accessibility, performance,
  usability, or security.
- **UX-009**: The platform MUST respect `prefers-reduced-motion` user
  preferences by reducing or disabling animations.
- **UX-010**: Page transitions MUST be smooth and provide visual continuity.
- **UX-011**: Micro-interactions MUST provide feedback on user actions
  (button presses, form submissions, toggle changes).
- **UX-012**: Loading states MUST be visually clear (skeleton screens,
  spinners, progress bars) and never leave the user uncertain about system
  status.
- **UX-013**: Error states MUST be visually distinct, informative, and
  provide actionable guidance.
- **UX-014**: Success confirmations MUST be visible and unambiguous.
- **UX-015**: The layout MUST be responsive across desktop, tablet, and mobile.
- **UX-016**: All interactive elements MUST meet WCAG 2.1 AA contrast and
  focus requirements.
- **UX-017**: All interactive elements MUST be fully keyboard accessible.
- **UX-018**: The visual system MUST NOT compromise trust; the design MUST
  feel professional, secure, and appropriate for handling sensitive legal-tech
  information.

---

## API Requirements

The platform MUST expose a versioned REST API under `/api/v1/`. The following
API domains are required at the product level. Final endpoint definitions will
be specified during implementation planning.

| Domain           | Scope                                                    |
|------------------|----------------------------------------------------------|
| Authentication   | Register, login, logout, verify, reset, MFA, sessions    |
| Users            | Profile CRUD, preferences, security settings             |
| Beneficiaries    | CRUD, allocation, assignment, status                     |
| Financial Assets | CRUD, metadata, beneficiary assignment                   |
| Physical Assets  | CRUD, metadata, beneficiary assignment                   |
| Digital Assets   | CRUD, encrypted credentials, beneficiary assignment      |
| Documents        | Upload, download, metadata, permissions, versioning      |
| Legacy Plans     | CRUD, step progression, review, finalization, versioning |
| Dead Man Switch  | Configuration, check-in, status, escalation              |
| Emergency Access | Configuration, request, verify, grant, revoke            |
| Video Legacy     | Upload, metadata, assignment, delivery                   |
| AI               | Assistant chat, will generation, document analysis       |
| Notifications    | List, read, preferences                                  |
| Audit Logs       | Query, filter (admin and user-scoped)                    |
| Admin            | User management, roles, analytics, support operations    |

**API Security Requirements**:

- All endpoints MUST be authenticated except: identity-provider flows
  (register, login, verify, reset — provided by the identity provider),
  scoped access-token endpoints for beneficiaries/contacts (FR-D011, FR-I012,
  FR-J008), the public emergency-access request/verify endpoints (FR-J002,
  FR-J003), and the health check. Every unauthenticated endpoint MUST be
  rate-limited and MUST perform its own token/OTP verification.
- All endpoints MUST enforce authorization based on the requesting user's role
  and resource ownership.
- All endpoints MUST validate input using server-side schema validation.
- Sensitive endpoints MUST be rate-limited.
- Error responses MUST NOT leak internal details.

---

## Data Requirements

The following logical entities and relationships are required at the product
level. **PostgreSQL 16+** has been selected as the baseline relational
database (see research.md Decision 2 for rationale and alternatives).

### Entity Relationship Summary

```
User ──────┬── has many ──── Beneficiaries
            ├── has many ──── Financial Assets
            ├── has many ──── Physical Assets
            ├── has many ──── Digital Assets
            ├── has many ──── Documents
            ├── has many ──── Legacy Plans
            ├── has many ──── Video Messages
            ├── has one ───── Dead Man Switch Config
            ├── has many ──── Emergency Access Configs
            ├── has many ──── Sessions
            ├── has many ──── Notifications
            └── has many ──── AI Interactions

Organization ── has many ── Users (optional multi-tenancy)

Beneficiary ──── assigned to ──── Assets (with allocation %)
Beneficiary ──── granted access to ──── Documents
Beneficiary ──── assigned to ──── Video Messages

Document ──── attached to ──── Assets
Document ──── attached to ──── Legacy Plans

Audit Log ──── references ──── Actor (User/Admin) + Resource
```

### Data Protection Requirements

- User PII, asset details, and document content MUST be encrypted at rest.
- Credentials, recovery information, and secrets MUST be encrypted with
  strong encryption; decryption MUST require appropriate authorization.
- Audit logs MUST be append-only or integrity-protected.
- Sessions MUST have automatic expiry.

---

## Roles and Access

### Role-Level Access (Baseline)

The baseline release includes two roles: **Super Admin** and **User**.
Organization Admin and Team Manager roles are deferred to the multi-tenancy
phase.

| Capability                    | Super Admin | User |
|-------------------------------|:-----------:|:----:|
| Manage own profile/plan       | ✅          | ✅   |
| Manage own beneficiaries      | ✅          | ✅   |
| Manage own assets/documents   | ✅          | ✅   |
| View own audit history        | ✅          | ✅   |
| Manage all users              | ✅          | ❌   |
| Assign/revoke roles           | ✅          | ❌   |
| View platform-wide audit logs | ✅          | ❌   |
| View system analytics         | ✅          | ❌   |
| Perform support operations    | ✅          | ❌   |

### Resource-Level Permissions (Planned)

Resource-level permissions are independent of role and are enforced server-side:

- **Document access**: Owner has full control. Beneficiaries see only
  documents explicitly shared with them, accessed via time-limited scoped
  tokens (no platform account required). Emergency contacts see only documents
  within their authorized scope during active emergency access.
- **Asset access**: Owner has full control. Beneficiaries see only assets
  assigned to them (view-only, via scoped tokens).
- **Plan access**: Owner has full control. No direct beneficiary access to
  plan drafts.
- **Video access**: Owner has full control. Beneficiaries access assigned
  videos only when delivery conditions are met, via scoped tokens.

---

## Acceptance Criteria

### Authentication & Account

- AC-A1: A new user can register, verify email, log in, and access their
  dashboard within 3 minutes.
- AC-A2: MFA can be enabled and is enforced on subsequent logins.
- AC-A3: After 5 failed login attempts, the account is temporarily locked.
- AC-A4: Password reset invalidates all existing sessions.
- AC-A5: Users can view and revoke active sessions from the Security Center.

### Legacy Plan

- AC-C1: A user can create, progress through all steps, and finalize a legacy
  plan.
- AC-C2: Auto-save preserves data when the user navigates away mid-step.
- AC-C3: The review step displays all entered data and highlights missing
  information.
- AC-C4: Finalization requires explicit confirmation and creates a version
  snapshot.
- AC-C5: 90% of users can complete the plan creation workflow on their first
  attempt without external help.

### Beneficiary Management

- AC-D1: Users can add, edit, and remove beneficiaries.
- AC-D2: Allocation percentages exceeding 100% for any single asset are
  rejected with a clear message.
- AC-D3: All beneficiary changes produce audit log entries.
- AC-D4: Duplicate beneficiaries (by email) are prevented.

### Asset Management

- AC-E1: Users can create, view, update, and delete financial, physical, and
  digital assets.
- AC-E2: Sensitive fields (account numbers, credentials) are encrypted at rest
  and masked in the UI.
- AC-E3: Viewing encrypted fields requires re-authentication.
- AC-E4: Assets can be assigned to beneficiaries with validated allocations.

### Document Vault

- AC-H1: Users can upload, preview, and download documents.
- AC-H2: Invalid files (wrong type, too large, mismatched content) are
  rejected.
- AC-H3: Documents are encrypted at rest and served via signed URLs.
- AC-H4: Document permissions are enforced server-side; unauthorized access
  returns 403.
- AC-H5: All document access is logged.

### Dead Man Switch

- AC-I1: Users can configure a Dead Man Switch with custom inactivity period
  and check-in frequency.
- AC-I2: Check-in responses reset the inactivity timer.
- AC-I3: Missed check-ins trigger multi-step escalation.
- AC-I4: Users can cancel false triggers by verifying their identity.
- AC-I5: All Dead Man Switch events are logged.

### Emergency Access

- AC-J1: Emergency contacts can request access through a verification
  workflow.
- AC-J2: Granted access is time-limited and scoped to authorized resources.
- AC-J3: Account owners are notified of all emergency access events.
- AC-J4: Expired access is automatically revoked.

### AI Features

- AC-AI1: AI assistant provides helpful guidance with appropriate disclaimers.
- AC-AI2: AI will generator produces drafts that require user confirmation.
- AC-AI3: AI flags uncertain content with visible confidence indicators.
- AC-AI4: All non-AI workflows continue functioning during AI provider
  outages.
- AC-AI5: AI-generated content is never auto-persisted as an authoritative
  record.

### Security

- AC-Q1: No user data is accessible to other users via any API endpoint.
- AC-Q2: All sensitive data is encrypted at rest.
- AC-Q3: Error responses contain no internal details (stack traces, DB
  queries, file paths).
- AC-Q4: Rate limiting is active on authentication endpoints.
- AC-Q5: Audit logs record all security-sensitive operations.

### UI/UX

- AC-UX1: The platform renders correctly on desktop, tablet, and mobile.
- AC-UX2: All interactive elements are keyboard accessible.
- AC-UX3: Reduced-motion preferences disable non-essential animations.
- AC-UX4: Contrast ratios meet WCAG 2.1 AA requirements.

---

## Assumptions

- Users have stable internet connectivity (the platform is a web application).
- Users have access to email for verification and notifications.
- Users use modern web browsers (latest 2 versions of Chrome, Firefox, Safari,
  Edge).
- Mobile support refers to responsive web design, not native mobile apps.
  Native apps are out of scope for the baseline release.
- The platform will initially launch in English; internationalization (i18n)
  is a future consideration.
- Multi-tenancy (organizations, teams, Org Admin, Team Manager roles) is
  deferred to a future specification. The baseline includes only Super Admin
  and User roles.
- Payment/subscription management may be handled by a third-party service;
  detailed billing specification is deferred.
- The platform does not file legal documents on behalf of users; it provides
  informational assistance and document organization.

---

## Out of Scope / Future

The following are explicitly **out of scope** for the baseline product release
and MUST NOT be implemented unless separately specified:

- **Automated legal filing**: The platform does not file legal documents with
  courts or government agencies.
- **Guaranteed legal validity**: AI-generated content is informational; the
  platform does not guarantee legal enforceability.
- **Automatic asset transfers**: The platform does not execute financial
  transfers, property transfers, or asset liquidation.
- **Automatic financial transactions**: The platform does not connect to
  banking APIs to move money or execute trades.
- **Autonomous trading**: The platform does not trade, buy, or sell assets on
  behalf of users.
- **Unconfirmed AI mutation of legal records**: AI MUST NOT modify legal or
  legacy records without explicit user confirmation.
- **Native mobile applications**: iOS and Android apps are future work.
- **Internationalization (i18n/l10n)**: Multi-language support is deferred.
- **Advanced analytics/reporting**: Business intelligence dashboards beyond
  basic admin analytics are deferred.
- **Integration with external legal services**: API integrations with law
  firms, notaries, or legal databases are future work.
- **Blockchain-based verification**: Using blockchain for document
  verification or audit trail immutability is not in baseline scope.
- **Real-time collaboration**: Multiple users editing the same plan
  simultaneously is deferred.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete account registration and onboarding in under
  3 minutes.
- **SC-002**: 90% of users can create and finalize a basic legacy plan on
  their first attempt.
- **SC-003**: Document uploads complete within 10 seconds for files under 50MB
  on standard broadband.
- **SC-004**: API response times for CRUD operations remain under 500ms at
  1,000 concurrent users.
- **SC-005**: Zero cross-user data exposure incidents in security testing.
- **SC-006**: AI-generated will drafts include visible disclaimers and require
  user confirmation in 100% of cases.
- **SC-007**: Dead Man Switch false trigger rate is below 1% (verified
  through recovery mechanism usage).
- **SC-008**: The platform meets WCAG 2.1 AA compliance as verified by
  automated accessibility testing tools.
- **SC-009**: All security-sensitive operations produce audit log entries with
  zero gaps.
- **SC-010**: Platform achieves 99.9% uptime for core services during
  monitored periods.
