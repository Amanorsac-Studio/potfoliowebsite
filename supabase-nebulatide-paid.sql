-- =====================================================================
--  NEBULA TIDE 1 IS SOLD, NOT GIVEN  ·  11 October 2026
--
--  Nebula Tide (version 1) was free from the day it shipped. From today
--  it is $5 for twenty-four hours and $9 after that. Two functions used
--  to wave it through for everybody, and one of them would hand anyone
--  a free licence row on request; both learn here that only Pulse Room
--  is free now. The canonical definitions in supabase-purchases.sql and
--  supabase-licenses.sql say the same thing, so running those again is
--  harmless.
--
--  EVERYONE WHO ALREADY HAD IT KEEPS IT. Anyone who downloaded version 1
--  while it was free - through the Hub (app_downloads carries the
--  account), through the site's emailed link (download_events carries
--  the address), or who was invited to review it - gets a $0 purchase
--  row marked as such, so My Apps and the Hub treat them exactly as
--  before. Nobody is asked to pay for something they already had.
--
--  Run the whole thing in the Supabase SQL editor. Safe to run twice.
-- =====================================================================

-- added by other files too; repeated so this one runs on its own
alter table public.purchases add column if not exists granted_reason text;
alter table public.purchases add column if not exists expires_at timestamptz;
alter table public.purchases alter column stripe_session_id drop not null;

create or replace function public.has_app_access(p_app text)
returns boolean
language sql security definer stable set search_path = '' as $$
  select case
    when lower(trim(coalesce(p_app,''))) in ('pulseroom') then true
    else exists (
      select 1 from public.purchases
      where user_id = auth.uid()
        and app = lower(trim(coalesce(p_app,'')))
    )
  end;
$$;

create or replace function public.claim_license(p_app text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_app text := lower(trim(coalesce(p_app,'')));
  v_key text;
begin
  if v_app not in ('pulseroom') then
    raise exception 'claim_license is for free apps only';
  end if;

  select license_key into v_key from public.purchases
    where user_id = auth.uid() and app = v_app;
  if v_key is not null then return v_key; end if;

  v_key := public.generate_license_key(v_app);
  insert into public.purchases (user_id, app, amount_cents, license_key, update_eligible_until)
  values (auth.uid(), v_app, 0, v_key, 'infinity')
  on conflict (user_id, app) do update set license_key = public.purchases.license_key
  returning license_key into v_key;
  return v_key;
end $$;

-- The people who had it free keep it. Each source table is looked for
-- first, so this runs whether or not the analytics files have been.
do $$
declare v_from text := 'select p.id from public.profiles p where false';
begin
  if to_regclass('public.app_downloads') is not null then
    v_from := v_from || ' union select d.user_id from public.app_downloads d where d.app = $q$nebulatide$q$ and d.user_id is not null';
  end if;
  if to_regclass('public.download_events') is not null then
    v_from := v_from || ' union select p.id from public.download_events e join public.profiles p on lower(p.email) = lower(e.email) where e.app = $q$nebulatide$q$';
  end if;
  if to_regclass('public.review_invites') is not null then
    v_from := v_from || ' union select p.id from public.review_invites r join public.profiles p on lower(p.email) = lower(r.email) where r.app = $q$nebulatide$q$';
  end if;
  execute 'insert into public.purchases (user_id, app, amount_cents, currency, update_eligible_until, granted_reason) '
       || 'select distinct u.id, $q$nebulatide$q$, 0, $q$usd$q$, $q$infinity$q$::timestamptz, $q$free before 2026-10-11$q$ '
       || 'from (' || v_from || ') u where u.id is not null '
       || 'and not exists (select 1 from public.purchases x where x.user_id = u.id and x.app = $q$nebulatide$q$)';
end $$;

select count(*) as kept_free from public.purchases where app = 'nebulatide' and granted_reason = 'free before 2026-10-11';

notify pgrst, 'reload schema';
