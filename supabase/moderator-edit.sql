-- Dedicated RPC: no broad update grants, ownership/profile fields cannot change.
begin;
create function public.moderator_edit_post(p_id uuid,p_title text,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not public.is_moderator() then raise exception '운영자 권한이 필요합니다.' using errcode='42501';end if;
 if p_title is null or char_length(trim(p_title)) not between 2 and 100
 or p_body is null or char_length(trim(p_body)) not between 2 and 10000 then
  raise exception '제목 또는 본문 길이를 확인하세요.';
 end if;
 update public.posts set title=trim(p_title),body=trim(p_body) where id=p_id returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.moderator_edit_post(uuid,text,text) from public,anon;
grant execute on function public.moderator_edit_post(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
