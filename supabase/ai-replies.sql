-- Additive migration; existing comments/policies are preserved and RLS stays on.
begin;
alter table public.comments add column parent_comment_id uuid references public.comments(id) on delete set null;
create index comments_parent_thread on public.comments(post_id,parent_comment_id,created_at);
grant insert(parent_comment_id) on public.comments to authenticated;
create function public.validate_comment_parent()returns trigger language plpgsql set search_path='' as $$
declare v_id uuid:=new.parent_comment_id;v_parent record;v_depth int:=0;
begin
 while v_id is not null loop
  select post_id,status,parent_comment_id into v_parent from public.comments where id=v_id;
  if not found or v_parent.post_id<>new.post_id or v_parent.status<>'published' then raise exception '답글 대상을 찾을 수 없습니다.';end if;
  v_depth:=v_depth+1;if v_depth>5 then raise exception '답글은 최대 5단계까지 작성할 수 있습니다.';end if;
  v_id:=v_parent.parent_comment_id;
 end loop;
 return new;
end;$$;
revoke all on function public.validate_comment_parent() from public;
create trigger validate_comment_parent before insert on public.comments for each row execute function public.validate_comment_parent();
create table public.ai_reply_jobs(slot bigint primary key,persona text not null references public.ai_writers(persona),state text not null default 'claimed' check(state in('claimed','published','skipped','failed')),created_at timestamptz not null default now(),target_kind text check(target_kind in('post','comment')),target_id uuid,post_id uuid references public.posts(id) on delete set null,reply_id uuid references public.comments(id) on delete set null,error_code text,usage jsonb not null default '{}');
create index ai_reply_jobs_time on public.ai_reply_jobs(created_at);
create index ai_reply_jobs_thread on public.ai_reply_jobs(post_id,created_at) where state='published';
create unique index one_ai_reply_per_target on public.ai_reply_jobs(target_kind,target_id) where state='published';
alter table public.ai_reply_jobs enable row level security;
revoke all on public.ai_reply_jobs from public,anon,authenticated;
grant all on public.ai_reply_jobs to service_role;
grant select on public.ai_reply_jobs to authenticated;
create policy ai_replies_operator on public.ai_reply_jobs for select to authenticated using((select public.is_moderator()));
create function public.ai_reply_eligible(p_kind text,p_target uuid,p_author uuid)returns boolean language plpgsql stable security definer set search_path='' as $$
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
   if v_ai_chain>=2 then return false;end if;v_id:=v_target.parent_comment_id;
  end loop;
  v_id:=p_target;
  while v_id is not null loop
   select parent_comment_id into v_id from public.comments where id=v_id;
   v_depth:=v_depth+1;if v_depth>5 then return false;end if;
  end loop;
 else return false;
 end if;
 if not exists(select 1 from public.posts where id=v_post and status='published') then return false;end if;
 if exists(select 1 from public.ai_reply_jobs where target_kind=p_kind and target_id=p_target and state='published') then return false;end if;
 if (select count(*) from public.ai_reply_jobs where post_id=v_post and state='published' and created_at>now()-interval '24 hours')>=6 then return false;end if;
 return true;
end;$$;
revoke all on function public.ai_reply_eligible(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_reply_eligible(text,uuid,uuid) to service_role;
create function public.claim_ai_reply(p_persona text)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();v_slot bigint:=floor(extract(epoch from v_now)/300)::bigint;v_author uuid;v_candidates jsonb;
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
revoke all on function public.claim_ai_reply(text) from public,anon,authenticated;
grant execute on function public.claim_ai_reply(text) to service_role;
create function public.finish_ai_reply(p_slot bigint,p_kind text,p_target uuid,p_body text)returns uuid language plpgsql security definer set search_path='' as $$
declare j public.ai_reply_jobs;v_author uuid;v_post uuid;v_reply uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(6806313);
 select * into j from public.ai_reply_jobs where slot=p_slot for update;
 if not found or j.state<>'claimed' then return null;end if;
 select w.user_id into v_author from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=j.persona and p.is_ai;
 if j.created_at<clock_timestamp()-interval '4 minutes' or v_author is null or not public.ai_reply_eligible(p_kind,p_target,v_author) then
  update public.ai_reply_jobs set state='skipped',error_code='target_no_longer_eligible' where slot=p_slot;return null;
 end if;
 if char_length(p_body) not between 20 and 1800 or p_body not like '%알트모아 운영 AI 작성자%' then raise exception 'invalid_ai_reply';end if;
 if p_kind='post' then v_post:=p_target;else select post_id into v_post from public.comments where id=p_target;end if;
 insert into public.comments(author_id,post_id,parent_comment_id,body)values(v_author,v_post,case when p_kind='comment' then p_target else null end,p_body)returning id into v_reply;
 update public.ai_reply_jobs set state='published',target_kind=p_kind,target_id=p_target,post_id=v_post,reply_id=v_reply where slot=p_slot;
 return v_reply;
end;$$;
revoke all on function public.finish_ai_reply(bigint,text,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_ai_reply(bigint,text,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
