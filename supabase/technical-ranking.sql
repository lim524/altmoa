-- Shared, server-only ranking snapshots. Only three interval records are allowed.
begin;
create table public.technical_rank_cache(
 interval text primary key check(interval in ('1h','4h','1d')),
 snapshot jsonb,
 computed_at timestamptz,
 lease_until timestamptz not null default '-infinity',
 next_attempt_at timestamptz not null default '-infinity',
 build_token uuid
);
alter table public.technical_rank_cache enable row level security;
revoke all on public.technical_rank_cache from public,anon,authenticated;
grant all on public.technical_rank_cache to service_role;
create function public.claim_technical_rank(p_interval text,p_token uuid)returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_interval not in ('1h','4h','1d') or p_interval is null or p_token is null then raise exception 'invalid_rank_request';end if;
 insert into public.technical_rank_cache(interval)values(p_interval)on conflict do nothing;
 update public.technical_rank_cache set lease_until=now()+interval '120 seconds',build_token=p_token
 where interval=p_interval and lease_until<now() and next_attempt_at<=now() and (computed_at is null or computed_at<now()-interval '5 minutes');
 return found;
end;$$;
create function public.finish_technical_rank(p_interval text,p_token uuid,p_snapshot jsonb)returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_snapshot is not null and (jsonb_typeof(p_snapshot->'items') is distinct from 'array' or p_snapshot->>'interval' is distinct from p_interval or jsonb_array_length(p_snapshot->'items')>2000) then raise exception 'invalid_rank_snapshot';end if;
 update public.technical_rank_cache set snapshot=coalesce(p_snapshot,snapshot),computed_at=case when p_snapshot is not null then now() else computed_at end,
 lease_until='-infinity',build_token=null,next_attempt_at=now()+case when p_snapshot is null then interval '1 minute' else interval '5 minutes' end
 where interval=p_interval and build_token=p_token and lease_until>now();
 return found;
end;$$;
revoke all on function public.claim_technical_rank(text,uuid),public.finish_technical_rank(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_technical_rank(text,uuid),public.finish_technical_rank(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
