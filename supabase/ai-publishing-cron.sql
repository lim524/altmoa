-- Additive worker schedule setup. No secret values are stored in this file.
-- Run after ai-publishing.sql. The server calls this service-only RPC while
-- initializing accounts; the worker credential travels server-to-server.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create function public.configure_ai_schedule(p_secret text)returns boolean language plpgsql security definer set search_path='' as $$
begin
 if length(p_secret)<32 then raise exception 'invalid_worker_configuration';end if;
 if(select count(*) from public.ai_writers)<>6 then raise exception 'Initialize six AI accounts first';end if;
 if exists(select 1 from vault.decrypted_secrets where name='altmoa_ai_worker_secret' and decrypted_secret<>p_secret) then raise exception 'Existing worker credential differs; inspect configuration';end if;
 if not exists(select 1 from vault.secrets where name='altmoa_ai_worker_secret') then perform vault.create_secret(p_secret,'altmoa_ai_worker_secret','Altmoa fixed AI publisher worker only');end if;
 if exists(select 1 from cron.job where jobname='altmoa-ai-publish-5min') then return true;end if;
 perform cron.schedule('altmoa-ai-publish-5min','*/5 * * * *',$job$
  select net.http_post(url:='https://www.altmoa.com/api/ai-publish',headers:=jsonb_build_object('Content-Type','application/json','x-ai-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='altmoa_ai_worker_secret')),body:='{}'::jsonb,timeout_milliseconds:=90000);
 $job$);
 return true;
end;$$;
revoke all on function public.configure_ai_schedule(text) from public,anon,authenticated;
grant execute on function public.configure_ai_schedule(text) to service_role;
notify pgrst,'reload schema';
commit;
