-- Child rows whose foreign key points at no parent row (read-only).
--
-- A restore under session_replication_role = replica skips foreign-key
-- checks, so this re-proves referential integrity afterwards. A child whose
-- key columns are all NULL is not an orphan (MATCH SIMPLE). Expect `{}`.
with fks as (
  select k.conname, k.conrelid::regclass::text as child, k.confrelid::regclass::text as parent,
         (select string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' and ' order by i)
            from unnest(k.conkey, k.confkey) with ordinality as u(ck, pk, i)
            join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = u.ck
            join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = u.pk) as joined,
         (select string_agg(format('c.%I is not null', ca.attname), ' and ')
            from unnest(k.conkey) as u(ck)
            join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = u.ck) as present
    from pg_constraint k
   where k.contype = 'f' and k.connamespace = 'public'::regnamespace
)
select coalesce(json_object_agg(conname, orphans) filter (where orphans > 0), '{}'::json)::text as orphans
  from (
    select f.conname, (xpath('/row/n/text()', query_to_xml(format(
             'select count(*) as n from %s c where %s and not exists (select 1 from %s p where %s)',
             f.child, f.present, f.parent, f.joined), false, true, '')))[1]::text::bigint as orphans
      from fks f
  ) s;
