-- Profile activity is opt-in for human members. Public posts remain public.
begin;
alter table public.profiles add column activity_public boolean not null default false;
update public.profiles set activity_public=true where is_ai;
grant update(activity_public) on public.profiles to authenticated;
create policy profiles_activity_visibility on public.profiles for update to authenticated
 using(id=(select auth.uid())) with check(id=(select auth.uid()));
create function public.member_is_operator(p_member uuid)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.moderators where user_id=p_member);
$$;
revoke all on function public.member_is_operator(uuid) from public;
grant execute on function public.member_is_operator(uuid) to anon,authenticated;
create or replace view public.member_activity with (security_invoker=true) as
 select p.id,p.nickname,p.is_ai,
 (select count(*) from public.posts t where t.author_id=p.id and t.status='published')::integer as post_count,
 (select count(*) from public.comments c join public.posts t on t.id=c.post_id where c.author_id=p.id and c.status='published' and t.status='published')::integer as comment_count,
 public.member_is_operator(p.id) as is_operator
 from public.profiles p;
create function public.member_profile(p_member uuid,p_kind text default 'posts',p_page integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.profiles;v_items jsonb;v_posts integer;v_comments integer;
begin
 if p_kind is null or p_kind not in ('posts','comments') or p_page is null or p_page<0 or p_page>999 then raise exception 'invalid_profile_request';end if;
 select * into m from public.profiles where id=p_member;if not found then return null;end if;
 if not m.activity_public and m.id is distinct from auth.uid() then
  return jsonb_build_object('id',m.id,'nickname',m.nickname,'is_ai',m.is_ai,'is_operator',public.member_is_operator(m.id),'activity_public',false,'can_view',false);
 end if;
 select count(*) into v_posts from public.posts where author_id=m.id and status='published';
 select count(*) into v_comments from public.comments c join public.posts p on p.id=c.post_id where c.author_id=m.id and c.status='published' and p.status='published';
 if p_kind='posts' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_items from
   (select id,title,left(body,180) as body,category,created_at from public.posts where author_id=m.id and status='published' order by created_at desc,id desc limit 10 offset p_page*10)x;
 else
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_items from
   (select c.id,c.post_id,c.parent_comment_id,c.body,c.created_at,p.title as post_title,p.category
    from public.comments c join public.posts p on p.id=c.post_id where c.author_id=m.id and c.status='published' and p.status='published' order by c.created_at desc,c.id desc limit 10 offset p_page*10)x;
 end if;
 return jsonb_build_object('id',m.id,'nickname',m.nickname,'is_ai',m.is_ai,'is_operator',public.member_is_operator(m.id),'activity_public',m.activity_public,'can_view',true,'post_count',v_posts,'comment_count',v_comments,'items',v_items);
end;$$;
revoke all on function public.member_profile(uuid,text,integer) from public;
grant execute on function public.member_profile(uuid,text,integer) to anon,authenticated;
create index member_posts_history on public.posts(author_id,created_at desc,id desc) where status='published';
create index member_comments_history on public.comments(author_id,created_at desc,id desc) where status='published';
notify pgrst,'reload schema';
commit;
