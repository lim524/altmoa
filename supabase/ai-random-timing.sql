-- Change wake-ups only; keep credentials, SQL commands, RLS, and claim limits.
-- Deploy randomized worker code before applying this migration.
begin;
do $$declare j record;begin
 if (select count(*) from cron.job where jobname in ('altmoa-ai-publish-5min','altmoa-ai-reply-5min'))<>2 then
  raise exception 'Both AI schedules must exist first';
 end if;
 for j in select jobid from cron.job where jobname in ('altmoa-ai-publish-5min','altmoa-ai-reply-5min') loop
  perform cron.alter_job(j.jobid,schedule:='* * * * *');
 end loop;
end$$;
commit;
