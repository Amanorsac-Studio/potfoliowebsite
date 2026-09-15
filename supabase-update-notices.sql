-- =====================================================================
--  TELLING OWNERS ABOUT AN UPDATE
--
--  Somebody who bought an app a month ago has no reason to visit the
--  website again, and the Hub only tells them if it happens to be open.
--  This is the third way: an email, once, to the people who actually own
--  the thing that changed.
--
--  It is written to be impossible to send twice. One row per (person,
--  app, notice), inserted the moment the email is accepted, and the
--  candidate list is defined as "owns it and has no such row". A cron
--  that runs twice, a deploy mid-send, a retry after a timeout - none of
--  them can produce a second letter.
--
--  WHO GETS ONE. Owners of that app, and nobody else. Not the mailing
--  list, not everyone with an account, not people who own a different
--  app. A product update is a service message to a customer about the
--  thing they paid for, which is why it does not need a marketing
--  unsubscribe - but there is one anyway, in part 4, because somebody
--  who says stop should be able to say it once and be done.
--
--  Run the whole thing in the Supabase SQL editor. Safe to run twice.
-- =====================================================================


-- =====================================================================
--  1 · WHAT HAS BEEN SENT
-- =====================================================================

create table if not exists public.update_notices (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  app       text not null,
  -- The notice's own id, not the app's version: two notices about the
  -- same version (a correction, say) are two ids, and one notice that
  -- spans a version bump is still one.
  notice_id text not null,
  email     text not null,
  user_id   uuid references public.profiles(id) on delete cascade,
  unique (app, notice_id, email)
);

create index if not exists update_notices_app_idx on public.update_notices (app, notice_id);

alter table public.update_notices enable row level security;

drop policy if exists update_notices_admin on public.update_notices;
create policy update_notices_admin on public.update_notices
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));


-- =====================================================================
--  2 · WHO HAS OPTED OUT
--
--  Deliberately its own table rather than a column on profiles: opting
--  out of product mail should survive somebody deleting and remaking an
--  account with the same address, and it should be answerable without
--  an account existing at all.
-- =====================================================================

create table if not exists public.notice_optouts (
  email text primary key,
  at    timestamptz not null default now()
);

alter table public.notice_optouts enable row level security;

drop policy if exists notice_optouts_admin on public.notice_optouts;
create policy notice_optouts_admin on public.notice_optouts
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));


-- =====================================================================
--  3 · THE DOORS THE WORKER USES
-- =====================================================================

/* Everyone who owns this app and has not had this notice.
 *
 * A licence that has already expired is left out: telling somebody
 * whose thirty-day beta ended that there is a new build is an
 * advertisement, not a service message, and it is not what this is for.
 * Comped and tester licences are included - they own it. */
create or replace function public.update_notice_candidates(
  p_app text, p_notice_id text, p_limit int default 200
) returns table (email text, user_id uuid)
language sql security definer stable set search_path = '' as $$
  select u.email, p.user_id
  from public.purchases p
  join auth.users u on u.id = p.user_id
  where p.app = p_app
    and u.email is not null
    and (p.expires_at is null or p.expires_at > now())
    and not exists (
      select 1 from public.update_notices n
      where n.app = p_app and n.notice_id = p_notice_id
        and lower(n.email) = lower(u.email))
    and not exists (
      select 1 from public.notice_optouts o where lower(o.email) = lower(u.email))
  order by p.purchased_at desc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.update_notice_candidates(text,text,int) from public;
revoke all on function public.update_notice_candidates(text,text,int) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.update_notice_candidates(text,text,int) to service_role;
  end if;
end $$;

/* Written the moment the email is accepted, never before and never in a
 * batch at the end. If this row exists the letter has gone; if the
 * process dies between sending and marking, the worst case is one
 * duplicate, and the unique index above means a retry cannot add a
 * second. Returns true when it actually inserted, so a caller can tell
 * a fresh send from a race. */
create or replace function public.mark_update_notice_sent(
  p_app text, p_notice_id text, p_email text, p_user_id uuid default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.update_notices (app, notice_id, email, user_id)
  values (p_app, p_notice_id, lower(p_email), p_user_id);
  return true;
exception when unique_violation then
  return false;
end $$;

revoke all on function public.mark_update_notice_sent(text,text,text,uuid) from public;
revoke all on function public.mark_update_notice_sent(text,text,text,uuid) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mark_update_notice_sent(text,text,text,uuid) to service_role;
  end if;
end $$;

/* Stop. Called from the link at the bottom of every notice, through the
 * Worker, which has already checked the signature on that link - so an
 * address cannot be opted out by somebody who simply knows it. */
create or replace function public.notice_optout(p_email text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notice_optouts (email) values (lower(p_email))
  on conflict (email) do nothing;
$$;

revoke all on function public.notice_optout(text) from public;
revoke all on function public.notice_optout(text) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.notice_optout(text) to service_role;
  end if;
end $$;


-- =====================================================================
--  4 · WHAT WENT OUT  (admin only)
-- =====================================================================

create or replace function public.update_notice_report()
returns table (app text, notice_id text, sent bigint, first_at timestamptz, last_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select app, notice_id, count(*), min(at), max(at)
  from public.update_notices
  where public.is_admin()
  group by app, notice_id
  order by max(at) desc;
$$;


-- =====================================================================
--  5 · WHAT IS THERE NOW
-- =====================================================================

select 'notices sent' as thing, count(*) as n from public.update_notices
union all
select 'opted out', count(*) from public.notice_optouts;
