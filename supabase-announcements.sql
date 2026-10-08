-- =====================================================================
--  STUDIO NEWS TO THE PEOPLE WHO ASKED FOR IT
--
--  The update notices (supabase-update-notices.sql) go to the owners of
--  one app about that app. This is the other kind: a short "what's new
--  at the studio" letter. Rare, and written by hand each time.
--
--  Who gets it: ONLY people who ticked the "tell me first" box, either
--  when they made their account or when they took a free download. That
--  is the public.subscribers table (supabase-downloads.sql) with
--  consented = true. Having an account is not consent to marketing, so
--  an account alone is not enough; the letter is a marketing email and
--  the law (CAN-SPAM in the US, GDPR/PECR in Europe) wants a yes first.
--
--  Same rules as the notices, because they were the right rules:
--    - one row per (announcement, person), inserted before the letter
--      leaves, so a cron that runs twice or a retry cannot send twice
--    - anyone in notice_optouts, or with unsubscribed_at set, is skipped;
--      the link at the bottom of every letter puts them there, for good
--    - confirmed addresses only: the subscriber row was confirmed by a
--      download link, or the same address has a confirmed account. An
--      address that never clicked anything may not be theirs.
--
--  Needs supabase-downloads.sql and supabase-update-notices.sql to have
--  been run first. Run this whole file in the Supabase SQL editor. Safe
--  to run twice; running it again after an earlier version switches the
--  recipients to the opted-in list. The last query shows how many people
--  the next letter would reach.
-- =====================================================================


-- =====================================================================
--  1 · WHAT HAS BEEN SENT
-- =====================================================================

create table if not exists public.announcements_sent (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  announcement_id text not null,
  email           text not null,
  unique (announcement_id, email)
);

alter table public.announcements_sent enable row level security;

drop policy if exists announcements_sent_admin on public.announcements_sent;
create policy announcements_sent_admin on public.announcements_sent
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));


-- =====================================================================
--  2 · THE DOORS THE WORKER USES
-- =====================================================================

/* Everyone who said yes to hearing from the studio, whose address is
 * confirmed, who has not had this announcement and has not said stop.
 * Earliest consent first, so if a run is cut short the people who have
 * been waiting longest hear first. */
create or replace function public.announcement_candidates(
  p_id text, p_limit int default 100
) returns table (email text)
language sql security definer stable set search_path = '' as $$
  select lower(s.email)
  from public.subscribers s
  where s.consented
    and s.unsubscribed_at is null
    and (s.confirmed_at is not null
         or exists (select 1 from auth.users u
                    where lower(u.email) = lower(s.email)
                      and u.email_confirmed_at is not null
                      and u.deleted_at is null))
    and not exists (
      select 1 from public.announcements_sent t
      where t.announcement_id = p_id and t.email = lower(s.email))
    and not exists (
      select 1 from public.notice_optouts o where o.email = lower(s.email))
  order by coalesce(s.consented_at, s.created_at) asc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.announcement_candidates(text,int) from public;
revoke all on function public.announcement_candidates(text,int) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.announcement_candidates(text,int) to service_role;
  end if;
end $$;

/* Marked before the letter leaves. True when this call inserted the row,
 * false when someone else already had - the caller then leaves that
 * person alone. */
create or replace function public.mark_announcement_sent(p_id text, p_email text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.announcements_sent (announcement_id, email)
  values (p_id, lower(p_email));
  return true;
exception when unique_violation then
  return false;
end $$;

revoke all on function public.mark_announcement_sent(text,text) from public;
revoke all on function public.mark_announcement_sent(text,text) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mark_announcement_sent(text,text) to service_role;
  end if;
end $$;


-- =====================================================================
--  3 · WHAT WENT OUT  (admin only)
-- =====================================================================

create or replace function public.announcement_report()
returns table (announcement_id text, sent bigint, first_at timestamptz, last_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select announcement_id, count(*), min(at), max(at)
  from public.announcements_sent
  where public.is_admin()
  group by announcement_id
  order by max(at) desc;
$$;


-- =====================================================================
--  4 · WHO THE NEXT ONE WOULD REACH
-- =====================================================================

select 'confirmed accounts (not all of them get news)' as thing, count(*) as n
  from auth.users where email is not null and email_confirmed_at is not null and deleted_at is null
union all
select 'said yes to studio news', count(*)
  from public.subscribers where consented and unsubscribed_at is null
union all
select 'said stop', count(*) from public.notice_optouts
union all
select 'will get 2026-10-studio-news', count(*)
  from public.announcement_candidates('2026-10-studio-news', 500);
