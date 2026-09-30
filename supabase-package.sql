-- =====================================================================
--  THE STUDIO BUNDLE  ·  who is interested
--
--  Run in Supabase → SQL Editor. Safe to run again.
--
--  The $250 bundle on /store/package (a Fender Studio Pro mixing or
--  live-stream template, AMB Analog, AMB Digital, SecondOut, AFD Gate,
--  and a setup session) is sold by hand, not by a checkout: somebody
--  says they are interested, the studio talks to them, and the sale
--  happens on a call. This is where "interested" lands.
--
--  Writing: one function, callable with the publishable key, that can
--  only insert and trims everything it is given. Reading: the studio
--  alone, through RLS. Nobody can read the list back out through the
--  key on the site.
-- =====================================================================

create table if not exists public.package_requests (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  package     text not null default 'studio-bundle',
  name        text not null,
  email       text not null,
  phone       text,
  church      text,
  role        text,
  want        text,                  -- mixing | stream | both
  daw         text,                  -- Fender Studio Pro | Studio One | other
  computer    text,                  -- windows | mac
  setup       text,                  -- their interface, mixer, stream rig, in their words
  message     text,
  user_id     uuid references public.profiles(id) on delete set null,
  status      text not null default 'new' check (status in ('new','contacted','sold','closed')),
  note        text
);
create index if not exists package_requests_status_idx on public.package_requests (status, created_at desc);

alter table public.package_requests enable row level security;

drop policy if exists package_requests_admin on public.package_requests;
create policy package_requests_admin on public.package_requests
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, update, delete on public.package_requests to authenticated;
grant all on public.package_requests to service_role;

create or replace function public.request_package(p jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p ->> 'email', '')));
  v_id    bigint;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' then
    raise exception 'That email address does not look right.';
  end if;
  if coalesce(trim(p ->> 'name'), '') = '' then
    raise exception 'A name, at least.';
  end if;
  -- the same address twice in a day is one request, not a second
  if exists (select 1 from public.package_requests
              where email = v_email and created_at > now() - interval '1 day') then
    return null;
  end if;
  insert into public.package_requests
    (package, name, email, phone, church, role, want, daw, computer, setup, message, user_id)
  values
    (left(coalesce(nullif(trim(p ->> 'package'), ''), 'studio-bundle'), 40),
     left(trim(p ->> 'name'), 80),
     v_email,
     left(nullif(trim(coalesce(p ->> 'phone', '')), ''), 40),
     left(nullif(trim(coalesce(p ->> 'church', '')), ''), 120),
     left(nullif(trim(coalesce(p ->> 'role', '')), ''), 60),
     case when p ->> 'want' in ('mixing', 'stream', 'both') then p ->> 'want' end,
     left(nullif(trim(coalesce(p ->> 'daw', '')), ''), 40),
     case when p ->> 'computer' in ('windows', 'mac') then p ->> 'computer' end,
     left(nullif(trim(coalesce(p ->> 'setup', '')), ''), 1000),
     left(nullif(trim(coalesce(p ->> 'message', '')), ''), 2000),
     auth.uid())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.request_package(jsonb) from public;
grant execute on function public.request_package(jsonb) to anon, authenticated;

select 'package_requests' as what, count(*) as rows from public.package_requests;
