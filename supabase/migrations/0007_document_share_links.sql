-- =============================================================================
-- 0007 — Document-share links that follow the beneficiary's current shares
--
-- Sharing a document now emails the beneficiary a DIRECT_SHARE link by itself.
-- Such a link is marked `follows_document_shares`: the portal works out its
-- documents from what is shared with that beneficiary at the moment of each
-- request, so a later share appears in it and an unshare ends access at once.
--
-- Every other link keeps its fixed scope — manual DIRECT_SHARE links, Dead Man's
-- Switch releases and emergency access. Existing rows default to false, and
-- issue_access_token() is unchanged; links that follow shares are minted only by
-- issue_document_share_token(), which applies the same checks, and an owner's
-- resend of one keeps it following (resend_access_token() below).
--
-- Re-runnable: every statement is idempotent, so a database that already has
-- an earlier draft of this migration can be brought up to date by running it
-- again.
-- =============================================================================

alter table public.access_tokens
  add column if not exists follows_document_shares boolean not null default false;

-- The documents shared with a beneficiary right now, as a scope object. Only
-- the functions below use it; it is not callable through the API.
create or replace function public.lv_current_document_scope(p_owner uuid, p_beneficiary uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('documents', coalesce((
    select jsonb_agg(ba.resource_id order by ba.created_at)
      from public.beneficiary_assignments ba
      join public.documents d
        on d.id = ba.resource_id and d.user_id = p_owner and d.deleted_at is null
     where ba.user_id = p_owner and ba.beneficiary_id = p_beneficiary
       and ba.resource_type = 'DOCUMENT'
  ), '[]'::jsonb));
$$;

create or replace function public.issue_document_share_token(
  p_beneficiary_id uuid, p_token_hash text, p_expires_at timestamptz, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := public.lv_require_user();
  v_status public.beneficiary_status;
  v_scope  jsonb;
  v_id     uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    perform public.lv_raise_422('INVALID_TOKEN_HASH');
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    perform public.lv_raise_422('INVALID_EXPIRY', '{"maxDays":30}'::jsonb);
  end if;
  select b.status into v_status from public.beneficiaries b
   where b.id = p_beneficiary_id and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_status = 'INACTIVE' then perform public.lv_raise_422('BENEFICIARY_INACTIVE'); end if;

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

-- Owner resend of a DIRECT_SHARE link (0003), unchanged for fixed-scope links.
-- A link that follows shares stays one: its replacement is re-validated against
-- the documents shared now, so a resend after an unshare does not fail on the
-- old list, and the beneficiary's new link keeps picking up later shares.
create or replace function public.resend_access_token(
  p_token_id uuid, p_token_hash text, p_expires_at timestamptz, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := public.lv_require_user();
  v_tok    public.access_tokens%rowtype;
  v_status public.beneficiary_status;
  v_scope  jsonb;
  v_id     uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then perform public.lv_raise_422('INVALID_TOKEN_HASH'); end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    perform public.lv_raise_422('INVALID_EXPIRY', '{"maxDays":30}'::jsonb);
  end if;
  select * into v_tok from public.access_tokens t where t.id = p_token_id and t.owner_user_id = v_user for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_tok.grant_type <> 'DIRECT_SHARE' then perform public.lv_raise_422('NOT_DIRECT_SHARE'); end if;
  select b.status into v_status from public.beneficiaries b
   where b.id = v_tok.beneficiary_id and b.user_id = v_user and b.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
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
  insert into public.access_tokens
    (owner_user_id, beneficiary_id, grant_type, token_hash, scope, expires_at, replaces_token_id,
     follows_document_shares)
  values (v_user, v_tok.beneficiary_id, 'DIRECT_SHARE', p_token_hash, v_scope, p_expires_at, p_token_id,
          v_tok.follows_document_shares)
  returning id into v_id;
  perform public.lv_audit(v_user, 'access.token_resent', 'access_token', v_id, 'SUCCESS',
    jsonb_build_object('replacesTokenId', p_token_id, 'beneficiaryId', v_tok.beneficiary_id, 'expiresAt', p_expires_at), p_corr);
  perform public.lv_end();
  return v_id;
end;
$$;

revoke all on function public.lv_current_document_scope(uuid, uuid) from public, anon, authenticated;
revoke all on function public.issue_document_share_token(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.issue_document_share_token(uuid, text, timestamptz, text) to authenticated;
