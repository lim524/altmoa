begin;
create table if not exists public.support_tickets(
 id uuid primary key default gen_random_uuid(),email text not null,subject text not null,body text not null,created_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from anon,authenticated;
grant select,delete on public.support_tickets to authenticated;
drop policy if exists support_moderator on public.support_tickets;
create policy support_moderator on public.support_tickets for select to authenticated using((select public.is_moderator()));
drop policy if exists support_delete on public.support_tickets;
create policy support_delete on public.support_tickets for delete to authenticated using((select public.is_moderator()));
create index if not exists support_email_time on public.support_tickets(email,created_at desc);
create or replace function public.submit_support(p_email text,p_subject text,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare e text:=lower(trim(p_email));
begin
 if e is null or char_length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_subject is null or char_length(trim(p_subject)) not between 2 and 100 or p_body is null or char_length(trim(p_body)) not between 10 and 3000 then raise exception '문의 입력 형식을 확인하세요.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(e,7));
 if exists(select 1 from public.support_tickets where email=e and created_at>now()-interval '5 minutes') then raise exception '동일 이메일 문의는 5분 뒤 다시 접수할 수 있습니다.'; end if;
 insert into public.support_tickets(email,subject,body) values(e,trim(p_subject),trim(p_body));
end; $$;
revoke all on function public.submit_support(text,text,text) from public;
grant execute on function public.submit_support(text,text,text) to anon,authenticated;
commit;
