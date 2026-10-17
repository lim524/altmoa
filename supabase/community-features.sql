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
 new.tags := array(select distinct upper(x) from unnest(new.tags) x order by upper(x));
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
