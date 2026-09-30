# LegacyVault AI — Code Architecture

**Purpose**: where code lives and why, so every new file has one obvious home.
This is the *code map*. The decisions behind it are in
[`ARCHITECTURE_DECISIONS.md`](./ARCHITECTURE_DECISIONS.md) (ADRs); the runtime
design (request pipeline, jobs, platform) is in
[`architecture/SYSTEM_ARCHITECTURE.md`](./architecture/SYSTEM_ARCHITECTURE.md).

**As of**: 2026-09-30.

---

## 1. One application, three boundaries

LegacyVault is **one Next.js 16 application** at the repository root (ADR-001).
There is no `frontend/` or `backend/` directory, by decision: Next.js App
Router conventions require `app/` at the root, and splitting one deployable
into two folders would duplicate auth, validation and logging. Instead, the
boundaries are rules about *what may import what*, and they are machine-checked
on every test run by [`tests/security/boundaries.test.ts`](../tests/security/boundaries.test.ts).

| Boundary | What it contains | Rule |
|---|---|---|
| **Frontend (browser)** | `app/**/page.tsx` views and `_components/`, `components/`, `hooks/`, `lib/client/` | May import browser-safe modules only. Never touches the database, storage, secrets or a vendor SDK. Talks to the server only through `/api/v1`. |
| **Backend (server)** | `app/api/**` route handlers, and every `lib/` module outside the browser-safe list | Every module starts with `import "server-only";`, so importing one into client code fails the build (and the boundary test). |
| **Shared (isomorphic)** | `lib/types/`, `lib/validators/`, `lib/uploads/`, `lib/legacy-plan/`, `lib/assets/`, `lib/config/env.schema.ts`, `lib/config/public-env.ts`, `lib/format.ts`, `lib/utils.ts` | Pure code only — no secrets, no Node APIs, no server imports. Used by both sides so the browser and the server can never disagree (e.g. upload types, wizard validation, completeness). |

The boundary test enforces: every server module is marked `server-only`; no
browser-safe module and no `"use client"` file can reach a server module
through its imports (transitively); browser code reads no non-public
environment variable; the RLS-bypassing service client is used only on the
server paths ADR-004 allows; no secret-looking `NEXT_PUBLIC_*` name exists; no
debug routes, hard-coded ids or `console.log` in server code.

## 2. Request flow

```
Browser view (app/(dashboard)/**, components/**)
   │  TanStack Query hooks (hooks/*) → lib/client/api-client.ts
   ▼
Route handler  app/api/v1/**/route.ts        ← thin: withApi() + one service call
   │  lib/api/with-api.ts: correlation id → no-store → authenticate → CSRF
   │  → step-up verification → rate limit → Zod → handler → envelope → safe errors
   ▼
Service        lib/services/*.service.ts      ← business rules, ownership checks, audit
   ▼
Repository     lib/repositories/*.repository.ts  ← queries only, no rules
   ▼
PostgreSQL (RLS + guarded SECURITY DEFINER functions)  ·  Supabase Storage (private buckets)
```

UI never calls a repository or a service directly; Server Components that need
data call services, and client components call the API.

## 3. Where things live

| Question | Answer |
|---|---|
| Frontend UI code | `app/` (routes, layouts, route-private views in `_components/`), reusable components in `components/<feature>/`, primitives in `components/ui/` |
| Browser data access | `hooks/use-*.ts` (TanStack Query) over `lib/client/api-client.ts`; query keys in `lib/client/query-keys.ts` |
| Backend / server code | `app/api/**` (route handlers) and server-only `lib/**` |
| Business logic | `lib/services/` (domain services; AI services in `lib/services/ai/`) |
| Database code | `lib/repositories/` (queries), `lib/db/server.ts` (the two Supabase clients), `supabase/migrations/` (schema, RLS, guarded functions) |
| Storage code | `lib/storage/storage.ts` (private buckets, signed URLs); upload pipeline in `lib/services/upload.service.ts`; malware scanning in `lib/services/malware-scanner.ts` |
| AI server logic | `lib/ai/` — `provider.ts` (interface), `providers/` (OpenAI, Gemini), `index.ts` (factory + fallback), `prompts.ts` (versioned), `grounding.ts`, `documents/extract-text.ts`; orchestration in `lib/services/ai/` |
| Browser AI UI | `components/ai/` (chat, document AI viewer, safe Markdown), page at `app/(dashboard)/ai/`, hooks in `hooks/use-ai.ts` |
| Shared types | `lib/types/` (view models), `lib/validators/` (Zod schemas used on both sides), `lib/types/database.ts` (generated) |
| Tests | `tests/unit/` (jsdom, fast), `tests/security/` (static boundary checks), `tests/integration/` (real local Supabase + ClamAV), `tests/e2e/` (Playwright + Clerk testing tokens), shared helpers in `tests/helpers/` |
| Static assets | `public/` (currently none are needed: the hero is procedural 3D and the favicon is `app/favicon.ico`); styles in `app/globals.css` and `styles/` |
| Migrations | `supabase/migrations/NNNN_*.sql` — append-only; never edit an applied migration |
| Scripts | `scripts/` (`check-env.ts`, `seed-admin.ts`) |
| Security logic | `lib/security/` (encryption, access tokens and cookie, file validation, rate limiting), `lib/auth/` (session → app user, roles, access grants), `lib/api/with-api.ts` (CSRF, step-up), `lib/audit/` (append-only audit), `proxy.ts` (CSP, protected-first routing) |
| Jobs / cron | `lib/jobs/` (runner and handlers), triggered by `app/api/internal/cron/*` (Vercel Cron, `CRON_SECRET`) |

