-- =============================================================================
-- 0011 — One live share-following link per beneficiary
--
-- Sharing a document emails the beneficiary a DIRECT_SHARE link that follows
-- their shares (0007). Each later share minted and emailed another one, so a
-- beneficiary could hold several live links at once and the owner's "Revoke"
-- ended only the one they picked; the others kept working until they expired.
--
-- The invariant, enforced here: a beneficiary has AT MOST ONE unrevoked
-- share-following link. (Fixed-scope links an owner issues deliberately, and
-- system-issued release/emergency links, are unaffected; the latter already
-- have their own one-live indexes from 0001.)
--
--  • issue_document_share_token() locks the beneficiary, retires an EXPIRED
--    share link (revoked as EXPIRED, audited), and refuses with
--    409 SHARE_LINK_ALREADY_LIVE when a live one exists. The application reuses
--    that link: it mints nothing and emails no new secret. Refusing (rather
--    than returning nothing) keeps an older application release safe if it
--    meets this function: its call fails and nothing is minted.
--  • resend_access_token() of a share link also revokes any other unrevoked
--    share link of that beneficiary, so a resend replaces rather than adds.
--  • A partial unique index makes a second unrevoked share link impossible,
--    whatever the code path or the timing.
--
-- Guarded: if the database already holds beneficiaries with more than one
-- unrevoked share link, this migration stops with DUPLICATE_LIVE_SHARE_LINKS
-- and changes nothing. Resolve them first with the reviewed, audited cleanup in
-- scripts/share-links/ (an operator action, deliberately not part of a
-- migration). Transactional, and re-runnable.
-- =============================================================================

do $$
declare
  v_duplicated integer;
begin
  select count(*) into v_duplicated from (
    select beneficiary_id
      from public.access_tokens
     where grant_type = 'DIRECT_SHARE' and follows_document_shares and revoked_at is null
     group by beneficiary_id
    having count(*) > 1
  ) d;
  if v_duplicated > 0 then
    raise exception 'DUPLICATE_LIVE_SHARE_LINKS: % beneficiaries hold more than one unrevoked share link', v_duplicated
      using hint = 'Run the reviewed cleanup in scripts/share-links/ first; this migration changed nothing.';
  end if;
end $$;

create unique index if not exists access_tokens_live_share_link_uidx
  on public.access_tokens (beneficiary_id)
  where grant_type = 'DIRECT_SHARE' and follows_document_shares and revoked_at is null;

