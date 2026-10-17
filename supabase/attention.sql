-- Additive migration: existing members/posts are preserved. Safe to run again.
begin;
create table if not exists public.attention_sources (
 id text primary key, name text not null, region text not null check(region in('kr','global')),
 status text not null default 'permission_required' check(status in('permission_required','api_required','collecting','paused','error','partial')),
 approved boolean not null default false, permission_ref text,
 feed_url text, link_prefix text not null,
 cursor_value text, policy_note text, coverage_started_at timestamptz,
 last_attempt_at timestamptz,last_success_at timestamptz,
 check(not approved or nullif(trim(permission_ref),'') is not null),
 check(feed_url is null or feed_url ~ '^https://')
);
create table if not exists public.external_documents (
 id uuid primary key default gen_random_uuid(),source_id text not null references public.attention_sources(id) on delete cascade,
 external_id text not null check(char_length(external_id) between 1 and 256),
 canonical_url text not null check(canonical_url ~ '^https://'),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 published_at timestamptz not null,collected_at timestamptz not null default now(),
 unique(source_id,external_id)
);
create table if not exists public.coin_mentions (
 document_id uuid not null references public.external_documents(id) on delete cascade,
 symbol text not null check(symbol ~ '^[A-Z0-9]{1,20}$'),primary key(document_id,symbol)
);
create table if not exists public.attention_hourly (
 source_id text not null references public.attention_sources(id) on delete cascade,
 symbol text not null,bucket timestamptz not null,mentions integer not null check(mentions>=0),
 primary key(source_id,symbol,bucket)
);
create table if not exists public.attention_runs (
 id uuid primary key default gen_random_uuid(),source_id text not null references public.attention_sources(id) on delete cascade,
 ran_at timestamptz not null default now(),success boolean not null,complete boolean not null default false,document_count integer not null default 0
);
create index if not exists external_documents_window on public.external_documents(published_at,source_id);
create index if not exists external_documents_fingerprint on public.external_documents(fingerprint);
create index if not exists attention_runs_coverage on public.attention_runs(source_id,ran_at desc);
create index if not exists coin_mentions_symbol on public.coin_mentions(symbol,document_id);

insert into public.attention_sources(id,name,region,status,policy_note,link_prefix) values
 ('dc_chart','디시 차트갤러리','kr','permission_required','사전 서면 동의 확보 전 자동 수집 보류','https://gall.dcinside.com/'),
 ('dc_bitcoin','디시 비트코인 갤러리','kr','permission_required','사전 서면 동의 확보 전 자동 수집 보류','https://gall.dcinside.com/'),
 ('coinpan','코인판','kr','permission_required','영리 이용 승낙 확보 전 자동 수집 보류','https://coinpan.com/'),
 ('x','X','global','api_required','API 이용 권한·연결 필요','https://x.com/'),
 ('reddit','Reddit','global','api_required','상업적 이용 조건·API 연결 필요','https://www.reddit.com/')
on conflict(id) do nothing;

alter table public.attention_sources enable row level security;
alter table public.external_documents enable row level security;
alter table public.coin_mentions enable row level security;
alter table public.attention_hourly enable row level security;
alter table public.attention_runs enable row level security;
revoke all on public.attention_sources,public.external_documents,public.coin_mentions,public.attention_hourly,public.attention_runs from anon,authenticated;
grant select(id,name,region,status,last_attempt_at,last_success_at,policy_note) on public.attention_sources to anon,authenticated;
grant all on public.attention_sources,public.external_documents,public.coin_mentions,public.attention_hourly,public.attention_runs to service_role;
drop policy if exists attention_source_status_read on public.attention_sources;
create policy attention_source_status_read on public.attention_sources for select using(true);

