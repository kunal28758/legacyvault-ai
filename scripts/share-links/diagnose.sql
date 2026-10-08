-- Duplicate share-link diagnostic — READ-ONLY (selects only; safe on production).
--
-- For every beneficiary holding more than one UNREVOKED share-following
-- DIRECT_SHARE link (the state migration 0011 refuses), lists each link with
-- safe metadata only — ids, timestamps, state — never a token or its hash, and
-- the action the cleanup would take:
--
--   KEEP            the canonical link: the live one used most recently
--                   (last_used_at), else the newest (created_at), else highest id
--   REVOKE_EXPIRED  already expired; revoking changes no one's access
--   REVOKE_DUPLICATE a live non-canonical link; revoking ends access through it
--
-- Rows are flagged AMBIGUOUS (and the cleanup refuses them) when the token's
-- owner is not the beneficiary's owner, or the beneficiary is removed/inactive
-- yet still has unrevoked links. `approvedIds` is the exact list to paste into
-- cleanup.sql after review.
with links as (
  select t.id, t.owner_user_id, t.beneficiary_id, t.created_at, t.expires_at, t.used_at, t.last_used_at,
         t.delivered_at, t.expires_at > now() as live,
         b.user_id as beneficiary_owner, b.status as beneficiary_status, b.deleted_at as beneficiary_deleted_at
    from public.access_tokens t
    join public.beneficiaries b on b.id = t.beneficiary_id
   where t.grant_type = 'DIRECT_SHARE' and t.follows_document_shares and t.revoked_at is null
),
groups as (
  select beneficiary_id from links group by beneficiary_id having count(*) > 1
),
ranked as (
  select l.*,
         row_number() over (partition by l.beneficiary_id
                            order by l.live desc, l.last_used_at desc nulls last, l.created_at desc, l.id desc) as rank,
         (l.owner_user_id <> l.beneficiary_owner or l.beneficiary_deleted_at is not null
          or l.beneficiary_status = 'INACTIVE') as ambiguous
    from links l join groups g using (beneficiary_id)
),
decided as (
  select r.*,
         case when r.ambiguous then 'AMBIGUOUS'
              when not r.live then 'REVOKE_EXPIRED'
              when r.rank = 1 then 'KEEP'
              else 'REVOKE_DUPLICATE' end as action
    from ranked r
)
select json_build_object(
  'beneficiariesAffected', (select count(distinct beneficiary_id) from decided),
  'unrevokedLinksInvolved', (select count(*) from decided),
  'byAction', (select coalesce(json_object_agg(action, n), '{}'::json)
                 from (select action, count(*) n from decided group by action) a),
  'usedInLast24h', (select count(*) from decided
                     where action = 'REVOKE_DUPLICATE' and last_used_at > now() - interval '24 hours'),
  'links', (select coalesce(json_agg(json_build_object(
                 'tokenId', id, 'beneficiaryId', beneficiary_id, 'ownerUserId', owner_user_id,
                 'createdAt', created_at, 'expiresAt', expires_at, 'usedAt', used_at,
                 'lastUsedAt', last_used_at, 'delivered', delivered_at is not null,
                 'live', live, 'action', action) order by beneficiary_id, rank), '[]'::json)
              from decided),
  'approvedIds', (select coalesce(json_agg(id order by beneficiary_id, rank), '[]'::json)
                    from decided where action in ('REVOKE_EXPIRED', 'REVOKE_DUPLICATE'))
)::text as diagnostic;
