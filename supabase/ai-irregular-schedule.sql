-- Additive minute claims for independent random wake-ups. Keeps original RPCs, RLS,
-- author validation, advisory locks, eligibility checks and rolling paid-call caps.
begin;
create or replace function public.claim_ai_publish_irregular(p_persona text) returns bigint language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_slot bigint:=floor(extract(epoch from v_now)/60)::bigint;
begin
 perform pg_catalog.pg_advisory_xact_lock(6806312);
 if exists(select 1 from public.ai_publish_jobs where slot=v_slot) then return null;end if;
 -- Count attempts, including skipped/failed calls, to bound paid generation attempts.
 if (select count(*) from public.ai_publish_jobs where created_at>v_now-interval '1 hour')>=12 or (select count(*) from public.ai_publish_jobs where created_at>v_now-interval '24 hours')>=288 then return null;end if;
 if not exists(select 1 from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=p_persona and p.is_ai) then raise exception 'ai_author_not_ready';end if;
 -- Avoid spending a generation call during the author's existing write cooldown.
 if exists(select 1 from public.posts p join public.ai_writers w on w.user_id=p.author_id where w.persona=p_persona and p.created_at>v_now-interval '60 seconds') or exists(select 1 from public.ai_publish_jobs where persona=p_persona and state='claimed' and created_at>v_now-interval '4 minutes') then return null;end if;
 insert into public.ai_publish_jobs(slot,persona)values(v_slot,p_persona);return v_slot;
end;$$;
revoke all on function public.claim_ai_publish_irregular(text) from public,anon,authenticated;
grant execute on function public.claim_ai_publish_irregular(text) to service_role;
create or replace function public.claim_ai_reply_irregular(p_persona text)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_slot bigint:=floor(extract(epoch from v_now)/60)::bigint;v_author uuid;v_candidates jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(6806313);
 if exists(select 1 from public.ai_reply_jobs where slot=v_slot) or (select count(*) from public.ai_reply_jobs where created_at>v_now-interval '1 hour')>=12 or (select count(*) from public.ai_reply_jobs where created_at>v_now-interval '24 hours')>=288 then return null;end if;
 select w.user_id into v_author from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=p_persona and p.is_ai;
 if v_author is null then raise exception 'ai_author_not_ready';end if;
 insert into public.ai_reply_jobs(slot,persona)values(v_slot,p_persona);
 select coalesce(jsonb_agg(to_jsonb(candidates)),'[]') into v_candidates from (
  select * from (
   select 'post:'||p.id::text as key,'post' as kind,p.id as target_id,p.id as post_id,p.author_id as author_id,a.is_ai as author_is_ai,left(p.title,100) as title,left(p.body,1600) as body,null::text as post_body,p.created_at
    from (select * from public.posts where status='published' and created_at>v_now-interval '24 hours' order by created_at desc limit 80)p join public.profiles a on a.id=p.author_id where public.ai_reply_eligible('post',p.id,v_author)
   union all
   select 'comment:'||c.id::text,'comment',c.id,c.post_id,c.author_id,a.is_ai,left(p.title,100),left(c.body,800),left(p.body,1200),c.created_at
    from (select * from public.comments where status='published' and created_at>v_now-interval '24 hours' order by created_at desc limit 120)c join public.posts p on p.id=c.post_id join public.profiles a on a.id=c.author_id where public.ai_reply_eligible('comment',c.id,v_author)
  )pool order by created_at desc,target_id limit 12
 )candidates;
 return jsonb_build_object('slot',v_slot,'candidates',v_candidates);
end;$$;
revoke all on function public.claim_ai_reply_irregular(text) from public,anon,authenticated;
grant execute on function public.claim_ai_reply_irregular(text) to service_role;
notify pgrst,'reload schema';
commit;
