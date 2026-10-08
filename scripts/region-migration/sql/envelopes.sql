-- Every stored AES-GCM envelope, identified by table, column and row id, with
-- the md5 of its exact JSON and its key label (read-only). Nothing is
-- decrypted: equal lists on both sides prove the ciphertext moved byte for
-- byte, so the unchanged ENCRYPTION_KEY still opens it.
select coalesce(json_agg(item order by item), '[]'::json)::text as envelopes
  from (
    select format('%s.%s %s keyId=%s md5=%s', c.table_name, c.column_name,
                  (xpath('/row/id/text()', r))[1]::text, (xpath('/row/k/text()', r))[1]::text,
                  (xpath('/row/h/text()', r))[1]::text) as item
      from information_schema.columns c,
           lateral (select query_to_xml(format(
             'select id, %1$I->>''keyId'' as k, md5(%1$I::text) as h from public.%2$I where %1$I ? ''keyId''',
             c.column_name, c.table_name), false, true, '')::text as x) q,
           lateral unnest(xpath('/t/row', ('<t>' || q.x || '</t>')::xml)) as r
     where c.table_schema = 'public' and c.data_type = 'jsonb'
  ) s;
