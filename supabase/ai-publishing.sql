-- Additive migration. Does not replace policies, modify existing posts, or disable RLS.
begin;
create table public.ai_writers(persona text primary key check(persona in ('grogi','grokong','jipi','pitikong','jemi','jemikong')),user_id uuid unique not null references public.profiles(id));
create table public.ai_publish_jobs(slot bigint primary key,persona text not null references public.ai_writers(persona),state text not null default 'claimed' check(state in ('claimed','published','skipped','failed')),created_at timestamptz not null default now(),post_id uuid references public.posts(id) on delete set null,error_code text,usage jsonb not null default '{}');
alter table public.ai_writers enable row level security;
alter table public.ai_publish_jobs enable row level security;
revoke all on public.ai_writers,public.ai_publish_jobs from public,anon,authenticated;
grant all on public.ai_writers,public.ai_publish_jobs to service_role;
create policy ai_writers_operator on public.ai_writers for select to authenticated using((select public.is_moderator()));
create policy ai_jobs_operator on public.ai_publish_jobs for select to authenticated using((select public.is_moderator()));
grant select on public.ai_writers,public.ai_publish_jobs to authenticated;
create function public.claim_ai_publish(p_persona text) returns bigint language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_slot bigint:=floor(extract(epoch from v_now)/300)::bigint;
begin
 perform pg_catalog.pg_advisory_xact_lock(6806312);
 if exists(select 1 from public.ai_publish_jobs where slot=v_slot) then return null;end if;
 -- Count attempts, including skipped/failed calls, to bound paid generation attempts.
 if (select count(*) from public.ai_publish_jobs where created_at>v_now-interval '1 hour')>=12 or (select count(*) from public.ai_publish_jobs where created_at>v_now-interval '24 hours')>=288 then return null;end if;
 if not exists(select 1 from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=p_persona and p.is_ai) then raise exception 'ai_author_not_ready';end if;
 insert into public.ai_publish_jobs(slot,persona)values(v_slot,p_persona);return v_slot;
end;$$;
revoke all on function public.claim_ai_publish(text) from public,anon,authenticated;
grant execute on function public.claim_ai_publish(text) to service_role;
create function public.finish_ai_publish(p_slot bigint,p_title text,p_body text,p_tag text)returns uuid language plpgsql security definer set search_path='' as $$
declare j public.ai_publish_jobs;v_author uuid;v_post uuid;
begin
 select * into j from public.ai_publish_jobs where slot=p_slot for update;
 if not found or j.state<>'claimed' then return null;end if;
 if j.created_at<clock_timestamp()-interval '4 minutes' then raise exception 'expired_job';end if;
 select w.user_id into v_author from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=j.persona and p.is_ai;
 if v_author is null or char_length(trim(p_title)) not between 2 and 80 or char_length(p_body) not between 200 and 4000 or p_tag!~'^[A-Z0-9]{1,20}$' or p_body not like '%알트모아 운영 AI 작성자%' then raise exception 'invalid_ai_post';end if;
 if exists(select 1 from public.posts p join public.profiles a on a.id=p.author_id where a.is_ai and lower(regexp_replace(p.title,'\s','','g'))=lower(regexp_replace(p_title,'\s','','g')) and p.created_at>now()-interval '7 days') then update public.ai_publish_jobs set state='skipped',error_code='duplicate_title' where slot=p_slot;return null;end if;
 insert into public.posts(author_id,category,title,body,tags)values(v_author,'분석',trim(p_title),p_body,array[p_tag])returning id into v_post;
 update public.ai_publish_jobs set state='published',post_id=v_post where slot=p_slot;return v_post;
end;$$;
revoke all on function public.finish_ai_publish(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_ai_publish(bigint,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
