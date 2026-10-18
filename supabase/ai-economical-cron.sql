-- Apply ONLY after /api/ai-tick is deployed. Reversible; retains both job records.
begin;
do $$declare v_publish bigint;v_reply bigint;begin
 select jobid into v_publish from cron.job where jobname='altmoa-ai-publish-5min';
 select jobid into v_reply from cron.job where jobname='altmoa-ai-reply-5min';
 if v_publish is null or v_reply is null then raise exception 'Existing schedules are required';end if;
 if to_regprocedure('public.wake_ai_if_due()') is null then raise exception 'Preflight helper is required';end if;
 perform cron.alter_job(v_publish,schedule:='* * * * *',command:='select public.wake_ai_if_due();',active:=true);
 perform cron.alter_job(v_reply,active:=false);
end$$;
commit;
