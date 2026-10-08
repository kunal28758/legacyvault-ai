-- Row count and content checksum of every public table (read-only).
--
-- The checksum is the md5 of every row's text form, in a stable order, so two
-- databases holding the same rows agree exactly. Run with TimeZone = UTC on
-- both sides (Supabase's default) so timestamps print the same way.
select json_object_agg(table_name, json_build_object(
         'rows', (xpath('/row/n/text()', x))[1]::text::bigint,
         'md5', coalesce((xpath('/row/h/text()', x))[1]::text, 'empty')) order by table_name)::text as checksums
  from information_schema.tables t,
       lateral query_to_xml(format(
         'select count(*) as n, md5(string_agg(r::text, E''\n'' order by r::text)) as h from public.%I r',
         t.table_name), false, true, '') as x
 where t.table_schema = 'public' and t.table_type = 'BASE TABLE';
