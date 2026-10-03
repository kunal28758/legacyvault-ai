<!--
SYNC IMPACT REPORT
Version change: 2.0.1 → 3.0.0
Amendment date: 2026-10-04
Proposal / rationale: docs/ARCHITECTURE_DECISIONS.md ADR-017 (supersedes
  ADR-015) — owner decision to remove malware scanning.
Bump rationale: MAJOR — a requirement is REMOVED from Principle XI.
Modified principles:
  - XI. API and Web Security — REMOVED: "MUST integrate malware-scanning hooks
    for production file-processing workflows". File type, size, extension and
    content (magic-byte) validation remains mandatory.
  - Technology Stack table — object storage flow "quarantine → promote" →
    "validate → promote".
Impact reviewed: uploads go straight to private buckets and are promoted only
  after validation; nothing may claim a file was scanned; FR-H016 / FR-Q011
  are recorded as not met (docs/product/REQUIREMENTS_TRACEABILITY.md).
Unchanged: every other principle and section.

---- Report for 2.0.1 ----
Version change: 2.0.0 → 2.0.1 (same day)
Bump rationale: PATCH — clarification only. Principle IX wording "all frontend
  and backend code" → "all application code (presentation and server-side)" to
  match the single-application architecture. No requirement changed.

---- Report for 2.0.0 ----
Version change: 1.0.0 → 2.0.0
Amendment date: 2026-09-18
Proposal / rationale: docs/ARCHITECTURE_DECISIONS.md ADR-012 (with ADR-001..011)
Bump rationale: MAJOR — Principle VIII and the Technology Stack section are
  redefined: the mandated separate Express.js backend is REMOVED in favour of a
  single Next.js application whose Route Handlers serve the versioned REST API.

Modified principles:
  - III. Authentication and Authorization — ADDED: delegation of
    authentication to a managed identity provider (Clerk) is permitted;
    authorization remains enforced by this platform's server code.
  - VIII. Architecture — REDEFINED: one Next.js 16 application; backend =
    Route Handlers / Server Components / Server Actions on the Node.js runtime;
    layering (handlers → services → repositories) and versioned REST retained.
  - Technology Stack — REDEFINED: adds Clerk, Supabase PostgreSQL, Supabase
    Storage, Postgres job table + Vercel Cron, Resend, Sentry, Vercel; removes
    Express.js as a mandated component.
Removed sections: none
Unchanged: I, II, IV–VII, IX–XXII, Development Workflow Process, Governance
  (no functional or security requirement removed or weakened).
Ratified date corrected: 2025-09-16 → 2026-09-16 (typo; initial commit is
  dated 2026-09-16 per git history).
Follow-up TODOs: T203 (verify Clerk event coverage for FR-A014 failed sign-in
  logging) — see specs/001-baseline-product-spec/tasks.md.

---- Previous report (1.0.0) ----
Version change: 0.0.0 → 1.0.0
Bump rationale: MAJOR — initial adoption of the project constitution.

Added sections:
  - I. Security First
  - II. Privacy and Data Protection
  - III. Authentication and Authorization
  - IV. Encryption and Secure Storage
  - V. Legal-Tech Safety
  - VI. AI Safety and Reliability
  - VII. Data Integrity and Business Rules
  - VIII. Architecture
  - IX. Code Quality
  - X. Validation and Error Handling
  - XI. API and Web Security
  - XII. Auditability
  - XIII. UI/UX
  - XIV. Accessibility and Responsiveness
  - XV. Performance
  - XVI. Observability
  - XVII. Testing
  - XVIII. Documentation
  - XIX. Git and Change Management
  - XX. Development Workflow
  - XXI. Production Readiness
  - XXII. Decision-Making Principle
  - Technology Stack
  - Development Workflow Process
  - Governance

Removed sections: none
Modified principles: none (initial adoption)
Follow-up TODOs: none
-->

# LegacyVault AI Constitution

LegacyVault AI is a security-first legal-tech SaaS platform that helps users
securely organize, manage, protect, and transfer their digital and physical
legacy information to authorized beneficiaries. The platform handles highly
sensitive data including personal identity, family relationships, beneficiary
designations, financial and digital assets, property records, legal documents,
private files, authentication credentials, and AI-generated drafts. Every
engineering decision MUST reflect this sensitivity.

