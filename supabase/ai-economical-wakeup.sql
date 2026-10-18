-- Server-only preflight mirrors the existing Node HMAC gate; no new key needed.
begin;
do $$begin
 if to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then raise exception 'Existing pgcrypto HMAC is required';end if;
end$$;
create function public.ai_minute_due(p_kind text,p_at timestamptz,p_secret text)returns boolean language plpgsql immutable set search_path='' as $$
declare v_hour bigint:=floor(extract(epoch from p_at)/3600)::bigint;v_minute bigint:=floor(extract(epoch from p_at)/60)::bigint;
 a bytea;d bytea;v_activity bigint;v_due bigint;v_threshold numeric;
begin
 if p_kind not in ('post','reply') or p_kind is null or p_at is null or length(p_secret)<32 or p_secret is null then return false;end if;
 a:=extensions.hmac(convert_to('irregular-v2:'||p_kind||':activity:'||v_hour::text,'UTF8'),convert_to(p_secret,'UTF8'),'sha256');
 d:=extensions.hmac(convert_to('irregular-v2:'||p_kind||':due:'||v_minute::text,'UTF8'),convert_to(p_secret,'UTF8'),'sha256');
 v_activity:=(get_byte(a,0)::bigint*16777216+get_byte(a,1)::bigint*65536+get_byte(a,2)::bigint*256+get_byte(a,3))%3;
 v_due:=get_byte(d,0)::bigint*16777216+get_byte(d,1)::bigint*65536+get_byte(d,2)::bigint*256+get_byte(d,3);
 v_threshold:=case v_activity when 0 then 0.12 when 1 then 0.20 else 0.28 end;
 return v_due<v_threshold*4294967296;
end;$$;
revoke all on function public.ai_minute_due(text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.ai_minute_due(text,timestamptz,text) to service_role;
create function public.wake_ai_if_due()returns bigint language plpgsql security definer set search_path='' as $$
declare v_secret text;v_at timestamptz:=clock_timestamp();v_request bigint;
begin
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='altmoa_ai_worker_secret';
 if v_secret is null or length(v_secret)<32 then raise exception 'worker_not_configured';end if;
 if not(public.ai_minute_due('post',v_at,v_secret) or public.ai_minute_due('reply',v_at,v_secret)) then return null;end if;
 select net.http_post(url:='https://www.altmoa.com/api/ai-tick',headers:=jsonb_build_object('Content-Type','application/json','x-ai-worker-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=90000) into v_request;
 return v_request;
end;$$;
revoke all on function public.wake_ai_if_due() from public,anon,authenticated;
grant execute on function public.wake_ai_if_due() to service_role;
notify pgrst,'reload schema';
commit;
