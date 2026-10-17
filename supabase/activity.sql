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
