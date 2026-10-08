# Tokyo → Mumbai migration rehearsal

Prepared, not yet run. Tokyo (`zlgmthrdoxyfkldeaxyl`, ap-northeast-1) stays the
production source and is only ever **read**; the rehearsal writes only to a new,
disposable Supabase project in **ap-south-1** and to a local app.

## Prerequisites (all must be true before step 1)

- [ ] **A Supabase project slot**: the account has 2 active free projects
      (the limit). Pause one, or create the rehearsal project in a paid org.
- [ ] **Rehearsal project** in `ap-south-1`, empty, with its database password
      saved (needed for the session-pooler URL).
- [ ] **Rehearsal Clerk instance** (a second development instance) with **no
      webhook endpoint** — the production instance's webhooks write to Tokyo.
      Register its domain under the rehearsal project's Authentication → Third-party
      auth → Clerk, and enable its Supabase integration (session `role` claim).
- [ ] **Rehearsal project settings**: SSL enforcement on; pg_graphql disabled (Tokyo
      has none); Data API exposes `public, graphql_public` only.
- [ ] **Local stack** running (`pnpm db:start`): its DB container provides `psql` 17.
- [ ] **`.env.rehearsal`** at the repo root (git-ignored by `.env.*`), holding:

| Variable | What |
|---|---|
| `REHEARSAL_TARGET_REF` | the rehearsal project's ref (never Tokyo's) |
| `REHEARSAL_TARGET_DB_URL` | its **session pooler** URL (`postgres.<ref>@aws-*-ap-south-1.pooler.supabase.com`) |
| `REHEARSAL_TARGET_SECRET_KEY` / `REHEARSAL_TARGET_PUBLISHABLE_KEY` | its API keys |
| `REHEARSAL_SOURCE_SECRET_KEY` | Tokyo's secret key, used **only** to list/download storage objects |
| `REHEARSAL_DUMP_DIR` | a private folder **outside any git repo** (dumps hold personal data) |
| `REHEARSAL_APP_URL` | the local app, e.g. `http://localhost:3100` |
| `REHEARSAL_CLERK_PUBLISHABLE_KEY` / `REHEARSAL_CLERK_SECRET_KEY` | the rehearsal Clerk instance |
| `REHEARSAL_ENCRYPTION_KEY` | the production `ENCRYPTION_KEY` value (`k1:<base64>`), for the canary only |
| `REHEARSAL_SCHEDULER_TARGET_URL` | an https endpoint you control for pg_net (tunnel to the local app, or a sink) — never production |
| `REHEARSAL_CRON_SECRET` | a fresh random ≥32-char value — never production's `CRON_SECRET` |

- [ ] **Local app for the rehearsal**, started with the rehearsal values instead of
      production's: `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co`,
      the rehearsal keys, the rehearsal Clerk keys, `ENCRYPTION_KEY` = production's,
      `CRON_SECRET` = `REHEARSAL_CRON_SECRET`, on a port other than 3000.

## Order

All commands: `node scripts/region-migration/rehearsal.mjs <command>`. Commands
that write are dry runs until `--execute` **and** the typed confirmation.

| # | Command | Writes to |
|---|---|---|
| 0 | `preflight` | nothing |
| 1 | `fingerprint --side source` | nothing (reads Tokyo) — the R1 drift check vs migrations is already done |
| 2 | `migrate --until 0009 --execute` | rehearsal project |
| 3 | `fingerprint --side target` then `compare` | nothing — must print `NO DRIFT` |
| 4 | `dump --execute` | the dump folder (reads Tokyo) |
| 5 | `restore --execute` | rehearsal project (refuses unless schema matches and tables are empty) |
| 6 | `verify` | nothing — the copied data must match Tokyo exactly (audit check's attempted writes roll back on the target) |
| 7 | `storage` (then `storage --copy --execute` if any objects) | rehearsal project |
| 8 | `share-links` | nothing — lists the duplicate share links 0011 refuses (Tokyo has some) |
| 9 | `share-links --cleanup --execute` | rehearsal project — revokes exactly the diagnosed duplicates, audited; rehearses the production cleanup |
| 10 | `migrate --until 0011 --execute`, then `fingerprint --side target` and `compare --after-0009` | rehearsal project (0010 + 0011) — 0011 stops with DUPLICATE_LIVE_SHARE_LINKS if step 9 was skipped |
| 11 | `canary --execute` | rehearsal project (a scratch schema, removed) |
| 12 | `rls` (local app running against the rehearsal project) | rehearsal project (probe records, removed) |
| 13 | `scheduler`, `scheduler --arm --execute`, `scheduler --fire --execute`, `scheduler`, `scheduler --disarm --execute` | rehearsal project's Vault |
| 14 | `rollback-check` | nothing — proves Tokyo and production are unchanged (no 0010/0011 there) |

After step 9, `verify` would report `access_tokens` and `audit_log` as changed
— that is the cleanup itself; compare data before it (step 6).

After the rehearsal: delete the dump folder, and the rehearsal project when no
longer needed.

## Deliberately not automated

Production cutover steps — freezing Tokyo writes, changing Vercel environment
variables or region, setting production Vault secrets, Instant Rollback — are
manual and approved one by one at cutover. No command here can write to Tokyo.
