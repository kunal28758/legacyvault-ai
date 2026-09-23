import { loadLocalEnv } from "./helpers/load-env";

/**
 * Integration workers read the same `.env.local` the application does, so the
 * database assertions actually run against the local Supabase stack instead of
 * silently skipping for want of configuration (see `tests/helpers/db.ts`).
 */
loadLocalEnv();
