-- Additive: preserves the existing post publisher schedule and its credential.
begin;
do $$begin
 if not exists(select 1 from vault.secrets where name='altmoa_ai_worker_secret') then raise exception 'AI worker credential is not configured';end if;
 if exists(select 1 from cron.job where jobname='altmoa-ai-reply-5min') then raise exception 'Reply schedule already exists; inspect before changing';end if;
end$$;
select cron.schedule('altmoa-ai-reply-5min','2-59/5 * * * *',$job$
 select net.http_post(url:='https://www.altmoa.com/api/ai-reply',headers:=jsonb_build_object('Content-Type','application/json','x-ai-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='altmoa_ai_worker_secret')),body:='{}'::jsonb,timeout_milliseconds:=90000);
$job$);
commit;
