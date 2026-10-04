@AGENTS.md

## Testing

- Default: `pnpm test` (vitest `unit` + `security` projects). Regression tests start here.
- Escalate only when the defect lives in data/requests or a full journey:
  `pnpm test:integration` (uses the local Supabase stack) or `pnpm test:e2e` (Playwright).
- Layout: `tests/unit`, `tests/integration`, `tests/security`, `tests/e2e`.
