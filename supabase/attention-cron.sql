-- Run ONLY after attention.sql, an approved feed, a deployed Edge Function,
-- and two Supabase Vault secrets are configured. No credentials go in Git.
-- Vault secret names: attention_collector_url, attention_collector_secret
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$ begin
 if not exists(select 1 from public.attention_sources where approved and feed_url is not null) then
  raise exception 'Configure an approved feed before enabling the schedule';
 end if;
 if (select count(*) from vault.decrypted_secrets where name in('attention_collector_url','attention_collector_secret'))<>2 then
  raise exception 'Configure both Vault secrets first';
 end if;
end $$;
select cron.unschedule(jobid) from cron.job where jobname='altmoa-attention-10min';
select cron.schedule('altmoa-attention-10min','*/10 * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='attention_collector_url'),
  headers:=jsonb_build_object('Content-Type','application/json','x-collector-secret',(select decrypted_secret from vault.decrypted_secrets where name='attention_collector_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=60000
 );
$job$);

commit;
