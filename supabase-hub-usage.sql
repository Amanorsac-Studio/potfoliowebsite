-- =====================================================================
--  AMANORSAC HUB · USAGE NOTES
--  Run this in Supabase → SQL Editor → New query → Run.
--  Safe to run again: everything is create-or-replace or
--  create-if-not-exists, so re-running upgrades in place and never
--  touches what has already been collected.
--
--  WHAT THIS IS FOR
--    One question, asked honestly: which apps are actually opened, how
--    often, and on what kind of machine. That is what tells you where
--    the next build should go. Nothing here is about a person.
--
--  WHAT IS STORED
--    event        hub_open | app_open | app_install | app_update
--    app          which app, when the event is about one
--    versions     the app's version and the Hub's
--    platform     windows | mac, plus arch and the OS release string
--    install_id   a random number belonging to one installation of the
--                 Hub. It separates "two machines" from "twice on one",
--                 and it is not derived from anything about the machine
--                 or the person - it is a UUID made on first run.
--    account      the signed-in account, only so a person can be given
--                 or shown their own record if they ever ask, and so a
--                 deleted account takes its notes with it.
--
--  WHAT IS NOT STORED
--    No file names, folder names, computer names, IP addresses, project
--    contents or anything from inside an app. The Hub does not read
--    them, so there is nothing here to leave out.
--
--  CONSENT
--    The Hub records nothing until the person says yes, and dropping
--    the queue is what "no" does on their machine. This file is the
--    other half: revoke_hub_usage() lets an account erase everything
--    already sent, and is callable by that account alone.
--
--  HOW IT IS PROTECTED
--    RLS is on with no policies, which denies everything by default.
--    Writing happens through one SECURITY DEFINER function that can
--    only insert. Reading happens through reporting functions that
--    check is_admin() first and return counts, never raw rows.
-- =====================================================================


-- =====================================================================
--  0 · CLEAR OUT ANY EARLIER VERSION OF THE FUNCTIONS
--
--  create-or-replace can change a function's body but not the shape of
--  what it returns, and a changed argument list makes a second overload
--  rather than replacing the first. So drop by name, whatever the
--  arguments, and let the rest of this file put the current ones back.
--  The table and its rows are never touched.
-- =====================================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'record_hub_usage', 'revoke_hub_usage',
        'hub_usage_summary', 'hub_usage_by_app', 'hub_usage_daily')
  loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;


-- =====================================================================
--  1 · THE NOTES
-- =====================================================================

create table if not exists public.hub_usage (
  id           bigserial primary key,
  account_id   uuid references auth.users (id) on delete cascade,
  install_id   uuid not null,
  event        text not null,
  app          text,
  app_version  text,
  hub_version  text,
  platform     text,
  arch         text,
  os_release   text,
  -- When it happened on the machine. A note made offline keeps its own
  -- time; received_at is when it reached here, which can be days later.
  occurred_at  timestamptz not null,
  received_at  timestamptz not null default now()
);

-- The same note sent twice - a flush that succeeded but whose
-- acknowledgement never arrived - is one note, not two.
create unique index if not exists hub_usage_once
  on public.hub_usage (install_id, event, occurred_at, coalesce(app, ''));
create index if not exists hub_usage_app_idx  on public.hub_usage (app, occurred_at desc);
create index if not exists hub_usage_when_idx on public.hub_usage (occurred_at desc);

alter table public.hub_usage enable row level security;
-- No policies on purpose: nobody reads this table directly. The
-- functions below are the only way in and the only way out.


-- =====================================================================
--  2 · WRITING
--
--  The Hub sends a batch: everything it has been holding since the last
--  time the site answered. Anything unrecognised in the batch is
--  ignored rather than rejected, so an older Hub and a newer one can
--  both keep sending while a release is rolling out.
-- =====================================================================

