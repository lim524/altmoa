-- Existing Altmoa installation: paste this complete file into Supabase SQL Editor and Run.
-- schema.sql must already be installed. Re-runnable.

-- Run after schema.sql in Supabase SQL Editor. Safe to run again.
begin;
alter table public.posts add column if not exists recommendation_count integer not null default 0 check(recommendation_count>=0);
create table if not exists public.post_recommendations (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
alter table public.post_recommendations enable row level security;
revoke all on public.post_recommendations from anon,authenticated;
grant select,delete on public.post_recommendations to authenticated;
grant insert(post_id,user_id) on public.post_recommendations to authenticated;
revoke update(recommendation_count) on public.posts from anon,authenticated;
drop policy if exists recommendations_read on public.post_recommendations;
create policy recommendations_read on public.post_recommendations for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists recommendations_create on public.post_recommendations;
create policy recommendations_create on public.post_recommendations for insert to authenticated with check(
 user_id=(select auth.uid()) and exists(select 1 from public.posts p where p.id=post_id and p.status='published' and p.author_id<>(select auth.uid()))
);
drop policy if exists recommendations_delete on public.post_recommendations;
create policy recommendations_delete on public.post_recommendations for delete to authenticated using(user_id=(select auth.uid()));
create or replace function public.sync_recommendation_count() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
   update public.posts set recommendation_count=recommendation_count+1 where id=new.post_id;
 else
   update public.posts set recommendation_count=greatest(0,recommendation_count-1) where id=old.post_id;
 end if;
 return null;
end;
$$;
revoke all on function public.sync_recommendation_count() from public;
drop trigger if exists sync_post_recommendations on public.post_recommendations;
create trigger sync_post_recommendations after insert or delete on public.post_recommendations for each row execute function public.sync_recommendation_count();
-- DDL above locks recommendation writes while initial counts are reconciled.
update public.posts p set recommendation_count=(select count(*) from public.post_recommendations r where r.post_id=p.id);
create index if not exists posts_popular on public.posts(recommendation_count desc,created_at desc,id desc) where status='published' and recommendation_count>0;
create index if not exists posts_category_popular on public.posts(category,recommendation_count desc,created_at desc,id desc) where status='published' and recommendation_count>0;
notify pgrst,'reload schema';
commit;


-- Run after schema.sql. Public activity reflects published, readable content only.
begin;
alter table public.profiles add column if not exists is_ai boolean not null default false;
revoke update(is_ai) on public.profiles from anon,authenticated;
create or replace view public.member_activity with (security_invoker=true) as
 select p.id,p.nickname,p.is_ai,
 (select count(*) from public.posts t where t.author_id=p.id and t.status='published')::integer as post_count,
 (select count(*) from public.comments c join public.posts t on t.id=c.post_id where c.author_id=p.id and c.status='published' and t.status='published')::integer as comment_count
 from public.profiles p;
revoke all on public.member_activity from anon,authenticated;
grant select on public.member_activity to anon,authenticated;
notify pgrst,'reload schema';
commit;


-- Run after schema.sql. Re-runnable. Existing untagged posts remain readable.
begin;
alter table public.posts add column if not exists tags text[] not null default '{}';
alter table public.posts add column if not exists images text[] not null default '{}';
alter table public.posts add column if not exists poll_question text;
alter table public.posts add column if not exists poll_options text[] not null default '{}';
update public.posts set tags=array[coin] where coin is not null and cardinality(tags)=0;
create index if not exists posts_tags on public.posts using gin(tags);
grant insert(tags,images,poll_question,poll_options) on public.posts to authenticated;
create or replace function public.validate_post_features() returns trigger language plpgsql set search_path='' as $$
declare t text; p text;
begin
 if cardinality(new.tags) not between 1 and 10 then raise exception '태그는 1개 이상 10개 이하로 입력하세요.'; end if;
 foreach t in array new.tags loop
  if t is null or t !~ '^[a-zA-Z0-9가-힣_]{1,20}$' then raise exception '태그 형식을 확인하세요.'; end if;
 end loop;
 select array_agg(distinct upper(x) order by upper(x)) into new.tags from unnest(new.tags) x;
 new.coin=case when new.tags[1] ~ '^[A-Z0-9]{1,20}$' then new.tags[1] else null end;
 if cardinality(new.images)>3 then raise exception '사진은 최대 3장입니다.'; end if;
 foreach p in array new.images loop
  if p is null or p !~ ('^' || new.author_id::text || '/[a-f0-9-]{36}\.jpg$') then raise exception '사진 경로가 올바르지 않습니다.'; end if;
 end loop;
 if cardinality(new.poll_options)=0 then new.poll_question=null;
 else
  if cardinality(new.poll_options) not between 2 and 6 or char_length(trim(new.poll_question)) not between 2 and 100 or new.poll_question is null then raise exception '투표 질문과 2~6개 선택지를 입력하세요.'; end if;
  foreach t in array new.poll_options loop
   if t is null or char_length(trim(t)) not between 1 and 80 then raise exception '투표 선택지는 1~80자입니다.'; end if;
  end loop;
  if (select count(distinct trim(x)) from unnest(new.poll_options) x) <> cardinality(new.poll_options) then raise exception '중복 선택지는 사용할 수 없습니다.'; end if;
 end if;
 return new;
end; $$;
revoke all on function public.validate_post_features() from public;
drop trigger if exists validate_post_features on public.posts;
create trigger validate_post_features before insert on public.posts for each row execute function public.validate_post_features();
create table if not exists public.poll_votes(
 post_id uuid not null references public.posts(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 option_index integer not null check(option_index between 0 and 5),
 primary key(post_id,user_id)
);
alter table public.poll_votes enable row level security;
revoke all on public.poll_votes from anon,authenticated;
grant select,insert on public.poll_votes to authenticated;
drop policy if exists poll_own on public.poll_votes;
create policy poll_own on public.poll_votes for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists poll_cast on public.poll_votes;
create policy poll_cast on public.poll_votes for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.posts p where p.id=post_id and p.status='published' and option_index<cardinality(p.poll_options)));
create or replace function public.poll_results(p_post uuid) returns table(option_index integer,votes bigint) language sql stable security definer set search_path='' as $$
 select v.option_index,count(*) from public.poll_votes v join public.posts p on p.id=v.post_id where p.id=p_post and p.status='published' group by v.option_index;
