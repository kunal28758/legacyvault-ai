-- Catalog fingerprint of everything the migrations own (read-only).
--
-- One JSON object: category -> sorted list of items. Two databases built from
-- the same migrations produce the same lists, so a diff names any drift
-- exactly. Grantors are left out on purpose (platform roles differ between a
-- local stack and a hosted project); grantees and privileges are kept.
with
acl as (
  select c.oid, c.relname, c.relkind, (aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner)))).*
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S', 'p')
),
fn as (
  select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
)
select json_build_object(
  'extensions', (select json_agg(extname || ' ' || extversion order by extname) from pg_extension),
  'types', (
    select coalesce(json_agg(t.typname || ': ' || (
             select string_agg(e.enumlabel, ',' order by e.enumsortorder)
               from pg_enum e where e.enumtypid = t.oid) order by t.typname), '[]'::json)
      from pg_type t
     where t.typnamespace = 'public'::regnamespace and t.typtype = 'e'),
  'tables', (
    select json_agg(c.relname || ' owner=' || c.relowner::regrole::text order by c.relname)
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'rls', (
    select json_agg(c.relname || ' enabled=' || c.relrowsecurity || ' forced=' || c.relforcerowsecurity
                    order by c.relname)
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'columns', (
    select json_agg(format('%s.%s %s notnull=%s default=%s identity=%s generated=%s',
             c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
             coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), nullif(a.attidentity, ''),
             nullif(a.attgenerated, '')) order by c.relname, a.attname)
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       and a.attnum > 0 and not a.attisdropped),
  'constraints', (
    select json_agg(format('%s.%s %s', c.relname, k.conname, pg_get_constraintdef(k.oid))
                    order by c.relname, k.conname)
      from pg_constraint k join pg_class c on c.oid = k.conrelid
     where k.connamespace = 'public'::regnamespace),
  'indexes', (
    select json_agg(indexdef order by indexname) from pg_indexes where schemaname = 'public'),
  'views', (
    select coalesce(json_agg(viewname || ' ' || md5(definition) order by viewname), '[]'::json)
      from pg_views where schemaname = 'public'),
  'policies', (
    select json_agg(format('%s.%s.%s %s %s to=%s using=%s check=%s', schemaname, tablename,
             policyname, permissive, cmd, roles::text, coalesce(qual, '-'), coalesce(with_check, '-'))
                    order by schemaname, tablename, policyname)
      from pg_policies where schemaname in ('public', 'storage')),
  'functions', (
    select json_agg(format('%s definer=%s volatility=%s md5=%s', fn.sig, p.prosecdef, p.provolatile,
             md5(pg_get_functiondef(p.oid))) order by fn.sig)
      from fn join pg_proc p on p.oid = fn.oid where p.prokind in ('f', 'p')),
  'function_permissions', (
    select json_agg(item order by item) from (
      select fn.sig || ' ' || coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type as item
        from fn join pg_proc p on p.oid = fn.oid,
             lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x) s),
  'triggers', (
    select json_agg(format('%s enabled=%s', pg_get_triggerdef(t.oid), t.tgenabled) order by c.relname, t.tgname)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and not t.tgisinternal),
  'grants', (
    select json_agg(item order by item) from (
      select acl.relname || ' ' || coalesce(nullif(acl.grantee, 0)::regrole::text, 'PUBLIC') || ':' || acl.privilege_type as item
        from acl
      union all
      select c.relname || '.' || a.attname || ' ' || coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type
        from pg_attribute a join pg_class c on c.oid = a.attrelid,
             lateral aclexplode(a.attacl) x
       where c.relnamespace = 'public'::regnamespace and a.attacl is not null) s),
  'schema_privileges', (
    select json_agg(item order by item) from (
      select n.nspname || ' ' || coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type as item
        from pg_namespace n, lateral aclexplode(n.nspacl) x
       where n.nspname = 'public') s),
  'default_privileges', (
    select coalesce(json_agg(item order by item), '[]'::json) from (
      select d.defaclrole::regrole::text || ' ' || d.defaclobjtype::text || ' '
             || coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type as item
        from pg_default_acl d, lateral aclexplode(d.defaclacl) x
       where d.defaclnamespace = 'public'::regnamespace) s),
  'buckets', (
    select json_agg(format('%s public=%s limit=%s mimes=%s', id, public, file_size_limit,
             (select string_agg(m, ',' order by m) from unnest(allowed_mime_types) m)) order by id)
      from storage.buckets)
)::text as fingerprint;
