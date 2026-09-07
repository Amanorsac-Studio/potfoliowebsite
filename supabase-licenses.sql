-- =====================================================================
--  LICENSE KEYS AND DEVICE ACTIVATION
--  Run in Supabase → SQL Editor → New query → Run. Safe to re-run.
--
--  One system for every app, free or paid: the moment an account has
--  access to an app, it gets a real license key, capped at a fixed
--  number of devices. A paid app's key is minted by the Stripe webhook
--  the instant payment clears; a free app's key is minted the first
--  time a signed-in visitor asks the portal for it - claim_license()
--  below. Nothing about a device's identity or a key's shape is ever
--  invented client-side: the key comes from the database, and only the
--  Worker (holding the service key) or the account's own owner can
--  ever read or move it.
-- =====================================================================

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      -- mint_license_key is deliberately not here: a trigger depends on
      -- it, and its signature (no args, returns trigger) can never change,
      -- so create or replace is enough and dropping it would fail.
      and p.proname in (
        'generate_license_key', 'claim_license', 'revoke_device',
        'activate_device', 'deactivate_device', 'check_license')
  loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;


-- =====================================================================
--  1 · purchases GROWS INTO THE LICENSE RECORD
--
--  A purchase already is the grant of access; giving that same row a
--  key and a device cap, rather than standing up a second table that
--  could drift out of sync with it, is what "one purchase, one
--  license" actually means. stripe_session_id drops its NOT NULL - a
--  free app's row was never a Stripe session - and (user_id, app) is
--  now unique, so nobody, free or paid, ever ends up with two license
--  rows for the same app.
-- =====================================================================

alter table public.purchases alter column stripe_session_id drop not null;
alter table public.purchases add column if not exists license_key text unique;
alter table public.purchases add column if not exists max_devices int not null default 2;

-- A named unique constraint quietly creates an index of the same name,
-- and index names share a namespace with tables - so re-adding this
-- conflicts as "relation already exists" (duplicate_table), not the
-- duplicate_object error a constraint conflict would suggest.
do $$ begin
  alter table public.purchases add constraint purchases_user_app_unique unique (user_id, app);
exception when duplicate_table then null; end $$;


-- =====================================================================
--  2 · WHO HAS USED THE KEY WHERE
-- =====================================================================

create table if not exists public.device_activations (
  id           bigserial primary key,
  license_id   bigint not null references public.purchases(id) on delete cascade,
  device_id    text not null,
  device_name  text,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (license_id, device_id)
);
create index if not exists device_activations_license_idx on public.device_activations (license_id);

alter table public.device_activations enable row level security;

-- Seen only by the license's own owner, through the same join every
-- time - never by device_id or license_id alone, which would let one
-- visitor go fishing for somebody else's rows by guessing an id.
drop policy if exists device_activations_own on public.device_activations;
create policy device_activations_own on public.device_activations
  for select to authenticated
  using (exists (
    select 1 from public.purchases
    where purchases.id = device_activations.license_id
      and purchases.user_id = auth.uid()
  ));

drop policy if exists device_activations_admin on public.device_activations;
create policy device_activations_admin on public.device_activations
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- No direct write grant to authenticated: activating a device is a
-- decision the Worker mediates (see activate_device below), and
-- freeing one is revoke_device, not a raw update.
grant select on public.device_activations to authenticated;
grant insert, update, delete, select on public.device_activations to service_role;
grant usage, select on sequence public.device_activations_id_seq to service_role;


-- =====================================================================
--  3 · A KEY THAT LOOKS LIKE ONE
--
--  gen_random_uuid() rather than pgcrypto's gen_random_bytes(): it has
--  been a plain built-in since Postgres 13, in pg_catalog, which is
--  always searched no matter what search_path is set to - so this
--  never depends on which schema an extension happened to install
--  into on a given project.
-- =====================================================================

create or replace function public.generate_license_key(p_app text)
returns text language sql volatile set search_path = '' as $$
  select upper(left(regexp_replace(coalesce(p_app,'APP'), '[^a-zA-Z]', '', 'g') || 'XXXX', 4)) || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
$$;


-- =====================================================================
--  3b · EVERY PURCHASE ROW GETS A KEY, WHOEVER WROTE IT
--
--  The Stripe webhook inserts a paid purchase knowing nothing about
--  keys, and it should not have to: the moment any row lands in
--  purchases without one, this mints it. That covers the webhook, a
--  row added by hand in the dashboard, and claim_license below (which
--  still supplies its own, harmlessly). The backfill afterwards gives
--  a key to any row that slipped in before this existed.
-- =====================================================================

create or replace function public.mint_license_key()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.license_key is null then
    new.license_key := public.generate_license_key(new.app);
  end if;
  return new;
end;
$$;

drop trigger if exists purchases_mint_key on public.purchases;
create trigger purchases_mint_key
  before insert on public.purchases
  for each row execute function public.mint_license_key();

update public.purchases
   set license_key = public.generate_license_key(app)
 where license_key is null;