$$;
revoke all on function public.poll_results(uuid) from public;
grant execute on function public.poll_results(uuid) to anon,authenticated;
-- Private photos: public readers can sign only images attached to visible posts.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('post-images','post-images',false,2097152,array['image/jpeg']) on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['image/jpeg'];
drop policy if exists altmoa_image_upload on storage.objects;
create policy altmoa_image_upload on storage.objects for insert to authenticated with check(bucket_id='post-images' and (storage.foldername(name))[1]=(select auth.uid())::text and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.jpg$');
drop policy if exists altmoa_image_read on storage.objects;
create policy altmoa_image_read on storage.objects for select to anon,authenticated using(bucket_id='post-images' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_moderator()) or exists(select 1 from public.posts p where p.status='published' and p.images @> array[name])));
drop policy if exists altmoa_image_delete on storage.objects;
create policy altmoa_image_delete on storage.objects for delete to authenticated using(bucket_id='post-images' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_moderator())));
commit;


begin;
create table if not exists public.support_tickets(
 id uuid primary key default gen_random_uuid(),email text not null,subject text not null,body text not null,created_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from anon,authenticated;
grant select,delete on public.support_tickets to authenticated;
drop policy if exists support_moderator on public.support_tickets;
create policy support_moderator on public.support_tickets for select to authenticated using((select public.is_moderator()));
drop policy if exists support_delete on public.support_tickets;
create policy support_delete on public.support_tickets for delete to authenticated using((select public.is_moderator()));
create index if not exists support_email_time on public.support_tickets(email,created_at desc);
create or replace function public.submit_support(p_email text,p_subject text,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare e text:=lower(trim(p_email));
begin
 if e is null or char_length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_subject is null or char_length(trim(p_subject)) not between 2 and 100 or p_body is null or char_length(trim(p_body)) not between 10 and 3000 then raise exception '문의 입력 형식을 확인하세요.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(e,7));
 if exists(select 1 from public.support_tickets where email=e and created_at>now()-interval '5 minutes') then raise exception '동일 이메일 문의는 5분 뒤 다시 접수할 수 있습니다.'; end if;
 insert into public.support_tickets(email,subject,body) values(e,trim(p_subject),trim(p_body));
end; $$;
revoke all on function public.submit_support(text,text,text) from public;
grant execute on function public.submit_support(text,text,text) to anon,authenticated;
commit;
