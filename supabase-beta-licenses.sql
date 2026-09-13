-- =====================================================================
--  TIME-LIMITED LICENCES, FOR A BETA
--
--  PerformLive goes out free for thirty days. That is a fourth shape the
--  licence table did not have: free, licensed, and with an end date.
--
--    free + no key          PulseRoom, Nebula Tide
--    paid + no key          AFD Gate, Chordlight 88
--    paid + key, forever    SecondOut, AETHER, AMB Analog, Align Pro
--    free + key, 30 days    PerformLive          <- this file
--
--  Two things had to be added. A purchase can now carry an expires_at,
--  and activate_device refuses once that time has passed - because the
--  expiry has to be enforced where the private key is, not in the app.
--  An app that asks nicely and is told no is the only design that holds:
--  anything checked client-side is a clock the user can change.
--
--  Run the whole file in the Supabase SQL editor. Safe to run twice.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1 · A licence can have an end
--
--  Null means forever, which is every licence that exists today - so
--  adding the column changes nothing for any of them.
-- ---------------------------------------------------------------------

alter table public.purchases add column if not exists expires_at timestamptz;

comment on column public.purchases.expires_at is
  'When this licence stops activating. Null means never. Set for beta licences.';

create index if not exists purchases_expires_idx
  on public.purchases (expires_at) where expires_at is not null;


-- ---------------------------------------------------------------------
--  2 · activate_device refuses an expired licence
--
--  Same function as before with one check added at the top, so an
--  expired key cannot take a seat, cannot heartbeat, and above all
--  cannot be handed a signed proof - the Worker only signs after this
--  returns ok.
-- ---------------------------------------------------------------------

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
  select id, app, max_devices, expires_at into v_lic
    from public.purchases where license_key = trim(coalesce(p_license_key,''));
  if v_lic.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_license');
  end if;

  -- A beta that has run out. Said plainly, with the date, so the app can
  -- tell the person what happened rather than "something went wrong".
  if v_lic.expires_at is not null and v_lic.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'license_expired',
      'app', v_lic.app, 'expires_at', v_lic.expires_at);
  end if;

  update public.device_activations
     set last_seen = now(),
         device_name = coalesce(p_device_name, device_name)
   where license_id = v_lic.id and device_id = trim(coalesce(p_device_id,'')) and revoked_at is null
   returning true into v_heartbeat;
  if v_heartbeat then
    return jsonb_build_object('ok', true, 'app', v_lic.app, 'expires_at', v_lic.expires_at);
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
  values (v_lic.id, trim(coalesce(p_device_id,'')), p_device_name)
  on conflict (license_id, device_id) do update
     set revoked_at  = null,
         first_seen  = now(),
         last_seen   = now(),
         device_name = coalesce(excluded.device_name, public.device_activations.device_name);

  return jsonb_build_object('ok', true, 'app', v_lic.app, 'expires_at', v_lic.expires_at);
end;
$$;


-- ---------------------------------------------------------------------
--  3 · Claiming a beta key
--
--  Called for the signed-in account, by the Worker, at the moment the
--  download is handed over. The thirty days start then, not when the
--  beta opened, so somebody who finds it late still gets thirty days.
--
--  It never extends an existing licence. Claiming twice returns the key
--  already held, with the end date it already had - otherwise the beta
--  would be a subscription anybody could renew by clicking download.
-- ---------------------------------------------------------------------

create or replace function public.claim_beta_license(p_app text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_app  text := lower(trim(coalesce(p_app,'')));
  v_days int;
  v_row  record;
begin
  -- The betas, and how long each runs. Adding one is a line here.
  v_days := case v_app when 'performlive' then 30 else null end;
  if v_days is null then
    raise exception 'claim_beta_license: % is not an open beta', v_app;
  end if;

  if auth.uid() is null then
    raise exception 'claim_beta_license: not signed in';
  end if;

  select id, license_key, expires_at into v_row
    from public.purchases where user_id = auth.uid() and app = v_app;

  if v_row.id is not null then
    return jsonb_build_object('ok', true, 'license_key', v_row.license_key,
      'expires_at', v_row.expires_at, 'new', false);
  end if;

  insert into public.purchases (user_id, app, amount_cents, license_key,
                                update_eligible_until, expires_at)
  values (auth.uid(), v_app, 0, public.generate_license_key(v_app),
          now() + (v_days || ' days')::interval,
          now() + (v_days || ' days')::interval)
  on conflict (user_id, app) do update set license_key = public.purchases.license_key
  returning id, license_key, expires_at into v_row;

  return jsonb_build_object('ok', true, 'license_key', v_row.license_key,
    'expires_at', v_row.expires_at, 'new', true);
end;
$$;

revoke all on function public.claim_beta_license(text) from public;
grant execute on function public.claim_beta_license(text) to authenticated, service_role;


-- ---------------------------------------------------------------------
--  4 · What is out there
-- ---------------------------------------------------------------------

select app,
       count(*)                                              as licences,
       count(*) filter (where expires_at is null)            as never_expire,
       count(*) filter (where expires_at > now())            as live_betas,
       count(*) filter (where expires_at <= now())           as expired,
       min(expires_at)                                       as first_to_end
from public.purchases
group by app
order by app;