### `components/` by feature

`ai/`, `assets/`, `beneficiaries/`, `documents/` (upload dialog, file upload,
vault card, share dialog), `landing/` (3D vault shield), `layout/` (app shell,
navigation, system-status indicator, theme toggle), `security/` (release-scope
picker, security cards), `shared/` (cross-feature building blocks: form field,
confirm dialog, data table, empty/error states, page header…), `ui/`
(shadcn/Base UI primitives), `video-legacy/`, `will/` (the Create Will wizard:
provider, stepper, step frame, resource picker).

Route-specific views stay next to their route in `app/**/_components/` — the
App Router idiom for code that belongs to exactly one page.

## 4. Key subsystems

### Uploads and malware scanning (ADR-005, ADR-015)
`PENDING → VALIDATING → SCANNING → SCANNED_CLEAN → PROMOTED`, or `REJECTED` /
`EXPIRED`; `UPLOADED` marks a file held in quarantine after a scan could not
run, awaiting a retry. A completion claims the session atomically
(compare-and-set), so concurrent completions promote once. Every step is
bounded (object head read 15 s, scan 30 s + 1 s/MB ≤ 270 s, clamd connect 5 s),
a scanner failure is never treated as clean, and a session silent for six
minutes can be reclaimed. The accepted types are defined once in
`lib/uploads/file-types.ts` and enforced by the browser pre-check, the server
declaration check, the magic-byte check and the bucket allow-list. The Dead
Man's Switch uses the same dialog and pipeline.

### Create Will wizard
`components/will/wizard-provider.tsx` owns draft state. Auto-save is debounced,
sequential (each save carries the `lockVersion` the previous returned) and
server-confirmed: "Saved" appears only after the server accepted every edit;
failures keep the edits buffered and retry (automatically for transient
errors). `beforeunload` guards unconfirmed edits. "Skip for now" is recorded as
`skipped: true` on optional sections (never personal details) and cleared by
the next edit. The server validates every draft's shape
(`sectionDraftSchemas`) before `save_plan_step()`.

### AI (ADR-008, ADR-016)
The provider interface keeps vendors behind one boundary with fallback on
outage. Document text is extracted server-side (PDF text layer, Office XML,
plain text; OCR through the model for scans and images), wrapped in delimiters
the prompt declares to be data, and model output is validated with Zod and
grounded (every quoted value is looked up in the document text). Analyses are
stored as encrypted AI versions; chat turns are never stored; usage records
carry no content.

### System status
`GET /api/v1/system-status` probes the database, storage, Clerk, ClamAV (PING)
and the AI provider for real, caches for 30 s, and returns only the overall
state to anonymous callers. `components/layout/system-status-indicator.tsx`
shows it in the site navbar and the app shell.

## 5. Adding code — checklist

- A new API endpoint: `app/api/v1/<domain>/…/route.ts` → `withApi({ auth, rateLimit, schema })` → one service call.
- Business rules: a function in `lib/services/<domain>.service.ts`; queries it needs go in `lib/repositories/`.
- A schema used by a form *and* the API: `lib/validators/<domain>.validators.ts`.
- A view model returned by the API: `lib/types/<domain>.ts`.
- A reusable component: `components/<feature>/`; a page-only view: `app/**/_components/`.
- A data hook: `hooks/use-<domain>.ts`.
- A schema change: a new file in `supabase/migrations/`, then `pnpm db:types`.
- Anything server-only: first line `import "server-only";` (the boundary test will remind you).
