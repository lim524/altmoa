-- AI disclosure remains on the author badge. Preserve service-only RPC grants,
-- AI profile checks, quotas, freshness and atomic writes. No RLS changes.
begin;
create or replace function public.finish_ai_publish(p_slot bigint,p_title text,p_body text,p_tag text)returns uuid language plpgsql security definer set search_path='' as $$
declare j public.ai_publish_jobs;v_author uuid;v_post uuid;
begin
 select * into j from public.ai_publish_jobs where slot=p_slot for update;
 if not found or j.state<>'claimed' then return null;end if;
 if j.created_at<clock_timestamp()-interval '4 minutes' then raise exception 'expired_job';end if;
 select w.user_id into v_author from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=j.persona and p.is_ai;
 if v_author is null or char_length(trim(p_title)) not between 2 and 80 or char_length(p_body) not between 80 and 4000 or p_tag!~'^[A-Z0-9]{1,20}$' then raise exception 'invalid_ai_post';end if;
 if exists(select 1 from public.posts p join public.profiles a on a.id=p.author_id where a.is_ai and lower(regexp_replace(p.title,'\s','','g'))=lower(regexp_replace(p_title,'\s','','g')) and p.created_at>now()-interval '7 days') then update public.ai_publish_jobs set state='skipped',error_code='duplicate_title' where slot=p_slot;return null;end if;
 insert into public.posts(author_id,category,title,body,tags)values(v_author,'분석',trim(p_title),p_body,array[p_tag])returning id into v_post;
 update public.ai_publish_jobs set state='published',post_id=v_post where slot=p_slot;return v_post;
end;$$;
create or replace function public.finish_ai_reply(p_slot bigint,p_kind text,p_target uuid,p_body text)returns uuid language plpgsql security definer set search_path='' as $$
declare j public.ai_reply_jobs;v_author uuid;v_post uuid;v_reply uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(6806313);
 select * into j from public.ai_reply_jobs where slot=p_slot for update;
 if not found or j.state<>'claimed' then return null;end if;
 select w.user_id into v_author from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=j.persona and p.is_ai;
 if j.created_at<clock_timestamp()-interval '4 minutes' or v_author is null or not public.ai_reply_eligible(p_kind,p_target,v_author) then
  update public.ai_reply_jobs set state='skipped',error_code='target_no_longer_eligible' where slot=p_slot;return null;
 end if;
 if char_length(p_body) not between 40 and 1800 then raise exception 'invalid_ai_reply';end if;
 if p_kind='post' then v_post:=p_target;else select post_id into v_post from public.comments where id=p_target;end if;
 insert into public.comments(author_id,post_id,parent_comment_id,body)values(v_author,v_post,case when p_kind='comment' then p_target else null end,p_body)returning id into v_reply;
 update public.ai_reply_jobs set state='published',target_kind=p_kind,target_id=p_target,post_id=v_post,reply_id=v_reply where slot=p_slot;
 return v_reply;
end;$$;

-- Clean only automatically published AI content, independent of newline format.
update public.posts p set body=rtrim(split_part(split_part(p.body,'[시세 기준]',1),'알트모아 운영 AI 작성자',1))
where p.id in(select post_id from public.ai_publish_jobs where state='published')
 and exists(select 1 from public.profiles a where a.id=p.author_id and a.is_ai)
 and (position('[시세 기준]' in p.body)>0 or position('알트모아 운영 AI 작성자' in p.body)>0);
update public.comments c set body=rtrim(split_part(c.body,'알트모아 운영 AI 작성자',1))
where c.id in(select reply_id from public.ai_reply_jobs where state='published')
 and exists(select 1 from public.profiles a where a.id=c.author_id and a.is_ai)
 and position('알트모아 운영 AI 작성자' in c.body)>0;
notify pgrst,'reload schema';
commit;
