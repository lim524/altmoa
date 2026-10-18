-- Add completed UTC daily baseline support; keep all history and RLS.
begin;
create or replace function public.finish_market_activity(p_token uuid,p_snapshot jsonb)returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_snapshot is not null and (p_snapshot->>'version' not in ('v1','v2') or jsonb_typeof(p_snapshot->'coins') is distinct from 'array' or jsonb_array_length(p_snapshot->'coins')>2000 or p_snapshot->>'status' not in ('ready','collecting')) then raise exception 'invalid_activity_snapshot';end if;
 update public.market_activity_cache set snapshot=coalesce(p_snapshot,snapshot),computed_at=case when p_snapshot is not null then now() else computed_at end,build_token=null,lease_until='-infinity',next_attempt_at=now()+case when p_snapshot is null then interval '1 minute' else interval '10 minutes' end where id=1 and build_token=p_token and lease_until>now();
 if not found then return false;end if;
 if p_snapshot is not null then insert into public.market_activity_history(recorded_at,snapshot) values(date_bin(interval '10 minutes',now(),'2026-01-01'::timestamptz),p_snapshot)on conflict do nothing;end if;
 return true;
end;$$;
create or replace function public.market_activity_context(p_at timestamptz,p_baseline boolean default false)returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('baseline',case when p_baseline then coalesce((select jsonb_agg(n.snapshot) from generate_series(0,6)d cross join lateral (select h.snapshot from public.market_activity_history h where h.recorded_at between (date_trunc('day',p_at at time zone 'UTC') at time zone 'UTC')-d*interval '1 day'-interval '20 minutes' and (date_trunc('day',p_at at time zone 'UTC') at time zone 'UTC')-d*interval '1 day'+interval '20 minutes' order by abs(extract(epoch from ((h.snapshot->>'asOf')::timestamptz-((date_trunc('day',p_at at time zone 'UTC') at time zone 'UTC')-d*interval '1 day')))) limit 1)n),'[]'::jsonb) else '[]'::jsonb end,
 'chart',coalesce((select jsonb_agg(jsonb_build_object('asOf',h.snapshot->>'asOf','version',h.snapshot->>'version','score',h.snapshot->'score') order by h.recorded_at) from public.market_activity_history h where h.recorded_at>=p_at-interval '25 hours'),'[]'::jsonb));
$$;
revoke all on function public.market_activity_context(timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.market_activity_context(timestamptz,boolean) to service_role;
notify pgrst,'reload schema';
commit;