## Core Principles

### I. Security First

Security and privacy are first-class requirements in every feature, component,
and workflow.

- MUST apply secure defaults throughout the system.
- MUST NOT expose secrets, API keys, tokens, credentials, encryption keys, or
  sensitive configuration to the frontend or source control.
- MUST follow least-privilege access in all service and user contexts.
- MUST apply defense-in-depth: no single control may be the sole barrier to a
  breach.
- All security-sensitive operations MUST be authenticated, authorized,
  validated, logged, and auditable.

### II. Privacy and Data Protection

User legacy data is among the most sensitive personal information a platform can
hold. Treat it accordingly.

- MUST treat all user legacy data as highly sensitive by default.
- MUST minimize data collection to what is strictly necessary.
- MUST protect sensitive data at rest and in transit.
- MUST NOT expose one user's data to another user under any circumstance.
- MUST NOT use production user data for development or testing without explicit
  authorization and appropriate anonymization or protection measures.

### III. Authentication and Authorization

Access control is non-negotiable and MUST be enforced server-side.

- MUST use strong authentication mechanisms (multi-factor where appropriate).
- MUST implement secure session and token management with appropriate expiry,
  rotation, and revocation.
- MUST enforce authorization on the server for every protected resource and
  operation.
- MUST implement Role-Based Access Control (RBAC) supporting: Super Admin,
  Organization Admin, Team Manager, and Employee/User roles where applicable.
- Frontend route protection MUST NOT be considered a substitute for backend
  authorization. Frontend guards are UX affordances only.
- Authentication MAY be delegated to a managed identity provider (baseline:
  Clerk). Exactly one application authentication system MUST exist.
  Delegation does not delegate authorization: role and resource-ownership
  checks, audit logging, and step-up re-verification for sensitive operations
  MUST be enforced by this platform's own server-side code on every protected
  operation.

### IV. Encryption and Secure Storage

Sensitive data and documents MUST be protected with strong, modern cryptography.

- MUST encrypt sensitive data at rest using industry-standard algorithms
  (AES-256 or equivalent).
- MUST encrypt data in transit using TLS 1.2+ for all connections.
- MUST use secure key management practices; encryption keys MUST NOT be
  hard-coded or stored alongside the data they protect.
- Files MUST be stored with private access controls; public bucket access is
  forbidden.
- Temporary or signed URLs SHOULD be used for time-limited access where
  appropriate.
- MUST NOT store secrets, credentials, or private keys directly in source code.

### V. Legal-Tech Safety

LegacyVault AI assists users with legacy planning but MUST NOT overreach into
the domain of licensed legal practice.

- MUST NOT represent AI-generated content as guaranteed legal advice or
  guaranteed legal validity.
- MUST clearly distinguish informational assistance from professional legal
  counsel.
- Users MUST be able to review and explicitly confirm important legal and legacy
  information before it becomes an authoritative record.
- AI MUST NOT silently modify, overwrite, or delete legal records or
  beneficiary designations without explicit user action and confirmation.

### VI. AI Safety and Reliability

AI capabilities MUST be reliable, transparent, and safely integrated.

- MUST use a provider-abstraction layer so AI providers (OpenAI, Google Gemini,
  or others) can be swapped without rewriting application logic.
- AI provider API keys MUST remain server-side; MUST NOT be sent to or stored
  on the client.
- AI responses SHOULD be validated for correctness and completeness where
  practical.
- MUST detect and flag unsupported claims, missing information, uncertainty, and
  potentially hallucinated content in AI outputs.
- Important AI-generated content (legal drafts, beneficiary suggestions, asset
  summaries) MUST require explicit user confirmation before being persisted.
- AI MUST communicate uncertainty honestly; it MUST NOT invent facts, fabricate
  references, or present speculation as established information.

### VII. Data Integrity and Business Rules

Critical business operations MUST be correct, consistent, and recoverable.

- Critical workflows MUST enforce explicit validation and transactional
  integrity (atomicity, consistency).
- Beneficiary allocation MUST follow defined business rules and percentage
  constraints.
- Dead Man Switch workflows MUST include recovery mechanisms and verification
  safeguards.
- Emergency access MUST require appropriate multi-step verification and
  authorization.
