-- Scheduler state on the REHEARSAL TARGET (read-only). Vault secrets are
-- reported by name only; their values are never selected.
select json_build_object(
  'jobs', (select coalesce(json_agg(json_build_object('name', jobname, 'schedule', schedule,
                    'active', active, 'command', command) order by jobname), '[]'::json)
             from cron.job),
  'triggerPrivileges', (select json_object_agg(r, has_function_privilege(r,
                    'public.lv_trigger_scheduler(text)', 'execute'))
                          from unnest(array['anon', 'authenticated', 'service_role']) r),
  'vaultSecretNames', (select coalesce(json_agg(name order by name), '[]'::json)
                         from vault.secrets where name like 'legacyvault_%'),
  'recentRuns', (select coalesce(json_agg(json_build_object('job', j.jobname, 'status', d.status,
                    'start', d.start_time) order by d.start_time desc), '[]'::json)
                   from (select * from cron.job_run_details order by start_time desc limit 10) d
                   join cron.job j on j.jobid = d.jobid),
  'recentResponses', (select coalesce(json_agg(json_build_object('status', status_code,
                    'timedOut', timed_out, 'error', error_msg, 'at', created) order by created desc), '[]'::json)
                        from (select * from net._http_response order by created desc limit 10) r)
)::text as scheduler;
