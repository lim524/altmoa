begin;
create table if not exists public.ai_enrichment_cache(id integer primary key check(id=1),snapshot jsonb,computed_at timestamptz,lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz not null default '-infinity');
insert into public.ai_enrichment_cache(id)values(1)on conflict do nothing;
alter table public.ai_enrichment_cache enable row level security;
revoke all on public.ai_enrichment_cache from public,anon,authenticated;grant all on public.ai_enrichment_cache to service_role;
create or replace function public.claim_ai_enrichment(p_token uuid)returns jsonb language plpgsql security definer set search_path='' as $$declare r public.ai_enrichment_cache;begin
 select * into r from public.ai_enrichment_cache where id=1 for update;
 if r.computed_at>now()-interval '6 hours'or r.lease_until>now()or r.next_attempt_at>now()then return null;end if;
 update public.ai_enrichment_cache set lease_token=p_token,lease_until=now()+interval '2 minutes'where id=1;
 return jsonb_build_object('snapshot',r.snapshot);
end;$$;
create or replace function public.finish_ai_enrichment(p_token uuid,p_snapshot jsonb)returns boolean language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.ai_enrichment_cache where id=1 and lease_token=p_token for update;if not found then return false;end if;
 if p_snapshot is null then update public.ai_enrichment_cache set lease_token=null,lease_until=null,next_attempt_at=now()+interval '1 hour'where id=1;return false;end if;
 if octet_length(p_snapshot::text)>150000 or jsonb_typeof(p_snapshot->'terms')<>'array'or jsonb_array_length(p_snapshot->'terms')>20 or jsonb_typeof(p_snapshot->'images')<>'array'or jsonb_array_length(p_snapshot->'images')>24 then raise exception 'invalid_enrichment';end if;
 update public.ai_enrichment_cache set snapshot=p_snapshot,computed_at=now(),lease_token=null,lease_until=null,next_attempt_at=now()+interval '6 hours'where id=1;return true;
end;$$;
create table if not exists public.ai_post_media(post_id uuid primary key references public.posts(id)on delete cascade,image_id text not null,image_url text not null check(image_url like 'https://upload.wikimedia.org/%'or image_url like 'https://thumb.wikimedia.org/%'),source_url text not null check(source_url like 'https://commons.wikimedia.org/%'),author text not null,license text not null,license_url text not null,caption text not null,created_at timestamptz not null default now());
alter table public.ai_post_media enable row level security;
revoke all on public.ai_post_media from public,anon,authenticated;grant select on public.ai_post_media to anon,authenticated;grant all on public.ai_post_media to service_role;
create policy published_ai_media on public.ai_post_media for select to anon,authenticated using(exists(select 1 from public.posts p where p.id=post_id and p.status='published'));
create or replace function public.attach_ai_post_media(p_slot bigint,p_image_id text)returns boolean language plpgsql security definer set search_path='' as $$declare j public.ai_publish_jobs;img jsonb;begin
 select * into j from public.ai_publish_jobs where slot=p_slot and state='published'and created_at>now()-interval '10 minutes';if not found then return false;end if;
 if not exists(select 1 from public.posts p join public.ai_writers w on w.user_id=p.author_id join public.profiles a on a.id=w.user_id where p.id=j.post_id and w.persona=j.persona and a.is_ai and p.status='published')then return false;end if;
 select x into img from public.ai_enrichment_cache c cross join jsonb_array_elements(c.snapshot->'images')x where c.id=1 and x->>'id'=p_image_id limit 1;
 if img is null or img->>'license'not in('CC0','Public domain','CC BY 4.0','CC BY-SA 4.0','CC BY 3.0','CC BY-SA 3.0')then return false;end if;
 insert into public.ai_post_media(post_id,image_id,image_url,source_url,author,license,license_url,caption)values(j.post_id,p_image_id,img->>'url',img->>'source',left(img->>'author',160),img->>'license',img->>'licenseUrl','참고 이미지 · '||left(img->>'title',120))on conflict do nothing;return found;
end;$$;
revoke all on function public.claim_ai_enrichment(uuid),public.finish_ai_enrichment(uuid,jsonb),public.attach_ai_post_media(bigint,text)from public,anon,authenticated;
grant execute on function public.claim_ai_enrichment(uuid),public.finish_ai_enrichment(uuid,jsonb),public.attach_ai_post_media(bigint,text)to service_role;
notify pgrst,'reload schema';
commit;