- Document-level permissions MUST be enforced server-side, independent of
  frontend state.
- Audit logs MUST record all security-sensitive and legally significant actions
  with sufficient detail for forensic review.

### VIII. Architecture

Maintain strict separation of concerns between presentation and server-side
business logic, within a single Next.js application.

- **Application**: one Next.js 16+ (App Router) + React + TypeScript
  application at the repository root. There is no separate backend service
  in the baseline release.
- **Frontend**: React Server/Client Components, Tailwind CSS, shadcn/ui,
  Framer Motion, GSAP.
- **Backend**: Next.js Route Handlers (Node.js runtime) serving the versioned
  REST API, plus Server Components and Server Actions, all in TypeScript.
- Server-side code MUST use a modular layered architecture: route handlers
  (thin) → services → repositories, with shared request pipeline (auth, CSRF
  check, rate limiting, validation, error mapping), validators, configuration,
  utilities, background-job handlers, and AI service modules.
- MUST expose versioned REST APIs under `/api/v1/...` via Route Handlers.
- Business logic MUST NOT reside in UI components, Route Handlers, Server
  Components, or Server Actions directly; it MUST live in service modules.
  Server Components and Server Actions MUST call the same service layer the
  API uses.
- Managed platform services (identity, database, object storage, email,
  monitoring) MUST be accessed only through server-side adapter modules so
  they can be replaced without rewriting business logic.
- MUST prefer reusable, testable, composable modules over monolithic
  implementations.
- Architecture changes MUST be recorded in `docs/ARCHITECTURE_DECISIONS.md`
  before implementation.

### IX. Code Quality

Code MUST be clear, maintainable, and consistently structured.

- MUST use TypeScript for all application code (presentation and server-side).
- MUST prefer strongly typed interfaces and explicit contracts over implicit
  `any` types.
- MUST follow consistent naming conventions and folder structures across the
  codebase.
- MUST NOT introduce unnecessary code duplication; extract shared logic into
  common modules.
- MUST NOT introduce new dependencies without clear justification and review.
- MUST NOT rewrite working modules unnecessarily; prefer targeted modifications.

### X. Validation and Error Handling

All untrusted input MUST be validated server-side before processing.

- MUST validate all request payloads, query parameters, path parameters, and
  file uploads on the server using schema validation (Zod or equivalent).
- MUST implement centralized error handling middleware that produces safe,
  consistent error responses.
- MUST NOT leak stack traces, internal database details, file paths, secret
  values, or implementation details to clients in error responses.
- Client-side validation is a UX enhancement only and MUST NOT be relied upon
  for security.

### XI. API and Web Security

APIs MUST be protected against common web attack vectors.

- MUST protect against authentication bypass, authorization flaws, injection
  attacks (SQL, NoSQL, command), XSS, and insecure direct object references.
- MUST apply CSRF protection where applicable (session-based endpoints).
- MUST apply rate limiting to authentication endpoints, sensitive operations,
  and public-facing APIs.
- MUST validate file type, size, extension, and content (magic bytes) before
  processing uploads.
- MUST protect against brute-force attacks on login, password reset, and
  verification endpoints.

### XII. Auditability

Security-sensitive and legally significant operations MUST be fully auditable.

- MUST maintain audit logs for: authentication events, document access and
  modifications, permission changes, beneficiary changes, emergency access
  invocations, Dead Man Switch events, and other critical operations.
- Audit records MUST be tamper-resistant or stored with appropriate integrity
  protections (append-only, signed, or externally backed up).
- Audit data MUST include actor identity, timestamp, action performed, affected
  resource, and outcome.

### XIII. UI/UX

Build a premium, futuristic legal-tech SaaS interface that inspires trust.

- MUST implement a dark-first visual system with glassmorphism, subtle
  gradients, blue/purple/cyan accent palette, strong typography, and restrained
  visual effects.
- MUST use Framer Motion and GSAP for meaningful, purposeful animations that
  enhance comprehension and user confidence.
- Animations MUST NOT compromise accessibility, performance, usability, or
  security.
- MUST respect `prefers-reduced-motion` user preferences.
- UI MUST clearly communicate system state, loading conditions, errors, and
  confirmations.

### XIV. Accessibility and Responsiveness

The platform MUST be usable by all users across all common devices.

