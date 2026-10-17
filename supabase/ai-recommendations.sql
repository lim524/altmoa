-- AI reactions are labelled separately and never inflate human recommendations.
begin;
alter table public.posts add column ai_recommendation_count integer not null default 0 check(ai_recommendation_count>=0);
revoke update(ai_recommendation_count) on public.posts from anon,authenticated;
create table public.ai_post_recommendations(
 post_id uuid not null references public.posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(post_id,user_id)
);
alter table public.ai_post_recommendations enable row level security;
revoke all on public.ai_post_recommendations from public,anon,authenticated;
grant all on public.ai_post_recommendations to service_role;
create function public.sync_ai_recommendation_count()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then update public.posts set ai_recommendation_count=ai_recommendation_count+1 where id=new.post_id;
 else update public.posts set ai_recommendation_count=greatest(0,ai_recommendation_count-1) where id=old.post_id;end if;
 return null;
end;$$;
revoke all on function public.sync_ai_recommendation_count() from public;
create trigger sync_ai_post_recommendations after insert or delete on public.ai_post_recommendations for each row execute function public.sync_ai_recommendation_count();
create function public.recommend_ai_post(p_persona text,p_post uuid)returns boolean language plpgsql security definer set search_path='' as $$
declare v_author uuid;v_inserted uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(6806314);
 select w.user_id into v_author from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=p_persona and p.is_ai;
 if v_author is null then return false;end if;
 perform 1 from public.posts where id=p_post and status='published' and author_id<>v_author for update;
 if not found then return false;end if;
 if exists(select 1 from public.ai_post_recommendations where post_id=p_post and user_id=v_author) then return false;end if;
 if(select count(*) from public.ai_post_recommendations where user_id=v_author and created_at>now()-interval '1 hour')>=12
 or(select count(*) from public.ai_post_recommendations where user_id=v_author and created_at>now()-interval '24 hours')>=288 then return false;end if;
 insert into public.ai_post_recommendations(post_id,user_id)values(p_post,v_author)on conflict do nothing returning user_id into v_inserted;
 return v_inserted is not null;
end;$$;
revoke all on function public.recommend_ai_post(text,uuid) from public,anon,authenticated;
grant execute on function public.recommend_ai_post(text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