create or replace function public.issue_document_share_token(
  p_beneficiary_id uuid, p_token_hash text, p_expires_at timestamptz, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := public.lv_require_user();
  v_status  public.beneficiary_status;
  v_scope   jsonb;
  v_id      uuid;
  v_expired uuid;
  v_live    uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    perform public.lv_raise_422('INVALID_TOKEN_HASH');
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    perform public.lv_raise_422('INVALID_EXPIRY', '{"maxDays":30}'::jsonb);
  end if;
  -- The beneficiary row lock serialises concurrent shares to the same person.
  select b.status into v_status from public.beneficiaries b
   where b.id = p_beneficiary_id and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_status = 'INACTIVE' then perform public.lv_raise_422('BENEFICIARY_INACTIVE'); end if;

  -- An expired link opens nothing already; mark it so, so it cannot hold the slot.
  for v_expired in
    select t.id from public.access_tokens t
     where t.beneficiary_id = p_beneficiary_id and t.owner_user_id = v_user
       and t.grant_type = 'DIRECT_SHARE' and t.follows_document_shares
       and t.revoked_at is null and t.expires_at <= now()
  loop
    perform public.lv_revoke_token(v_expired, 'EXPIRED');
    perform public.lv_audit(v_user, 'access.token_revoked', 'access_token', v_expired, 'SUCCESS',
      jsonb_build_object('beneficiaryId', p_beneficiary_id, 'grantType', 'DIRECT_SHARE',
                         'reason', 'EXPIRED', 'followsShares', true), p_corr);
  end loop;

  select t.id into v_live from public.access_tokens t
   where t.beneficiary_id = p_beneficiary_id and t.owner_user_id = v_user
     and t.grant_type = 'DIRECT_SHARE' and t.follows_document_shares and t.revoked_at is null;
  if v_live is not null then
    perform public.lv_raise_409('SHARE_LINK_ALREADY_LIVE', jsonb_build_object('tokenId', v_live));
  end if;

  -- Validated like any DIRECT_SHARE scope and recorded for the audit trail; the
  -- portal reads the live shares instead.
  v_scope := public.lv_validate_scope(
    v_user, public.lv_current_document_scope(v_user, p_beneficiary_id), 'DIRECT_SHARE', p_beneficiary_id);

  insert into public.access_tokens
    (owner_user_id, beneficiary_id, grant_type, token_hash, scope, expires_at, follows_document_shares)
  values (v_user, p_beneficiary_id, 'DIRECT_SHARE', p_token_hash, v_scope, p_expires_at, true)
  returning id into v_id;
  perform public.lv_audit(v_user, 'access.token_issued', 'access_token', v_id, 'SUCCESS',
    jsonb_build_object('beneficiaryId', p_beneficiary_id, 'grantType', 'DIRECT_SHARE',
                       'expiresAt', p_expires_at, 'followsShares', true,
                       'scopeCounts', jsonb_build_object(
                         'documents', jsonb_array_length(v_scope -> 'documents'))), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

-- Owner resend of a DIRECT_SHARE link (0003/0007). A share-following link stays
-- one: its replacement is re-validated against the documents shared now, and
-- every other unrevoked share link of the beneficiary is revoked with it.
-- Locks the beneficiary before any token, the same order as the issue path.
create or replace function public.resend_access_token(
  p_token_id uuid, p_token_hash text, p_expires_at timestamptz, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user        uuid := public.lv_require_user();
  v_tok         public.access_tokens%rowtype;
  v_beneficiary uuid;
  v_status      public.beneficiary_status;
  v_scope       jsonb;
  v_id          uuid;
  v_other       uuid;
  v_replaced    uuid[] := '{}';
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then perform public.lv_raise_422('INVALID_TOKEN_HASH'); end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    perform public.lv_raise_422('INVALID_EXPIRY', '{"maxDays":30}'::jsonb);
  end if;
  select t.beneficiary_id into v_beneficiary from public.access_tokens t
   where t.id = p_token_id and t.owner_user_id = v_user;
  if not found then perform public.lv_forbidden(); end if;
  select b.status into v_status from public.beneficiaries b
   where b.id = v_beneficiary and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  select * into v_tok from public.access_tokens t where t.id = p_token_id and t.owner_user_id = v_user for update;
  if v_tok.grant_type <> 'DIRECT_SHARE' then perform public.lv_raise_422('NOT_DIRECT_SHARE'); end if;
  if v_status = 'INACTIVE' then perform public.lv_raise_422('BENEFICIARY_INACTIVE'); end if;

  v_scope := public.lv_validate_scope(
    v_user,
    case when v_tok.follows_document_shares
         then public.lv_current_document_scope(v_user, v_tok.beneficiary_id)
         else v_tok.scope end,
    'DIRECT_SHARE', v_tok.beneficiary_id);

  if v_tok.revoked_at is null then
    perform public.lv_revoke_token(p_token_id, 'RESENT');
  end if;
  if v_tok.follows_document_shares then
    for v_other in
      select t.id from public.access_tokens t
       where t.beneficiary_id = v_tok.beneficiary_id and t.owner_user_id = v_user
         and t.grant_type = 'DIRECT_SHARE' and t.follows_document_shares and t.revoked_at is null
    loop
      perform public.lv_revoke_token(v_other, 'RESENT');
      v_replaced := v_replaced || v_other;
    end loop;
  end if;
  insert into public.access_tokens
    (owner_user_id, beneficiary_id, grant_type, token_hash, scope, expires_at, replaces_token_id,
     follows_document_shares)
  values (v_user, v_tok.beneficiary_id, 'DIRECT_SHARE', p_token_hash, v_scope, p_expires_at, p_token_id,
          v_tok.follows_document_shares)
  returning id into v_id;
  perform public.lv_audit(v_user, 'access.token_resent', 'access_token', v_id, 'SUCCESS',
    jsonb_build_object('replacesTokenId', p_token_id, 'beneficiaryId', v_tok.beneficiary_id,
                       'expiresAt', p_expires_at, 'alsoRevoked', to_jsonb(v_replaced)), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

revoke all on function public.issue_document_share_token(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.issue_document_share_token(uuid, text, timestamptz, text) to authenticated;
revoke all on function public.resend_access_token(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.resend_access_token(uuid, text, timestamptz, text) to authenticated;