- MUST use semantic HTML elements and proper ARIA attributes.
- MUST support full keyboard navigation for all interactive elements.
- MUST maintain WCAG 2.1 AA contrast ratios at minimum.
- MUST support responsive layouts across desktop, tablet, and mobile
  breakpoints.
- MUST NOT rely solely on color to communicate state, errors, or information.

### XV. Performance

The platform MUST be fast and resource-efficient without compromising security
or privacy.

- MUST optimize frontend bundle size, image assets, rendering paths, and API
  request patterns.
- MUST optimize database queries, indexes, and file operations on the backend.
- Caching MUST only be used where correctness and user-data privacy are
  preserved; MUST NOT cache sensitive user data in shared or public caches.
- MUST avoid unnecessary client-side JavaScript execution.
- MUST lazy-load expensive features, heavy libraries, and below-the-fold
  content where appropriate.

### XVI. Observability

Production systems MUST be observable and debuggable without violating user
privacy.

- MUST implement structured logging with correlation IDs across requests.
- MUST implement error monitoring and alerting for production environments.
- MUST NOT log passwords, tokens, encryption keys, private document content, or
  unnecessary sensitive user data.
- Production monitoring and debugging MUST NOT require access to raw user data.

### XVII. Testing

Critical business logic and security-sensitive flows MUST have automated test
coverage.

- MUST provide automated tests for: authentication and authorization flows,
  beneficiary allocation logic, document permission enforcement, Dead Man
  Switch workflows, emergency access procedures, AI response validation, and
  encryption/decryption operations.
- Security regressions MUST be treated as blocking issues that prevent release.
- Test data MUST NOT contain real user information or production secrets.

### XVIII. Documentation

Important decisions and system knowledge MUST be documented and maintained.

- MUST document architectural decisions, business rules, security policies, AI
  integration details, API contracts, database schemas, and deployment
  procedures.
- MUST maintain a project knowledge document at `docs/BRAIN.md`.
- Documentation MUST clearly distinguish implemented functionality from planned
  or proposed functionality.
- MUST NOT claim a feature is implemented unless the current codebase confirms
  it.

### XIX. Git and Change Management

Source control practices MUST protect sensitive data and maintain a clean
history.

- Commits MUST be focused, meaningful, and describe what changed and why.
- MUST NOT commit secrets, credentials, private keys, `.env` files containing
  secrets, or sensitive user data to the repository.
- MUST prefer small, reviewable changes over large monolithic commits.
- MUST preserve working functionality unless a change is explicitly required and
  tested.

### XX. Development Workflow

All significant work MUST follow Spec-Driven Development.

- MUST follow the workflow: Constitution → Specification → Clarification →
  Plan → Checklist → Tasks → Analysis → Implementation → Convergence.
- MUST NOT begin large implementation work without an approved specification
  and implementation plan.
- Before implementation, MUST inspect the existing project structure and reuse
  working components where appropriate.
- Before declaring a feature complete, MUST validate it against its
  specification.

### XXI. Production Readiness

Production deployments MUST meet minimum security and operational standards.

- MUST use HTTPS/TLS for all production traffic.
- Secrets MUST be managed through secure environment or configuration
  management systems (not `.env` files committed to source control).
- MUST have database backup and disaster recovery procedures in place.
- MUST apply secure HTTP headers (HSTS, CSP, X-Frame-Options, etc.).
- MUST apply rate limiting and appropriate WAF/API protection.
- MUST implement production monitoring, alerting, and dependency/security
  scanning.
- Development, staging, and production environments MUST remain appropriately
  isolated.

### XXII. Decision-Making Principle

When requirements conflict, prioritize in this order:

1. **Security and Privacy**
2. **Data Integrity**
3. **Correctness**
4. **Legal-Tech Safety**
5. **Maintainability**
6. **Accessibility**
7. **Performance**
8. **Visual Polish**

This hierarchy MUST guide all trade-off decisions. A visually beautiful feature
that compromises security or data integrity is unacceptable.

## Technology Stack

Baseline (v1) stack. Rationale and alternatives for each row are recorded in
`docs/ARCHITECTURE_DECISIONS.md` (ADR numbers in the last column).

