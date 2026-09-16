# Research: LegacyVault AI — Baseline Product

**Phase**: 0 — Outline & Research | **Date**: 2025-09-16

**Purpose**: Resolve all NEEDS CLARIFICATION items and document technology
decisions with rationale.

---

## Technical Context Resolution

All technical context items from the plan have been resolved. No NEEDS
CLARIFICATION markers remain.

---

## Decision 1: Database — PostgreSQL

**Decision**: PostgreSQL 16+ as the primary relational database.

**Rationale**:
- Strong ACID compliance required for transactional integrity (plan
  finalization, beneficiary changes, DMS state transitions).
- Rich JSON support (JSONB) for flexible metadata fields (asset metadata,
  plan step data, AI interaction records).
- Excellent TypeScript/Prisma ORM support.
- Strong encryption extensions (pgcrypto) for field-level encryption.
- Mature, battle-tested for legal-tech and financial applications.
- Excellent indexing capabilities for audit log queries.

**Alternatives Considered**:
- MongoDB: Better for unstructured data but weaker transactional guarantees
  and relational integrity; not ideal for allocation constraints and
  cross-entity consistency.
- MySQL: Viable but PostgreSQL has superior JSON support and extensibility.

---

## Decision 2: ORM — Prisma

**Decision**: Prisma as the TypeScript ORM for database access.

**Rationale**:
- Type-safe database queries with auto-generated TypeScript types.
- Declarative schema with migration management.
- Built-in connection pooling.
- Strong PostgreSQL support.
- Prevents raw SQL injection by default (parameterized queries).
- Active ecosystem and community.

**Alternatives Considered**:
- TypeORM: More flexible but less type-safe; decorator-based approach is
  less maintainable.
- Knex.js: Query builder only, no schema management or type generation.
- Drizzle: Newer, less mature, smaller ecosystem.

---

## Decision 3: Object Storage — S3-Compatible

**Decision**: S3-compatible object storage (AWS S3, MinIO for development,
or cloud-provider equivalent).

**Rationale**:
- Industry standard for private file storage.
- Supports signed/temporary URLs natively.
- Private bucket policies prevent public access.
- Encryption at rest (SSE-S3 or SSE-KMS).
- Supports large file uploads (multipart for videos up to 500 MB).
- Provider-agnostic with S3 API compatibility.

**Alternatives Considered**:
- Local filesystem: Not scalable, no signed URLs, no cloud backup.
- Azure Blob: Viable but S3 API is more universal.
- Google Cloud Storage: Viable, S3-compatible with interoperability.

---

## Decision 4: Authentication Strategy — Session-Based with httpOnly Cookies

**Decision**: Server-side sessions stored in PostgreSQL/Redis with httpOnly,
secure, sameSite cookies.

**Rationale**:
- httpOnly cookies prevent XSS-based token theft (constitution principle I).
- Server-side session store enables instant session revocation (FR-A015).
- SameSite=Strict prevents CSRF for most flows.
- No token stored in localStorage/sessionStorage (vulnerable to XSS).
- Session invalidation on password reset works immediately (FR-A011).
- Compatible with TOTP-based MFA.

**Alternatives Considered**:
- JWT with refresh tokens: Harder to revoke instantly, requires token
  blacklisting infrastructure, larger attack surface.
- JWT + httpOnly cookie: Possible but adds complexity of JWT management
  without clear benefit over session IDs.

---

## Decision 5: Session Store — Redis (Production) / PostgreSQL (Development)

**Decision**: Redis for session storage in production, PostgreSQL session table
for development simplicity.

**Rationale**:
- Redis provides fast session lookups with automatic TTL-based expiry.
- Reduces database load for session operations.
- PostgreSQL fallback for development avoids Redis dependency locally.
- Both support the same session interface via express-session adapters.

**Alternatives Considered**:
- PostgreSQL only: Viable but higher latency for session lookups at scale.
- In-memory store: Not suitable for multi-instance deployments.

---

## Decision 6: Background Jobs — Bull/BullMQ with Redis

**Decision**: BullMQ (Redis-backed job queue) for background processing.

**Rationale**:
- Dead Man Switch requires reliable scheduled jobs (check-in reminders,
  escalation timers).
- Notification delivery requires retry with backoff.
- AI processing can be long-running; queue-based processing prevents
  request timeouts.
- BullMQ provides: scheduling, retry, backoff, concurrency control,
  job persistence, and idempotency support.
- Redis already used for sessions; no additional infrastructure.

**Alternatives Considered**:
- node-cron: Simple but no persistence, no retry, no distribution.
- Agenda (MongoDB-backed): Requires MongoDB; we're using PostgreSQL.
- pg-boss (PostgreSQL-backed): Viable but Redis/BullMQ is faster and
  more feature-rich for complex scheduling.

---

## Decision 7: Email Service — Nodemailer with Provider Abstraction