create or replace function public.ingest_attention_batch(p_source text,p_documents jsonb,p_complete boolean default true,p_cursor text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare src public.attention_sources;doc jsonb;did uuid;stamp timestamptz;kept integer:=0;
begin
 select * into src from public.attention_sources where id=p_source for update;
 if not found or not src.approved or src.permission_ref is null then raise exception 'Source not approved';end if;
 if jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents)>200 then raise exception 'Invalid batch';end if;
 for doc in select value from jsonb_array_elements(p_documents) loop
  if doc->>'id' is null or char_length(doc->>'id')>256 then raise exception 'Invalid document id';end if;
  if coalesce((doc->>'deleted')::boolean,false) then
   delete from public.external_documents where source_id=p_source and external_id=doc->>'id';continue;
  end if;
  stamp=(doc->>'publishedAt')::timestamptz;
  if stamp is null or stamp<now()-interval '8 days' or stamp>now()+interval '5 minutes' then raise exception 'Invalid publication timestamp';end if;
  if not starts_with(doc->>'url',src.link_prefix) then raise exception 'Unexpected source URL';end if;
  if jsonb_typeof(doc->'symbols')<>'array' or jsonb_array_length(doc->'symbols')>50 then raise exception 'Invalid symbols';end if;
  insert into public.external_documents(source_id,external_id,canonical_url,fingerprint,published_at)
   values(p_source,doc->>'id',doc->>'url',doc->>'fingerprint',stamp)
   on conflict(source_id,external_id) do update set canonical_url=excluded.canonical_url,fingerprint=excluded.fingerprint,published_at=excluded.published_at,collected_at=now()
   returning id into did;
  delete from public.coin_mentions where document_id=did;
  insert into public.coin_mentions(document_id,symbol) select did,value from jsonb_array_elements_text(doc->'symbols') on conflict do nothing;
  kept=kept+1;
 end loop;
 -- Retain only the metadata needed for the current window and baseline. No body,
 -- nickname, IP, author identifier, or raw title is stored in these tables.
 delete from public.external_documents where published_at<now()-interval '8 days';
 delete from public.attention_hourly where source_id=p_source;
 insert into public.attention_hourly(source_id,symbol,bucket,mentions)
  select d.source_id,m.symbol,date_trunc('hour',d.published_at),count(distinct d.fingerprint)::integer
  from public.external_documents d join public.coin_mentions m on m.document_id=d.id where d.source_id=p_source group by 1,2,3;
 insert into public.attention_runs(source_id,success,complete,document_count) values(p_source,true,p_complete,kept);
 delete from public.attention_runs where ran_at<now()-interval '9 days';
 update public.attention_sources set last_attempt_at=now(),last_success_at=case when p_complete then now() else last_success_at end,
  coverage_started_at=case when p_complete then coalesce(coverage_started_at,now()) else coverage_started_at end,
  cursor_value=p_cursor,status=case when p_complete then 'collecting' else 'partial' end where id=p_source;
 return kept;
end;$$;
revoke all on function public.ingest_attention_batch(text,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.ingest_attention_batch(text,jsonb,boolean,text) to service_role;

create or replace function public.attention_rank(p_hours integer default 24,p_sources text[] default null)
returns jsonb language sql stable security definer set search_path='' as $$
 with params as(select case when p_hours=1 then interval '1 hour' else interval '24 hours' end as win),
 active as(select * from public.attention_sources where approved and status='collecting' and last_success_at>now()-interval '20 minutes' and (p_sources is null or id=any(p_sources))),
 coverage as(select coalesce(bool_and(s.coverage_started_at<=now()-interval '8 days'
  and (select count(*) from public.attention_runs r where r.source_id=s.id and r.success and r.complete and r.ran_at>now()-interval '8 days')>=1037
  and not exists(select 1 from (select ran_at-lag(ran_at) over(order by ran_at) gap from (select now()-interval '8 days' ran_at union all select r.ran_at from public.attention_runs r where r.source_id=s.id and r.success and r.complete and r.ran_at>now()-interval '8 days' union all select now()) points) g where gap>interval '30 minutes')),false) ok from active s),
 current_docs as(select d.*,m.symbol,s.name source_name from public.external_documents d join public.coin_mentions m on m.document_id=d.id join active s on s.id=d.source_id,params p where d.published_at>=now()-p.win and d.published_at<=now()),
 counts as(select symbol,count(distinct fingerprint) mentions,count(distinct source_id) source_count from current_docs group by symbol),
 baseline as(select m.symbol,count(distinct (d.fingerprint,floor(extract(epoch from ((now()-p.win)-d.published_at))/extract(epoch from p.win))))::numeric/(case when p_hours=1 then 168 else 7 end) avg_count
  from public.external_documents d join public.coin_mentions m on m.document_id=d.id join active s on s.id=d.source_id,params p
  where d.published_at<now()-p.win and d.published_at>=now()-p.win-interval '7 days' group by m.symbol),
 result as(select c.symbol,c.mentions,c.source_count,
  case when (select ok from coverage) and c.mentions>=5 and b.avg_count>=1 then round(c.mentions/b.avg_count,1) else null end growth,
  (select coalesce(jsonb_agg(jsonb_build_object('url',x.canonical_url,'publishedAt',x.published_at,'sourceName',x.source_name)),'[]'::jsonb) from
   (select distinct canonical_url,published_at,source_name from current_docs d where d.symbol=c.symbol order by published_at desc limit 5) x) links
  from counts c left join baseline b on b.symbol=c.symbol order by c.mentions desc,c.symbol limit 20)
 select coalesce(jsonb_agg(jsonb_build_object('symbol',symbol,'mentions',mentions,'sourceCount',source_count,'growth',growth,'links',links)),'[]'::jsonb) from result;
$$;
revoke all on function public.attention_rank(integer,text[]) from public;
grant execute on function public.attention_rank(integer,text[]) to anon,authenticated,service_role;
commit;
