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
