-- Daily browser / AI reader deduplication. Only the server may record views.
begin;
alter table public.posts add column view_count bigint not null default 0 check(view_count>=0);
alter table public.posts add column ai_view_count bigint not null default 0 check(ai_view_count>=0 and ai_view_count<=view_count);
revoke update(view_count,ai_view_count) on public.posts from anon,authenticated;
create table public.post_view_readers(
 post_id uuid not null references public.posts(id) on delete cascade,
 viewer_hash text not null check(length(viewer_hash) between 3 and 80),
 view_day date not null,
 is_ai boolean not null,
 primary key(post_id,viewer_hash,view_day)
);
alter table public.post_view_readers enable row level security;
revoke all on public.post_view_readers from public,anon,authenticated;
grant all on public.post_view_readers to service_role;
create function public.record_post_views(p_posts uuid[],p_viewer text,p_is_ai boolean default false)
returns table(post_id uuid,view_count bigint,ai_view_count bigint) language plpgsql security definer set search_path='' as $$
declare v_post uuid;v_day date:=(now() at time zone 'Asia/Seoul')::date;v_added integer;
begin
 if coalesce(cardinality(p_posts),0) not between 1 and 3 or length(p_viewer) not between 3 and 80 or p_viewer is null then raise exception 'invalid_view_request';end if;
 if p_is_ai and not exists(select 1 from public.ai_writers where persona=substring(p_viewer from 4)) then raise exception 'invalid_ai_viewer';end if;
 for v_post in select distinct unnest(p_posts) order by 1 loop
  perform 1 from public.posts p where p.id=v_post and p.status='published' for update;
  if not found then continue;end if;
  insert into public.post_view_readers(post_id,viewer_hash,view_day,is_ai)values(v_post,p_viewer,v_day,p_is_ai)on conflict do nothing;
  get diagnostics v_added=row_count;
  if v_added>0 then update public.posts p set view_count=p.view_count+1,ai_view_count=p.ai_view_count+case when p_is_ai then 1 else 0 end where p.id=v_post;end if;
  return query select p.id,p.view_count,p.ai_view_count from public.posts p where p.id=v_post;
 end loop;
end;$$;
revoke all on function public.record_post_views(uuid[],text,boolean) from public,anon,authenticated;
grant execute on function public.record_post_views(uuid[],text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
