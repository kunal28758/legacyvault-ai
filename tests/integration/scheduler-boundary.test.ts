import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isLocalStackAvailable, LOCAL_SUPABASE_URL } from "../helpers/db";
import { mintLocalJwt } from "../helpers/jwt";

/**
 * The database scheduler's privilege boundary (migration 0010), proven from
 * the outside rather than assumed.
 *
 * pg_net is installed by the platform role with grants this project cannot
 * revoke: anon and authenticated may execute `net.http_*` and read net's
 * queue (which briefly holds the scheduler's bearer). Those grants are only
 * safe if no API path reaches them, so this asserts exactly that, through the
 * same HTTP surface a browser has, for every API role:
 *
 *  • `lv_trigger_scheduler()` is not executable by anon, authenticated or
 *    service_role;
 *  • the `net`, `vault` and `cron` schemas are not served by the Data API,
 *    for reads or RPC;
 *  • GraphQL is not enabled.
 *
 * And, in the catalog, the paths HTTP cannot see: no function or view in an
 * exposed schema reaches net/vault/cron except the trigger itself, nothing of
 * theirs is published to Realtime, and the scheduled commands are the three
 * allow-listed routes with no secret in them.
 */
const available = await isLocalStackAvailable();
const publishable = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = () => process.env.SUPABASE_SECRET_KEY ?? "";

async function roles(): Promise<Record<string, Record<string, string>>> {
  const token = await mintLocalJwt({ sub: "user_scheduler_boundary" });
  return {
    anon: { apikey: publishable() },
    authenticated: { apikey: publishable(), Authorization: `Bearer ${token}` },
    service_role: { apikey: secret() },
  };
}

async function call(pathname: string, headers: Record<string, string>, body?: unknown) {
  const response = await fetch(`${LOCAL_SUPABASE_URL}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, payload };
}

/** Runs SQL as the database owner through the Supabase CLI (local stack only). */
function sql(query: string): unknown {
  const dir = mkdtempSync(path.join(tmpdir(), "lv-boundary-"));
  const file = path.join(dir, "query.sql");
  writeFileSync(file, query);
  try {
    let out: string;
    try {
      out = execSync(`pnpm exec supabase db query --local -f "${file}"`, {
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
    } catch (cause) {
      // The CLI reports SQL errors on either stream; surface both.
      const { stdout, stderr } = cause as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`${stdout?.toString() ?? ""}${stderr?.toString() ?? ""}`);
    }
    const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as {
      rows: Record<string, string>[];
    };
    return JSON.parse(Object.values(json.rows[0])[0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!available)("scheduler privilege boundary (0010)", () => {
  it("no API role can invoke the scheduler trigger", async () => {
    for (const [role, headers] of Object.entries(await roles())) {
      const { status, payload } = await call("/rest/v1/rpc/lv_trigger_scheduler", headers, {
        p_path: "/api/internal/cron/run-jobs",
      });
      expect([401, 403], role).toContain(status);
      expect(payload.code, role).toBe("42501");
    }
  });

  it("serves neither net, vault nor cron through the Data API", async () => {
    for (const [role, headers] of Object.entries(await roles())) {
      for (const [schema, table] of [
        ["net", "http_request_queue"],
        ["net", "_http_response"],
        ["vault", "decrypted_secrets"],
        ["cron", "job"],
      ]) {
        const read = await call(`/rest/v1/${table}?select=*&limit=1`, {
          ...headers,
          "Accept-Profile": schema,
        });
        expect(read.status, `${role} ${schema}.${table}`).toBe(406);
        expect(read.payload.code).toBe("PGRST106");
      }
      const rpc = await call(
        "/rest/v1/rpc/http_post",
        { ...headers, "Content-Profile": "net" },
        { url: "https://example.com" },
      );
      expect(rpc.status, `${role} net.http_post`).toBe(406);
      // Not reachable by name from the exposed schema either.
      const bare = await call("/rest/v1/rpc/http_post", headers, { url: "https://example.com" });
      expect(bare.status, `${role} public http_post`).toBe(404);
    }
  });

  it("keeps GraphQL disabled", async () => {
    for (const [role, headers] of Object.entries(await roles())) {
      const { payload } = await call("/graphql/v1", headers, {
        query: "{ __schema { types { name } } }",
      });
      expect(payload.data, role).toBeUndefined();
      expect(JSON.stringify(payload.errors), role).toContain("pg_graphql extension is not enabled");
    }
  });

  it("leaves no other path to net, vault or cron in the catalog", () => {
    const catalog = sql(String.raw`
      select json_build_object(
        'graphql', exists(select 1 from pg_extension where extname = 'pg_graphql'),
        'functions', (
          select coalesce(json_agg(json_build_object(
                   'fn', p.oid::regprocedure::text,
                   'definer', p.prosecdef,
                   'config', p.proconfig,
                   'anon', has_function_privilege('anon', p.oid, 'execute'),
                   'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
                   'service_role', has_function_privilege('service_role', p.oid, 'execute'))
                 order by p.oid::regprocedure::text), '[]'::json)
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'graphql_public')
             and p.prosrc ~* '\m(net|vault|cron)\.'),
        'views', (select count(*) from pg_views
                   where schemaname in ('public', 'graphql_public')
                     and definition ~* '\m(net|vault|cron)\.'),
        'published', (select count(*) from pg_publication_tables
                       where schemaname in ('net', 'vault', 'cron')),
        'cronUsage', (select json_agg(has_schema_privilege(r, 'cron', 'usage'))
                        from unnest(array['anon', 'authenticated', 'service_role']) r),
        'vaultRead', (select json_agg(has_table_privilege(r, 'vault.decrypted_secrets', 'select'))
                        from unnest(array['anon', 'authenticated']) r),
        'jobs', (select json_agg(json_build_object('name', jobname, 'command', command)
                                 order by jobname)
                   from cron.job where jobname like 'legacyvault-%')
      )::text as catalog;`) as {
      graphql: boolean;
      functions: Record<string, unknown>[];
      views: number;
      published: number;
      cronUsage: boolean[];
      vaultRead: boolean[];
      jobs: { name: string; command: string }[];
    };

    expect(catalog.graphql).toBe(false);
    // Exactly one function reaches them, owner-only, with a pinned search path.
    expect(catalog.functions).toEqual([
      {
        fn: "lv_trigger_scheduler(text)",
        definer: true,
        config: ['search_path=""'],
        anon: false,
        authenticated: false,
        service_role: false,
      },
    ]);
    expect(catalog.views).toBe(0);
    expect(catalog.published).toBe(0);
    expect(catalog.cronUsage).toEqual([false, false, false]);
    expect(catalog.vaultRead).toEqual([false, false]);
    expect(catalog.jobs.map((job) => job.name)).toEqual([
      "legacyvault-dms-scan",
      "legacyvault-housekeeping",
      "legacyvault-run-jobs",
    ]);
    for (const job of catalog.jobs) {
      expect(job.command).toMatch(
        /^select public\.lv_trigger_scheduler\('\/api\/internal\/cron\/(run-jobs|dms-scan|housekeeping)'\)$/,
      );
    }
  });

  it("refuses any route outside the allow-list, before reading a secret", () => {
    expect(() => sql(`select public.lv_trigger_scheduler('/api/v1/users/me')::text as r;`)).toThrow(
      /unknown scheduler route/,
    );
  });
});