**Decision**: Nodemailer with a configurable transport provider (SMTP for
development, SendGrid/SES/Resend for production).

**Rationale**:
- Provider-agnostic: transport can be swapped without code changes.
- SMTP transport for local development (Mailtrap/Mailhog).
- Production providers (SendGrid, AWS SES, Resend) are pluggable.
- Template-based emails with sanitized content.

**Alternatives Considered**:
- Direct provider SDKs: Lock-in; harder to swap.
- Postmark: Excellent but proprietary; Nodemailer is more flexible.

---

## Decision 8: Schema Validation — Zod

**Decision**: Zod for server-side request validation and frontend form
validation.

**Rationale**:
- Constitution mandates schema validation (principle X).
- TypeScript-first: schemas produce TypeScript types automatically.
- Composable: schemas can be shared between frontend and backend.
- Excellent error messages for API consumers.
- Lightweight with no dependencies.

**Alternatives Considered**:
- Joi: Well-established but no automatic TypeScript type inference.
- Yup: Less performant, less TypeScript-native than Zod.
- AJV (JSON Schema): More complex setup, less ergonomic for TypeScript.

---

## Decision 9: Frontend State Management — Zustand

**Decision**: Zustand for client-side state management.

**Rationale**:
- Lightweight, TypeScript-native, minimal boilerplate.
- Supports middleware (persist, devtools).
- Works well with Next.js App Router (client components).
- No provider wrappers needed (simpler component tree).
- Sufficient for form state, wizard state, and UI state.
- Server state managed by React Query/SWR for API data.

**Alternatives Considered**:
- Redux Toolkit: More complex, more boilerplate, overkill for this scope.
- Jotai: Atomic approach is good but less conventional for larger state.
- Context API: Causes unnecessary re-renders; not suitable for complex state.

---

## Decision 10: API Data Fetching — TanStack Query (React Query)

**Decision**: TanStack Query for server-state management and API data fetching.

**Rationale**:
- Automatic caching, refetching, and cache invalidation.
- Built-in loading/error/success states (reduces boilerplate).
- Optimistic updates for responsive UI.
- Pagination and infinite scroll support.
- Works with Next.js App Router.
- Reduces need for manual state management of API data.

**Alternatives Considered**:
- SWR: Similar but fewer features (no mutation support built-in).
- Plain fetch: Too much boilerplate for caching, loading states, retries.
- Next.js Server Components only: Insufficient for interactive features
  requiring client-side mutations and real-time updates.

---

## Decision 11: Field-Level Encryption — Application-Level AES-256-GCM

**Decision**: Application-level encryption using AES-256-GCM for sensitive
fields (credentials, account numbers, recovery info).

**Rationale**:
- Constitution requires AES-256 or equivalent (principle IV).
- GCM mode provides authenticated encryption (integrity + confidentiality).
- Application-level encryption allows key rotation without database changes.
- Encryption keys stored in environment variables / cloud secret manager,
  separate from data (FR-Q018).
- Prisma middleware can transparently encrypt/decrypt designated fields.

**Alternatives Considered**:
- PostgreSQL pgcrypto: Ties encryption to database; key management harder.
- AWS KMS: Excellent but adds cloud provider lock-in and latency per operation.
- Column-level TDE: Transparent but no application-level key management.

---

## Decision 12: PDF Generation — @react-pdf/renderer or Puppeteer

**Decision**: @react-pdf/renderer for will/document PDF generation on the
server, with Puppeteer as fallback for complex layouts.

**Rationale**:
- AI Will Generator requires PDF export (FR-M012).
- @react-pdf/renderer produces PDFs from React components (consistent with
  frontend skill set).
- Server-side rendering prevents client-side PDF manipulation.
- Puppeteer provides fallback for complex CSS-based layouts if needed.

**Alternatives Considered**:
- jsPDF: Limited layout capabilities for complex legal documents.
- html-pdf: Deprecated, security concerns.
- LaTeX: Overkill, requires additional system dependencies.

---

## Decision 13: AI Provider Integration Strategy

**Decision**: Abstract provider interface with concrete OpenAI and Gemini
implementations. Prompts managed as versioned templates.

**Rationale**:
- Constitution requires provider abstraction (principle VI).
- Common interface enables hot-swapping between providers.
- Versioned prompts enable A/B testing and reproducibility.
- Structured output parsing standardizes response handling.
- Token counting per provider for cost control.
- Separate services per use case (assistant, will gen, doc analysis)
  isolate prompts and context management.

**Alternatives Considered**:
- LangChain: Adds significant abstraction overhead; our use cases are
  well-defined enough for direct SDK usage with a thin abstraction.
- Vercel AI SDK: Good for streaming but opinionated; thin custom
  abstraction provides more control.

---

## Unresolved Items

No unresolved NEEDS CLARIFICATION items remain. All decisions are documented
with rationale and alternatives.
