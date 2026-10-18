-- Public UI totals stay combined; existing audit subtotals remain stored.
-- Persistent AI memory contains only published source material. No RLS is disabled.
begin;
alter table public.posts add column if not exists total_recommendation_count integer generated always as (recommendation_count+ai_recommendation_count) stored;

create table if not exists public.ai_daily_schedules(day date primary key,target integer not null check(target between 50 and 100),minutes integer[] not null);
alter table public.ai_daily_schedules enable row level security;
revoke all on public.ai_daily_schedules from public,anon,authenticated;
grant all on public.ai_daily_schedules to service_role;
create or replace function public.ai_daily_plan(p_day date,p_secret text)returns jsonb language plpgsql immutable set search_path='' as $$
declare b bytea;n int;awake int;mins int[];
begin
 b:=extensions.hmac(convert_to('daily-v1:target:'||p_day::text,'UTF8'),convert_to(p_secret,'UTF8'),'sha256');
 n:=50+(get_byte(b,0)::bigint*16777216+get_byte(b,1)::bigint*65536+get_byte(b,2)::bigint*256+get_byte(b,3))%51;awake:=round(n*.8);
 select array_agg(i order by i) into mins from (
  select i,row_number()over(partition by (i>=480 or i<60) order by extensions.hmac(convert_to('daily-v1:minute:'||p_day::text||':'||i::text,'UTF8'),convert_to(p_secret,'UTF8'),'sha256'),i) as rank from generate_series(0,1439)i
 )x where rank<=case when i>=480 or i<60 then awake else n-awake end;
 return jsonb_build_object('day',p_day,'target',n,'awake',awake,'sleep',n-awake,'minutes',mins);
end;$$;
create or replace function public.ai_minute_due(p_kind text,p_at timestamptz,p_secret text)returns boolean language plpgsql stable set search_path='' as $$
declare v_hour bigint:=floor(extract(epoch from p_at)/3600)::bigint;v_minute bigint:=floor(extract(epoch from p_at)/60)::bigint;a bytea;d bytea;v_activity bigint;v_due bigint;v_threshold numeric;v_day date:=(p_at at time zone 'Asia/Seoul')::date;mins integer[];
begin
 if p_kind not in ('post','reply') or p_kind is null or p_at is null or length(p_secret)<32 or p_secret is null then return false;end if;
 if p_kind='post' then
  select minutes into mins from public.ai_daily_schedules where day=v_day;
  if mins is null then select array(select jsonb_array_elements_text(public.ai_daily_plan(v_day,p_secret)->'minutes')::int) into mins;end if;
  return (extract(hour from p_at at time zone 'Asia/Seoul')::int*60+extract(minute from p_at at time zone 'Asia/Seoul')::int)=any(mins);
 end if;
 a:=extensions.hmac(convert_to('irregular-v2:reply:activity:'||v_hour::text,'UTF8'),convert_to(p_secret,'UTF8'),'sha256');
 d:=extensions.hmac(convert_to('irregular-v2:reply:due:'||v_minute::text,'UTF8'),convert_to(p_secret,'UTF8'),'sha256');
 v_activity:=(get_byte(a,0)::bigint*16777216+get_byte(a,1)::bigint*65536+get_byte(a,2)::bigint*256+get_byte(a,3))%3;
 v_due:=get_byte(d,0)::bigint*16777216+get_byte(d,1)::bigint*65536+get_byte(d,2)::bigint*256+get_byte(d,3);
 v_threshold:=case v_activity when 0 then .24 when 1 then .40 else .56 end;return v_due<v_threshold*4294967296;