| Layer                 | Technologies                                                                 | ADR |
|-----------------------|------------------------------------------------------------------------------|-----|
| Application           | Next.js 16+ (App Router), React, TypeScript — single application             | 001 |
| Frontend              | Tailwind CSS, shadcn/ui, Framer Motion, GSAP, TanStack Query, Zustand        | 001 |
| API                   | Next.js Route Handlers, versioned REST (`/api/v1/...`), JSON envelope        | 001 |
| Validation            | Zod (server-side mandatory; shared with client forms)                        | 001 |
| Authentication        | Clerk (sole application auth provider: sessions, MFA, reverification)        | 003 |
| Authorization         | Server-side service-layer checks (primary) + PostgreSQL RLS (defense-in-depth) | 004 |
| Database              | PostgreSQL (Supabase-managed), SQL migrations via Supabase CLI, no ORM       | 002 |
| Object storage        | Supabase Storage, private buckets, signed URLs, validate → promote flow      | 005 |
| Background processing | PostgreSQL job table + Vercel Cron (+ `pg_cron` redundancy); no Redis/BullMQ | 006 |
| Rate limiting         | Clerk attack protection + Vercel WAF + Postgres-backed app limiter           | 007 |
| AI                    | OpenAI, Google Gemini via in-house provider abstraction; structured outputs  | 008 |
| Email                 | Provider abstraction; Resend baseline (React Email templates)                | 009 |
| Monitoring            | Sentry, structured JSON logging with correlation IDs, health checks, metrics | 010 |
| Deployment            | Vercel (app) + Supabase (database/storage) + Clerk; GitHub Actions CI        | 011 |

Components explicitly **not** part of the baseline: a separate Express.js
service, Prisma, AWS S3/MinIO, Redis/BullMQ, Supabase Auth, MongoDB. Any of
these may be introduced only through a new ADR that cites a concrete
requirement.

New dependencies MUST be justified, reviewed, and documented before adoption.
Framework or library upgrades MUST be tested against the existing test suite
before merging. Because Next.js 16 differs from earlier majors, contributors
and agents MUST consult `node_modules/next/dist/docs/` before writing
framework-facing code (see `AGENTS.md`).

## Development Workflow Process

All significant features MUST follow the Spec-Driven Development lifecycle:

```
Constitution → Specification → Clarification → Plan → Checklist
→ Tasks → Analysis → Implementation → Convergence
```

- **Constitution**: This document. The non-negotiable foundation.
- **Specification**: Detailed feature description, requirements, and
  constraints.
- **Clarification**: Targeted questions to resolve ambiguity before planning.
- **Plan**: Technical implementation plan with component breakdown.
- **Checklist**: Validation criteria derived from the specification.
- **Tasks**: Dependency-ordered, actionable implementation tasks.
- **Analysis**: Cross-artifact consistency and quality check.
- **Implementation**: Disciplined execution of the task list.
- **Convergence**: Final validation against the specification.

Skipping steps for trivial changes is acceptable; skipping steps for
security-sensitive or architecturally significant work is not.

## Governance

This constitution is the supreme governance document for the LegacyVault AI
project. All engineering decisions, code reviews, and AI agent behaviors MUST
comply with these principles.

- **Supremacy**: This constitution supersedes all other development practices,
  conventions, or agent instructions when conflicts arise.
- **Compliance Review**: Every pull request and code review MUST verify
  compliance with applicable principles. Reviewers MUST flag violations.
- **Amendment Procedure**: Amendments require:
  1. Written proposal documenting the change and its rationale.
  2. Review of impact on existing code, security posture, and dependent
     workflows.
  3. Version bump following semantic versioning (MAJOR for removals or
     redefinitions, MINOR for additions, PATCH for clarifications).
  4. Update of `LAST_AMENDED_DATE`.
- **Versioning**: Constitution versions follow MAJOR.MINOR.PATCH semantic
  versioning as defined above.
- **Guidance File**: Runtime development guidance is maintained at
  `docs/BRAIN.md`. This file is supplementary to the constitution and MUST NOT
  contradict it.
- **Agent Compliance**: All AI coding agents working on this repository MUST
  read and comply with this constitution before making changes. Agents MUST NOT
  introduce code that violates these principles.

**Version**: 3.0.0 | **Ratified**: 2026-09-16 | **Last Amended**: 2026-10-04
