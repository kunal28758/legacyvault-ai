-- Duplicate share-link cleanup — WRITES. Production only with explicit approval.
--
-- Revokes exactly the token ids pasted below (from diagnose.sql's
-- `approvedIds`, after review), and only if each one STILL qualifies under the
-- same rule: an unrevoked share-following DIRECT_SHARE link whose beneficiary
-- has another unrevoked share link, that is either expired or not the
-- canonical one. Anything else — an id that no longer qualifies, an ambiguous
-- owner mapping — aborts the whole run; nothing is changed.
--
-- Deterministic, idempotent (a second run finds nothing to do and changes
-- nothing), one transaction, audited per token (`access.token_revoked`,
-- reason DUPLICATE_SHARE_LINK or EXPIRED, with the canonical link kept). No
-- token or hash is read or printed; no other table is written except the
-- audit log.
--
-- Paste the reviewed ids between the brackets, e.g.
--   array['5b0c…'::uuid, '9e1d…'::uuid]
do $$
declare
  v_approved uuid[] := array[]::uuid[];   -- ← reviewed ids from diagnose.sql
  v_row      record;
  v_revoked  integer := 0;
begin
  if cardinality(v_approved) = 0 then
    raise notice 'No ids approved: nothing to do.';
    return;
  end if;

  for v_row in
    with links as (
      select t.id, t.owner_user_id, t.beneficiary_id, t.created_at, t.last_used_at,
             t.expires_at > now() as live, b.user_id as beneficiary_owner,
             b.status as beneficiary_status, b.deleted_at as beneficiary_deleted_at
        from public.access_tokens t
        join public.beneficiaries b on b.id = t.beneficiary_id
       where t.grant_type = 'DIRECT_SHARE' and t.follows_document_shares and t.revoked_at is null
       for update of t
    ),
    ranked as (
      select l.*,
             count(*) over (partition by l.beneficiary_id) as unrevoked,
             first_value(l.id) over (partition by l.beneficiary_id
               order by l.live desc, l.last_used_at desc nulls last, l.created_at desc, l.id desc) as canonical
        from links l
    )
    select a.id as approved_id, r.*
      from unnest(v_approved) as a(id)
      left join ranked r on r.id = a.id
  loop
    if v_row.beneficiary_id is null then
      -- Already revoked by an earlier run: nothing to do. Anything else is unexpected.
      if exists (select 1 from public.access_tokens t
                  where t.id = v_row.approved_id and t.grant_type = 'DIRECT_SHARE'
                    and t.follows_document_shares and t.revoked_at is not null) then
        raise notice '% was already revoked; skipped', v_row.approved_id;
        continue;
      end if;
      raise exception 'ABORTED: % is not a share link of this database', v_row.approved_id;
    end if;
    if v_row.owner_user_id <> v_row.beneficiary_owner or v_row.beneficiary_deleted_at is not null
       or v_row.beneficiary_status = 'INACTIVE' then
      raise exception 'ABORTED: % has an ambiguous owner/beneficiary state; review it by hand', v_row.approved_id;
    end if;
    if v_row.unrevoked < 2 or (v_row.live and v_row.id = v_row.canonical) then
      raise exception 'ABORTED: % is its beneficiary''s canonical (or only) link', v_row.approved_id;
    end if;

    perform public.lv_revoke_token(v_row.id, case when v_row.live then 'ADMIN' else 'EXPIRED' end::public.token_revoked_reason);
    perform public.lv_audit(null, 'access.token_revoked', 'access_token', v_row.id, 'SUCCESS',
      jsonb_build_object('reason', case when v_row.live then 'DUPLICATE_SHARE_LINK' else 'EXPIRED' end,
                         'canonicalTokenId', v_row.canonical, 'beneficiaryId', v_row.beneficiary_id,
                         'ownerUserId', v_row.owner_user_id, 'grantType', 'DIRECT_SHARE',
                         'followsShares', true, 'operation', 'share-link-cleanup-0011'), null);
    v_revoked := v_revoked + 1;
  end loop;

  raise notice 'Revoked % share links; every beneficiary keeps its canonical link.', v_revoked;
end $$;

-- What is left: must be zero before migration 0011 can be applied.
select count(*)::text as beneficiaries_still_duplicated
  from (select beneficiary_id from public.access_tokens
         where grant_type = 'DIRECT_SHARE' and follows_document_shares and revoked_at is null
         group by beneficiary_id having count(*) > 1) d;