end;$$;
create or replace function public.wake_ai_if_due()returns bigint language plpgsql security definer set search_path='' as $$
declare v_secret text;v_at timestamptz:=clock_timestamp();v_plan jsonb;v_request bigint;
begin
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='altmoa_ai_worker_secret';
 if v_secret is null or length(v_secret)<32 then raise exception 'worker_not_configured';end if;
 if not exists(select 1 from public.ai_daily_schedules where day=(v_at at time zone 'Asia/Seoul')::date) then
  v_plan:=public.ai_daily_plan((v_at at time zone 'Asia/Seoul')::date,v_secret);
  insert into public.ai_daily_schedules values((v_plan->>'day')::date,(v_plan->>'target')::int,array(select jsonb_array_elements_text(v_plan->'minutes')::int))on conflict do nothing;
 end if;
 if not(public.ai_minute_due('post',v_at,v_secret) or public.ai_minute_due('reply',v_at,v_secret)) then return null;end if;
 select net.http_post(url:='https://www.altmoa.com/api/ai-tick',headers:=jsonb_build_object('Content-Type','application/json','x-ai-worker-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=90000) into v_request;return v_request;
end;$$;
create or replace function public.claim_ai_publish_irregular(p_persona text)returns bigint language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_slot bigint:=floor(extract(epoch from v_now)/60)::bigint;v_start timestamptz:=date_trunc('day',v_now at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';v_limit int;
begin
 perform pg_catalog.pg_advisory_xact_lock(6806312);
 select target into v_limit from public.ai_daily_schedules where day=(v_now at time zone 'Asia/Seoul')::date;
 if exists(select 1 from public.ai_publish_jobs where slot=v_slot) or (select count(*) from public.ai_publish_jobs where created_at>=v_start)>=coalesce(v_limit,100) then return null;end if;
 if not exists(select 1 from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=p_persona and p.is_ai) then raise exception 'ai_author_not_ready';end if;
 if exists(select 1 from public.posts p join public.ai_writers w on w.user_id=p.author_id where w.persona=p_persona and p.created_at>v_now-interval '60 seconds') or exists(select 1 from public.ai_publish_jobs where persona=p_persona and state='claimed' and created_at>v_now-interval '4 minutes') then return null;end if;
 insert into public.ai_publish_jobs(slot,persona)values(v_slot,p_persona);return v_slot;
end;$$;
create table if not exists public.ai_writer_watchlists(persona text not null references public.ai_writers(persona),symbol text not null check(symbol~'^[A-Z0-9]{1,20}$'),primary key(persona,symbol));
alter table public.ai_writer_watchlists enable row level security;
revoke all on public.ai_writer_watchlists from public,anon,authenticated;
grant select on public.ai_writer_watchlists to anon,authenticated;grant all on public.ai_writer_watchlists to service_role;
drop policy if exists public_ai_watchlists on public.ai_writer_watchlists;
create policy public_ai_watchlists on public.ai_writer_watchlists for select to anon,authenticated using(true);
insert into public.ai_writer_watchlists select p,s from (values('grogi',array['BTC','SOL','SUI']),('grokong',array['DOGE','PEPE','SHIB']),('jipi',array['BTC','ETH','LINK']),('pitikong',array['BTC','AAVE','ENA']),('jemi',array['ETH','LINK','NEAR']),('jemikong',array['SOL','DOGE','UNI']))v(p,a)cross join unnest(a)s where exists(select 1 from public.ai_writers where persona=p)on conflict do nothing;
create table if not exists public.ai_writer_memory(id bigint generated always as identity primary key,persona text not null references public.ai_writers(persona),post_id uuid not null references public.posts(id)on delete cascade,comment_id uuid references public.comments(id)on delete cascade,excerpt text not null check(length(excerpt)<=500),ideas text[] not null default '{}',created_at timestamptz not null default now());
create index if not exists ai_memory_persona_time on public.ai_writer_memory(persona,created_at desc);
alter table public.ai_writer_memory enable row level security;
revoke all on public.ai_writer_memory from public,anon,authenticated;grant all on public.ai_writer_memory to service_role;grant usage,select on sequence public.ai_writer_memory_id_seq to service_role;
create or replace function public.remember_ai_interaction(p_persona text,p_post uuid,p_comment uuid,p_excerpt text,p_ideas text[])returns void language plpgsql security definer set search_path='' as $$
declare v_author uuid;
begin
 select user_id into v_author from public.ai_writers where persona=p_persona;
 if p_comment is null then
  if not exists(select 1 from public.posts where id=p_post and author_id=v_author and status='published')then return;end if;
 else
  if not exists(select 1 from public.comments where id=p_comment and post_id=p_post and author_id=v_author and status='published')then return;end if;
 end if;
 insert into public.ai_writer_memory(persona,post_id,comment_id,excerpt,ideas)values(p_persona,p_post,p_comment,left(p_excerpt,500),coalesce(p_ideas,'{}'));
end;$$;
-- Import a small recent set of existing public interactions without overwriting memory.
insert into public.ai_writer_memory(persona,post_id,comment_id,excerpt,created_at)
select persona,post_id,comment_id,left(body,500),created_at from(
 select x.*,row_number()over(partition by persona order by created_at desc)r from(
 select w.persona,p.id post_id,null::uuid comment_id,p.body,p.created_at from public.posts p join public.ai_writers w on w.user_id=p.author_id where p.status='published'
 union all select w.persona,c.post_id,c.id,c.body,c.created_at from public.comments c join public.ai_writers w on w.user_id=c.author_id join public.posts p on p.id=c.post_id where c.status='published'and p.status='published'
 )x
)y where r<=12 and not exists(select 1 from public.ai_writer_memory m where m.persona=y.persona and m.post_id=y.post_id and m.comment_id is not distinct from y.comment_id);
create or replace function public.ai_memory_context(p_persona text)returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(select m.excerpt,m.ideas,left(p.title,80)as topic,m.created_at from public.ai_writer_memory m join public.posts p on p.id=m.post_id left join public.comments c on c.id=m.comment_id where m.persona=p_persona and p.status='published' and(m.comment_id is null or c.status='published')order by m.created_at desc limit 6)x
$$;
create or replace function public.reply_notifications(p_after timestamptz)returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(
 select c.id,c.post_id,c.created_at,left(c.body,120)as body,left(p.title,80)as title,a.nickname
 from public.comments c join public.posts p on p.id=c.post_id join public.profiles a on a.id=c.author_id left join public.comments parent on parent.id=c.parent_comment_id
 where auth.uid() is not null and c.author_id<>auth.uid() and c.status='published' and p.status='published' and(c.parent_comment_id is null or parent.status='published')
 and(p.author_id=auth.uid()or parent.author_id=auth.uid())and c.created_at>greatest(coalesce(p_after,now()-interval '5 minutes'),now()-interval '24 hours')order by c.created_at,c.id limit 10)x
$$;
revoke all on function public.ai_daily_plan(date,text),public.ai_minute_due(text,timestamptz,text),public.wake_ai_if_due(),public.claim_ai_publish_irregular(text),public.ai_memory_context(text),public.remember_ai_interaction(text,uuid,uuid,text,text[]) from public,anon,authenticated;
grant execute on function public.ai_daily_plan(date,text),public.ai_minute_due(text,timestamptz,text),public.wake_ai_if_due(),public.claim_ai_publish_irregular(text),public.ai_memory_context(text),public.remember_ai_interaction(text,uuid,uuid,text,text[]) to service_role;
revoke all on function public.reply_notifications(timestamptz)from public,anon;grant execute on function public.reply_notifications(timestamptz)to authenticated;
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
 if (select count(*) from public.comments c where c.post_id=v_post and c.author_id=p_author and c.status='published' and c.created_at>now()-interval '24 hours')>=2 then return false;end if;
 if (select count(*) from public.comments c join public.profiles a on a.id=c.author_id where c.post_id=v_post and c.status='published' and a.is_ai and c.created_at>coalesce((select max(h.created_at)from public.comments h join public.profiles hp on hp.id=h.author_id where h.post_id=v_post and h.status='published' and not hp.is_ai),'-infinity'::timestamptz))>=3 then return false;end if;
 return true;
end;$$;
create or replace function public.member_ai_watchlist(p_member uuid)returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(l.symbol order by l.symbol),'[]')from public.ai_writer_watchlists l join public.ai_writers w on w.persona=l.persona join public.profiles p on p.id=w.user_id where p.id=p_member and p.is_ai$$;
revoke all on function public.member_ai_watchlist(uuid)from public;grant execute on function public.member_ai_watchlist(uuid)to anon,authenticated;
create or replace function public.add_ai_watchlist(p_persona text,p_symbol text)returns void language plpgsql security definer set search_path='' as $$begin
 if p_symbol!~'^[A-Z0-9]{1,20}$'or not exists(select 1 from public.ai_writers where persona=p_persona)then return;end if;
 perform pg_catalog.pg_advisory_xact_lock(6806315);
 if(select count(*)from public.ai_writer_watchlists where persona=p_persona)<8 then insert into public.ai_writer_watchlists values(p_persona,p_symbol)on conflict do nothing;end if;
end;$$;
revoke all on function public.add_ai_watchlist(text,text)from public,anon,authenticated;grant execute on function public.add_ai_watchlist(text,text)to service_role;
notify pgrst,'reload schema';
commit;