-- =====================================================================
--  4 · A FREE APP GETS ITS KEY THE FIRST TIME ANYONE ASKS
--
--  Idempotent on purpose: the portal calls this every time it loads
--  the page, and a second call for an app already claimed just hands
--  back the same key rather than erroring or minting a new one.
-- =====================================================================

create or replace function public.claim_license(p_app text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_app text := lower(trim(coalesce(p_app,'')));
  v_key text;
begin
  if v_app not in ('pulseroom', 'nebulatide') then
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
end;
$$;

grant execute on function public.claim_license(text) to authenticated;


-- =====================================================================
--  5 · FREEING A SLOT
-- =====================================================================

create or replace function public.revoke_device(p_device_activation_id bigint)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.device_activations d
     set revoked_at = now()
   where d.id = p_device_activation_id
     and revoked_at is null
     and exists (
       select 1 from public.purchases p
       where p.id = d.license_id
         and (p.user_id = auth.uid() or public.is_admin())
     );
end;
$$;

grant execute on function public.revoke_device(bigint) to authenticated;


-- =====================================================================
--  6 · WHAT THE APP ITSELF CALLS
--
--  The app never talks to Supabase directly - these are reached only
--  through the Worker's /licenses/* routes, using the service key, the
--  same arrangement reviews and downloads already use. A license key is
--  the only credential here, so these two functions are the entire
--  security boundary: anyone who can call them at all already has to
--  have a real key.
--
--  The `error` values below are machine-readable codes, not prose - the
--  compiled app (LicenseClient.h) switches on them by exact string
--  ("no_such_license", "device_limit_reached") to choose its own
--  user-facing message. The Worker passes these straight through as the
--  `error` field of a non-2xx JSON response; it does not invent its own
--  codes or reword these.
-- =====================================================================

create or replace function public.activate_device(
  p_license_key text, p_device_id text, p_device_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lic record;
  v_heartbeat boolean;
  v_used int;
  v_devices jsonb;
begin
  select id, app, max_devices into v_lic
    from public.purchases where license_key = trim(coalesce(p_license_key,''));
  if v_lic.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_license');
  end if;

  -- Already activated on this device: just a heartbeat, not a new seat.
  update public.device_activations
     set last_seen = now(),
         device_name = coalesce(p_device_name, device_name)
   where license_id = v_lic.id and device_id = trim(coalesce(p_device_id,'')) and revoked_at is null
   returning true into v_heartbeat;
  if v_heartbeat then
    return jsonb_build_object('ok', true, 'app', v_lic.app);
  end if;

  select count(*) into v_used from public.device_activations
    where license_id = v_lic.id and revoked_at is null;

  if v_used >= v_lic.max_devices then
    select jsonb_agg(jsonb_build_object('device_name', coalesce(device_name, device_id), 'last_seen', last_seen))
      into v_devices
      from public.device_activations where license_id = v_lic.id and revoked_at is null;
    return jsonb_build_object('ok', false, 'error', 'device_limit_reached',
      'max_devices', v_lic.max_devices, 'devices', coalesce(v_devices, '[]'::jsonb));
  end if;

  insert into public.device_activations (license_id, device_id, device_name)
  values (v_lic.id, trim(coalesce(p_device_id,'')), p_device_name);

  return jsonb_build_object('ok', true, 'app', v_lic.app);
end;
$$;

revoke all on function public.activate_device(text,text,text) from public, anon, authenticated;
grant execute on function public.activate_device(text,text,text) to service_role;


-- =====================================================================
--  7 · FREEING THIS DEVICE'S OWN SEAT, FROM INSIDE THE APP
--
--  Backs the app's own "deactivate this device" button (LicenseClient::
--  deactivateThisDevice), as opposed to revoke_device above, which is
--  the portal owner removing some other device from their account. Always
--  reports ok - the app clears its local proof either way once a real
--  license key was presented, so there's no useful distinction between
--  "already not active here" and "just deactivated" for the caller.
-- =====================================================================

create or replace function public.deactivate_device(p_license_key text, p_device_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lic record;
begin
  select id, app into v_lic
    from public.purchases where license_key = trim(coalesce(p_license_key,''));
  if v_lic.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_license');
  end if;

  update public.device_activations
     set revoked_at = now()
   where license_id = v_lic.id
     and device_id = trim(coalesce(p_device_id,''))
     and revoked_at is null;

  return jsonb_build_object('ok', true, 'app', v_lic.app);
end;
$$;

revoke all on function public.deactivate_device(text,text) from public, anon, authenticated;
grant execute on function public.deactivate_device(text,text) to service_role;


-- =====================================================================
--  DONE — TELL THE API ABOUT THE NEW COLUMNS
--
--  Supabase's REST layer (PostgREST) caches the table schema and can be
--  slow to notice a column added moments ago in the SQL editor - a page
--  loaded right after running this can get a "column not found" error
--  on license_key or max_devices until the cache catches up on its own.
--  This line tells it to refresh right now instead of waiting.
-- =====================================================================
notify pgrst, 'reload schema';
