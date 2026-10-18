-- Shared rolling generation budgets and character-specific replies. Existing data and RLS stay intact.
begin;
drop index if exists public.one_ai_reply_per_target;
create unique index if not exists one_ai_reply_per_writer_target on public.ai_reply_jobs(target_kind,target_id,persona) where state='published';
create or replace function public.ai_reply_eligible(p_kind text,p_target uuid,p_author uuid)returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_post uuid;v_target record;v_id uuid;v_ai_chain int:=0;v_depth int:=0;
begin
 if p_kind='post' then
  select id,author_id into v_target from public.posts where id=p_target and status='published' and created_at>now()-interval '24 hours';
  if not found or v_target.author_id=p_author then return false;end if;v_post:=v_target.id;
 elsif p_kind='comment' then
  select id,author_id,post_id,parent_comment_id into v_target from public.comments where id=p_target and status='published' and created_at>now()-interval '24 hours';
  if not found or v_target.author_id=p_author then return false;end if;v_post:=v_target.post_id;v_id:=v_target.id;
  -- At most two consecutive AI comments; a human comment starts a new turn.
  while v_id is not null loop
   select c.parent_comment_id,p.is_ai into v_target from public.comments c join public.profiles p on p.id=c.author_id where c.id=v_id and c.status='published';
   if not found then return false;end if;
   if not v_target.is_ai then exit;end if;v_ai_chain:=v_ai_chain+1;
   if v_ai_chain>=4 then return false;end if;v_id:=v_target.parent_comment_id;
  end loop;
  v_id:=p_target;
  while v_id is not null loop
   select parent_comment_id into v_id from public.comments where id=v_id;
   v_depth:=v_depth+1;if v_depth>=5 then return false;end if;
  end loop;
 else return false;
 end if;
 if not exists(select 1 from public.posts where id=v_post and status='published') then return false;end if;
 if exists(select 1 from public.ai_reply_jobs j join public.ai_writers w on w.persona=j.persona where j.target_kind=p_kind and j.target_id=p_target and j.state='published' and w.user_id=p_author) then return false;end if;
 if (select count(*) from public.ai_reply_jobs where post_id=v_post and state='published' and created_at>now()-interval '24 hours' )>=24 then return false;end if;
 return true;
end;$$;
revoke all on function public.ai_reply_eligible(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_reply_eligible(text,uuid,uuid) to service_role;
create or replace function public.claim_ai_publish_irregular(p_persona text) returns bigint language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_slot bigint:=floor(extract(epoch from v_now)/60)::bigint;
begin
 perform pg_catalog.pg_advisory_xact_lock(6806312);
 if exists(select 1 from public.ai_publish_jobs where slot=v_slot) then return null;end if;
 -- Count attempts, including skipped/failed calls, to bound paid generation attempts.
 if (select count(*) from public.ai_publish_jobs where created_at>v_now-interval '1 hour')>=3 or (select count(*) from public.ai_publish_jobs where created_at>v_now-interval '24 hours')>=72 then return null;end if;
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
 if exists(select 1 from public.ai_reply_jobs where slot=v_slot) or (select count(*) from public.ai_reply_jobs where created_at>v_now-interval '1 hour')>=24 or (select count(*) from public.ai_reply_jobs where created_at>v_now-interval '24 hours')>=576 then return null;end if;
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
 return jsonb_build_object('slot',v_slot,'author_id',v_author,'candidates',v_candidates);
end;$$;
revoke all on function public.claim_ai_reply_irregular(text) from public,anon,authenticated;
grant execute on function public.claim_ai_reply_irregular(text) to service_role;
create or replace function public.ai_minute_due(p_kind text,p_at timestamptz,p_secret text)returns boolean language plpgsql immutable set search_path='' as $$
declare v_hour bigint:=floor(extract(epoch from p_at)/3600)::bigint;v_minute bigint:=floor(extract(epoch from p_at)/60)::bigint;
 a bytea;d bytea;v_activity bigint;v_due bigint;v_threshold numeric;
begin
 if p_kind not in ('post','reply') or p_kind is null or p_at is null or length(p_secret)<32 or p_secret is null then return false;end if;
 a:=extensions.hmac(convert_to('irregular-v2:'||p_kind||':activity:'||v_hour::text,'UTF8'),convert_to(p_secret,'UTF8'),'sha256');
 d:=extensions.hmac(convert_to('irregular-v2:'||p_kind||':due:'||v_minute::text,'UTF8'),convert_to(p_secret,'UTF8'),'sha256');
 v_activity:=(get_byte(a,0)::bigint*16777216+get_byte(a,1)::bigint*65536+get_byte(a,2)::bigint*256+get_byte(a,3))%3;
 v_due:=get_byte(d,0)::bigint*16777216+get_byte(d,1)::bigint*65536+get_byte(d,2)::bigint*256+get_byte(d,3);
 v_threshold:=case when p_kind='reply' then case v_activity when 0 then 0.24 when 1 then 0.40 else 0.56 end else case v_activity when 0 then 0.04 when 1 then 0.06 else 0.08 end end;
 return v_due<v_threshold*4294967296;
end;$$;
revoke all on function public.ai_minute_due(text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.ai_minute_due(text,timestamptz,text) to service_role;
create or replace function public.claim_ai_publish(p_persona text)returns bigint language sql security definer set search_path='' as $$select public.claim_ai_publish_irregular(p_persona)$$;
create or replace function public.claim_ai_reply(p_persona text)returns jsonb language sql security definer set search_path='' as $$select public.claim_ai_reply_irregular(p_persona)$$;
revoke all on function public.claim_ai_publish(text),public.claim_ai_reply(text) from public,anon,authenticated;
grant execute on function public.claim_ai_publish(text),public.claim_ai_reply(text) to service_role;
notify pgrst,'reload schema';
commit;
