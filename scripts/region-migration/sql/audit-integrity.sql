-- Audit log integrity on the REHEARSAL TARGET ONLY. Never run against Tokyo:
-- it attempts an UPDATE and a DELETE (inside a transaction that is always
-- rolled back) to prove the append-only trigger refuses them.
--
-- Prints AUDIT_OK on success; any other outcome stops psql with an error.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.audit_log'::regclass
       and t.tgname = 'audit_log_append_only' and t.tgenabled = 'O') then
    raise exception 'AUDIT_TRIGGER_MISSING_OR_DISABLED';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass) then
    raise exception 'AUDIT_RLS_DISABLED';
  end if;

  select id into v_id from public.audit_log limit 1;
  if v_id is null then
    raise notice 'audit_log is empty: append-only behaviour not exercised';
    return;
  end if;

  begin
    update public.audit_log set action = action where id = v_id;
    raise exception 'AUDIT_UPDATE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_log where id = v_id;
    raise exception 'AUDIT_DELETE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
select 'AUDIT_OK';
