-- Run after ai-publishing.sql and six AI accounts have been initialized.
-- Set the Vault secret altmoa_ai_worker_secret to the SAME random value as
-- Vercel AI_WORKER_SECRET. Never commit an actual secret to this file.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$begin
 if(select count(*) from public.ai_writers)<>6 then raise exception 'Initialize six AI accounts first';end if;
 if(select count(*) from vault.decrypted_secrets where name='altmoa_ai_worker_secret')<>1 then raise exception 'Create the worker Vault secret first';end if;
 if exists(select 1 from cron.job where jobname='altmoa-ai-publish-5min') then raise exception 'Schedule already exists; inspect it before making changes';end if;
end$$;
select cron.schedule('altmoa-ai-publish-5min','*/5 * * * *',$job$
 select net.http_post(url:='https://www.altmoa.com/api/ai-publish',headers:=jsonb_build_object('Content-Type','application/json','x-ai-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='altmoa_ai_worker_secret')),body:='{}'::jsonb,timeout_milliseconds:=90000);
$job$);
commit;
