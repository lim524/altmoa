-- Altmoa initial migration. Run once in a new Supabase project's SQL Editor.
begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 20),
  created_at timestamptz not null default now()
);
create table public.moderators (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('자유','분석','소식','질문')),
  coin text check (coin is null or coin ~ '^[A-Z0-9]{1,20}$'),
  title text not null check (char_length(trim(title)) between 2 and 100),
  body text not null check (char_length(trim(body)) between 2 and 10000),
  status text not null default 'published' check (status in ('published','hidden')),
  created_at timestamptz not null default now()
);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  status text not null default 'published' check (status in ('published','hidden')),
  created_at timestamptz not null default now()
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 2 and 500),
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id) = 1)
);
create unique index one_post_report_per_user on public.reports(reporter_id,post_id) where post_id is not null;
create unique index one_comment_report_per_user on public.reports(reporter_id,comment_id) where comment_id is not null;
create index posts_feed on public.posts(created_at desc) where status='published';
create index posts_author_time on public.posts(author_id,created_at desc);
create index posts_coin_feed on public.posts(coin,created_at desc) where status='published';
create index comments_thread on public.comments(post_id,created_at);
create index comments_author_time on public.comments(author_id,created_at desc);

create function public.is_moderator() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.moderators where user_id=(select auth.uid()));
$$;
revoke all on function public.is_moderator() from public;
grant execute on function public.is_moderator() to anon, authenticated;

create function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,nickname) values(new.id,
    case when char_length(trim(coalesce(new.raw_user_meta_data->>'nickname',''))) >= 2
    then left(trim(new.raw_user_meta_data->>'nickname'),20)
    else '모아_' || left(new.id::text,8) end);
  return new;
end;
$$;
revoke all on function public.create_profile() from public;
create trigger on_altmoa_user_created after insert on auth.users for each row execute function public.create_profile();
-- Backfill accounts created before this migration.
insert into public.profiles(id,nickname) select id,'모아_' || left(id::text,8) from auth.users on conflict do nothing;

-- Serialize per-author inserts and use a server timestamp, so parallel/backdated
-- requests cannot bypass the cooldown. Also bounds comment/post lengths in DB.
create function public.limit_writes() returns trigger language plpgsql set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.author_id::text || tg_table_name,0));
  new.created_at=clock_timestamp();
  if tg_table_name='posts' then
    if exists(select 1 from public.posts where author_id=new.author_id and created_at>new.created_at-interval '60 seconds') then
      raise exception '게시글은 60초에 한 번 작성할 수 있습니다.' using errcode='P0001';
    end if;
  else
    if exists(select 1 from public.comments where author_id=new.author_id and created_at>new.created_at-interval '10 seconds') then
      raise exception '댓글은 10초에 한 번 작성할 수 있습니다.' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.limit_writes() from public;
create trigger limit_posts before insert on public.posts for each row execute function public.limit_writes();
create trigger limit_comments before insert on public.comments for each row execute function public.limit_writes();

alter table public.profiles enable row level security;
alter table public.moderators enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
revoke all on public.profiles,public.moderators,public.posts,public.comments,public.reports from anon,authenticated;
grant select on public.profiles,public.posts,public.comments to anon,authenticated;
grant insert(author_id,category,coin,title,body) on public.posts to authenticated;
grant insert(author_id,post_id,body) on public.comments to authenticated;
grant insert(reporter_id,post_id,comment_id,reason) on public.reports to authenticated;
grant select on public.reports to authenticated;
grant delete on public.posts,public.comments to authenticated;
grant update(status) on public.posts,public.comments to authenticated;

create policy profiles_read on public.profiles for select using(true);
create policy posts_read on public.posts for select using(status='published' or (select public.is_moderator()));
create policy posts_create on public.posts for insert to authenticated with check(author_id=(select auth.uid()) and status='published');
create policy posts_delete on public.posts for delete to authenticated using(author_id=(select auth.uid()) or (select public.is_moderator()));
create policy posts_moderate on public.posts for update to authenticated using((select public.is_moderator())) with check((select public.is_moderator()));
create policy comments_read on public.comments for select using((status='published' or (select public.is_moderator())) and exists(select 1 from public.posts where posts.id=post_id and (posts.status='published' or (select public.is_moderator()))));
create policy comments_create on public.comments for insert to authenticated with check(author_id=(select auth.uid()) and status='published' and exists(select 1 from public.posts where posts.id=post_id and status='published'));
create policy comments_delete on public.comments for delete to authenticated using(author_id=(select auth.uid()) or (select public.is_moderator()));
create policy comments_moderate on public.comments for update to authenticated using((select public.is_moderator())) with check((select public.is_moderator()));
create policy reports_create on public.reports for insert to authenticated with check(reporter_id=(select auth.uid()));
create policy reports_read on public.reports for select to authenticated using(reporter_id=(select auth.uid()) or (select public.is_moderator()));
commit;