create or replace function public.record_hub_usage(
  p_install_id uuid,
  p_events     jsonb
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_written integer := 0;
  v_uid     uuid := auth.uid();
begin
  if p_install_id is null or p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;
  -- A batch is a batch, not a bulk load.
  if jsonb_array_length(p_events) > 200 then
    return 0;
  end if;

  insert into public.hub_usage
    (account_id, install_id, event, app, app_version, hub_version,
     platform, arch, os_release, occurred_at)
  select
    v_uid,
    p_install_id,
    e ->> 'event',
    nullif(left(e ->> 'app', 60), ''),
    nullif(left(e ->> 'app_version', 40), ''),
    nullif(left(e ->> 'hub_version', 40), ''),
    nullif(left(e ->> 'platform', 20), ''),
    nullif(left(e ->> 'arch', 20), ''),
    nullif(left(e ->> 'os_release', 40), ''),
    coalesce((e ->> 'at')::timestamptz, now())
  from jsonb_array_elements(p_events) as e
  where e ->> 'event' in ('hub_open', 'app_open', 'app_install', 'app_update')
    -- A clock that is wrong by years should not become a data point.
    and coalesce((e ->> 'at')::timestamptz, now())
        between now() - interval '400 days' and now() + interval '2 days'
  on conflict do nothing;

  get diagnostics v_written = row_count;
  return v_written;
exception
  -- A malformed batch is not worth an error the person has to see.
  when others then return 0;
end $$;

revoke all on function public.record_hub_usage(uuid, jsonb) from public;
grant execute on function public.record_hub_usage(uuid, jsonb) to anon, authenticated;


-- =====================================================================
--  3 · CHANGING YOUR MIND
--
--  Turning the switch off in the Hub stops the recording and empties
--  what is waiting on that machine. This erases what already arrived.
--  An account can only ever reach its own rows.
-- =====================================================================

create or replace function public.revoke_hub_usage()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_deleted integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  delete from public.hub_usage where account_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.revoke_hub_usage() from public;
grant execute on function public.revoke_hub_usage() to authenticated;


-- =====================================================================
--  4 · READING - ADMIN ONLY
--
--  Counts, never rows. Each of these refuses anyone who is not an
--  admin, using the same is_admin() the rest of the site uses.
-- =====================================================================

-- The shape of things over the last N days.
create or replace function public.hub_usage_summary(p_days integer default 30)
returns table (
  installs       bigint,   -- distinct machines running the Hub
  accounts       bigint,   -- distinct accounts behind them
  hub_opens      bigint,
  app_opens      bigint,
  installs_done  bigint,
  updates_done   bigint,
  windows_share  numeric,  -- 0-1, by machine
  mac_share      numeric
)
language plpgsql security definer set search_path = ''
as $$
declare v_since timestamptz := now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval;
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;
  return query
  with rows as (select * from public.hub_usage where occurred_at >= v_since),
       machines as (select distinct install_id, platform from rows)
  select
    (select count(distinct install_id) from rows),
    (select count(distinct account_id) from rows where account_id is not null),
    (select count(*) from rows where event = 'hub_open'),
    (select count(*) from rows where event = 'app_open'),
    (select count(*) from rows where event = 'app_install'),
    (select count(*) from rows where event = 'app_update'),
    (select round(count(*) filter (where platform = 'windows')::numeric
                  / nullif(count(*), 0), 3) from machines),
    (select round(count(*) filter (where platform = 'mac')::numeric
                  / nullif(count(*), 0), 3) from machines);
end $$;

revoke all on function public.hub_usage_summary(integer) from public;
grant execute on function public.hub_usage_summary(integer) to authenticated;


-- Which apps are actually used, and how deeply. opens_per_machine is
-- the number that answers "is this a tool or a curiosity".
create or replace function public.hub_usage_by_app(p_days integer default 30)
returns table (
  app               text,
  machines          bigint,
  opens             bigint,
  opens_per_machine numeric,
  installs          bigint,
  updates           bigint,
  last_opened       timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare v_since timestamptz := now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval;
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;
  return query
  select
    u.app,
    count(distinct u.install_id),
    count(*) filter (where u.event = 'app_open'),
    round(count(*) filter (where u.event = 'app_open')::numeric
          / nullif(count(distinct u.install_id), 0), 2),
    count(*) filter (where u.event = 'app_install'),
    count(*) filter (where u.event = 'app_update'),
    max(u.occurred_at) filter (where u.event = 'app_open')
  from public.hub_usage u
  where u.occurred_at >= v_since and u.app is not null
  group by u.app
  order by count(*) filter (where u.event = 'app_open') desc;
end $$;

revoke all on function public.hub_usage_by_app(integer) from public;
grant execute on function public.hub_usage_by_app(integer) to authenticated;


-- Day by day, for a chart.
create or replace function public.hub_usage_daily(p_days integer default 30)
returns table (day date, machines bigint, app_opens bigint)
language plpgsql security definer set search_path = ''
as $$
declare v_since timestamptz := now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval;
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;
  return query
  select u.occurred_at::date,
         count(distinct u.install_id),
         count(*) filter (where u.event = 'app_open')
  from public.hub_usage u
  where u.occurred_at >= v_since
  group by 1 order by 1;
end $$;

revoke all on function public.hub_usage_daily(integer) from public;
grant execute on function public.hub_usage_daily(integer) to authenticated;
