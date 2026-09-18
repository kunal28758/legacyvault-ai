# Coding Standards — LegacyVault AI

**Purpose**: The code conventions every contributor and agent follows,
collected from the constitution (Principles I, VIII–X, XV–XVII, XIX), the
plan's project structure, the task conventions in `tasks.md`, and the data
model's naming rules. Nothing here adds a requirement; where a rule comes from
an authoritative artifact it is cited.

**Status**: Applies from the first line of application code (none exists as of
2026-09-18).

---

## 1. Language and typing

- TypeScript for all application code, presentation and server-side
  (constitution IX). `strict: true` (already set in `tsconfig.json`).
- Prefer explicit interfaces and Zod-inferred types over `any`
  (constitution IX). Database types are **generated** into
  `lib/types/database.ts` with `supabase gen types` and committed (ADR-002);
  never hand-edit them.
- Naming: `camelCase` in TypeScript, `snake_case` for SQL columns/tables
  (`data-model.md` conventions); files `kebab-case.ts`; React components
  `PascalCase` exports in `kebab-case.tsx` files (per the paths in `plan.md`
  and `tasks.md`).

## 2. Layering (constitution VIII, ADR-001)

| Layer | Location | May do | Must not do |
|---|---|---|---|
| Route Handler | `app/api/v1/**/route.ts` | call `withApi()` with auth/rate-limit/schema options, call one service method, return its result | contain business rules, touch the database, format ad-hoc errors |
| Server Component / Server Action | `app/**` | read/mutate through services | call Route Handlers over HTTP; contain business rules |
| Service | `lib/services/**` | authorization of record, business rules, orchestration, audit calls | import React, access `process.env` directly (use `lib/config/env.ts`) |
| Repository | `lib/repositories/**` | typed queries and `rpc()` calls with the right client | authorization decisions, business rules |
| Guarded SQL function | `supabase/migrations/*` | invariant-bearing writes (`data-model.md` § Write-Protection Model) | be bypassed by direct writes |

Every invariant-bearing write goes through a guarded function; plain
user-data writes use the column allow-lists (`data-model.md` § 4). Never
issue a raw write to a Class B table from application code.

## 3. Request pipeline usage

- Every Route Handler is wrapped by `withApi()` (T030) with explicit
  `auth` (`'user' | 'admin' | 'access-cookie' | 'public' | 'cron'`), and a
  Zod `schema` for any body/query/params it reads (constitution X).
- Sensitive operations declare `reverification: 'strict'` (or
  `'multi_factor'` for Dead Man Switch check-in/cancel) rather than checking
  in the handler (FR-A018, `api-contracts.md`).
- Rate-limit policies are named (`default`, `sensitive`, `ai`,
  `publicEmergency`, `accessExchange`, `tokenAccess`) — never inline numbers
  (ADR-007).
- Responses use the common envelope; errors are `ApiError` instances mapped by
  `lib/api/errors.ts`. Never return stack traces, database messages, file
  paths or internal identifiers (constitution X, FR-Q016).

## 4. Server/client boundary and secrets (constitution I)

- Modules that read secrets or use the service client import `server-only`
  (`lib/config/env.ts`, `lib/db/server.ts`, all services and repositories).
- Only `NEXT_PUBLIC_*` variables are readable in the browser; no secret may be
  prefixed `NEXT_PUBLIC_` (T007).
- Environment access goes through the Zod-validated `env` object; never
  `process.env.X` in feature code.
- The Supabase **service** client is used only on the system paths listed in
  ADR-004 (webhooks, cron/jobs, audit writes, admin, token/OTP flows, upload
  promotion); user operations use the user-scoped client.

## 5. Validation and data handling

- Server-side Zod validation is mandatory for every input (constitution X);
  client-side validation is UX only. Validators live in `lib/validators/**`
  and are shared with forms (react-hook-form + `@hookform/resolvers`).
- Encrypted fields (`data-model.md` `ENCRYPTED` markers) are encrypted in the
  repository layer with `lib/security/encryption.ts` before persistence and
  decrypted only on authorized, reverified reads that are audited.
- Access-scope objects use the single schema in
  `lib/validators/access-scope.validators.ts` (T219).

## 6. Logging, errors and audit (constitution XII, XVI)

- Use the `pino` logger from `lib/observability/logger.ts` with the bound
  correlation id; never `console.log` in application code.
- Never log passwords, tokens, cookies, encryption keys, access tokens,
  document content or unnecessary PII (redaction paths in T022).
- Every security-relevant or legally significant operation writes an
  `audit_log` row: guarded functions write their own SUCCESS rows; services
  use `lib/audit/audit.service.ts` for Class A/C writes and for
  DENIED/FAILURE outcomes.

## 7. Caching and rendering (constitution XV, ADR-001)

- `withApi()` sets `Cache-Control: private, no-store` on every response; do
  not override it.
- Route groups that render user data — `(dashboard)`, `(admin)`,
  `(public)/access`, `(public)/emergency-access` — are never statically
  prerendered and never use `use cache`.
- Lazy-load heavy libraries (GSAP, PDF rendering) and below-the-fold content.

## 8. Front-end conventions (constitution XIII, XIV)

- shadcn/ui primitives in `components/ui/`; design tokens in
  `app/globals.css` (`@theme`, Tailwind v4 — no `tailwind.config.ts`).
- Framer Motion for component/page transitions, GSAP for complex sequences;
  every animation respects `prefers-reduced-motion` via
  `hooks/use-reduced-motion.ts` (T168).
- Semantic HTML, keyboard operability and WCAG 2.1 AA contrast are
  acceptance criteria (AC-UX1–UX4), not polish.
- Client state: Zustand for UI/wizard state; TanStack Query for server state;
  authentication state comes from Clerk hooks (research Decision 15/16).

## 9. Dependencies (constitution IX, NFR-MNT-003)

- New dependencies require a justification recorded against an ADR or task
  (T005 lists the baseline set). Components explicitly excluded from the
  baseline (Express.js, Prisma, S3/MinIO, Redis/BullMQ, Supabase Auth,
  MongoDB, Multer, Nodemailer, Winston, Puppeteer) may only be introduced by a
  new ADR citing a concrete requirement (constitution Technology Stack).
- Framework/library upgrades are tested against the suite before merging.

## 10. Tests (constitution XVII)

- Automated tests are mandatory for authentication/authorization, beneficiary
  allocation, document permissions, Dead Man Switch workflows, emergency
  access, AI validation/fallback, encryption/decryption and RLS/write
  protection (tasks T212–T217, T225, T226, T228, T229, T232, T235, T236,
  T241). Security-tagged suites are blocking in CI (T246); security
  regressions are release-blocking (NFR-SEC-003).
- Test data never contains real user information or production secrets.

## 11. Git (constitution XIX)

- Small, focused commits describing what changed and why; no secrets, `.env`
  files or user data in the repository; preserve working functionality.
- Commit messages and PR descriptions follow the attribution guidance given
  in the working session.

## 12. Framework version rule

Next.js 16 differs from earlier majors (`proxy.ts` replaces `middleware.ts`,
route segment configuration, caching semantics). Consult
`node_modules/next/dist/docs/` before writing framework-facing code
(`AGENTS.md`, constitution Technology Stack).
