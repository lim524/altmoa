-- Return only requested, fresh public-market summaries from the existing private cache.
begin;
create or replace function public.ai_cached_technicals(p_symbols text[])returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x.item||jsonb_build_object('interval',c.interval)), '[]'::jsonb)
 from public.technical_rank_cache c cross join lateral jsonb_array_elements(c.snapshot->'items')as x(item)
 where c.interval in('1h','4h') and c.computed_at>now()-interval '5 minutes'
 and c.snapshot->>'scopeVersion'='volume100-v1'
 and x.item->>'symbol'=any(p_symbols[1:2]);
$$;
revoke all on function public.ai_cached_technicals(text[])from public,anon,authenticated;
grant execute on function public.ai_cached_technicals(text[])to service_role;
notify pgrst,'reload schema';
commit;
