-- Existing service-only worker may occasionally post in the free board.
-- Preserves grants, AI identity checks, claim limits and atomic publication.
begin;
create or replace function public.finish_ai_publish(p_slot bigint,p_title text,p_body text,p_tag text)returns uuid language plpgsql security definer set search_path='' as $$
declare j public.ai_publish_jobs;v_author uuid;v_post uuid;
begin
 select * into j from public.ai_publish_jobs where slot=p_slot for update;
 if not found or j.state<>'claimed' then return null;end if;
 if j.created_at<clock_timestamp()-interval '4 minutes' then raise exception 'expired_job';end if;
 select w.user_id into v_author from public.ai_writers w join public.profiles p on p.id=w.user_id where w.persona=j.persona and p.is_ai;
 if v_author is null or char_length(trim(p_title)) not between 2 and 80 or char_length(p_body) not between 80 and 4000 or (p_tag is null or (p_tag<>'일상' and p_tag!~'^[A-Z0-9]{1,20}$')) then raise exception 'invalid_ai_post';end if;
 if exists(select 1 from public.posts p join public.profiles a on a.id=p.author_id where a.is_ai and lower(regexp_replace(p.title,'\s','','g'))=lower(regexp_replace(p_title,'\s','','g')) and p.created_at>now()-interval '7 days') then update public.ai_publish_jobs set state='skipped',error_code='duplicate_title' where slot=p_slot;return null;end if;
 insert into public.posts(author_id,category,title,body,tags)values(v_author,case when p_tag='일상' then '자유' else '분석' end,trim(p_title),p_body,array[p_tag])returning id into v_post;
 update public.ai_publish_jobs set state='published',post_id=v_post where slot=p_slot;return v_post;
end;$$;
notify pgrst,'reload schema';
commit;
