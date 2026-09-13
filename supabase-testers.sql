-- =====================================================================
--  TESTER ACCOUNTS: EVERY APP, WITHOUT A PAYMENT
--
--  Gives the two tester accounts a licence for every app in the catalog,
--  exactly as if they had bought each one - a real key, a real device
--  limit, visible in My Apps, downloadable through the Hub.
--
--  Two things it is careful about.
--
--  These rows are marked. A tester is not a sale, and six months from
--  now nobody will remember which rows were comps. granted_reason says
--  so, so a revenue figure or a customer email list can exclude them
--  with a where clause instead of a guess.
--
--  A tester's licence does not expire, PerformLive included. The beta
--  clock is for the public beta; somebody testing the thing should not
--  be locked out of it halfway through.
--
--  Run the whole file in the Supabase SQL editor. Safe to run twice:
--  an account that already owns an app keeps the key it has.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1 · The two columns this needs
--
--  granted_reason is new here. expires_at belongs to
--  supabase-beta-licenses.sql, and is added again because "run this
--  file after that one" is not a property a script should have. Both
--  are if-not-exists, so whichever order they are run in, they work.
-- ---------------------------------------------------------------------

alter table public.purchases add column if not exists granted_reason text;
alter table public.purchases add column if not exists expires_at timestamptz;

comment on column public.purchases.granted_reason is
  'Why this licence exists when no money changed hands: tester, press, refund replacement. Null for a real purchase.';


-- ---------------------------------------------------------------------
--  2 · The grant
-- ---------------------------------------------------------------------

do $$
declare
  v_testers text[] := array[
    'studioamanorsac@gmail.com',
    'aofierti@gmail.com'
  ];
  -- Every app in catalog.json. Adding one means adding it here too, or
  -- the testers quietly do not get it.
  v_apps text[] := array[
    'performlive', 'chordlight88', 'secondout', 'stemsorter', 'ambanalog',
    'alignpro', 'afdgate', 'aether', 'pulseroom', 'nebulatide2',
    'nebulatide', 'harmoniemd'
  ];
  v_email text;
  v_app   text;
  v_uid   uuid;
  v_added int;
  v_total int := 0;
  v_missing int := 0;
begin
  foreach v_email in array v_testers loop
    select id into v_uid from auth.users where lower(email) = lower(v_email);

    if v_uid is null then
      v_missing := v_missing + 1;
      raise notice 'NO ACCOUNT: % has not signed up yet. Create the account first, then run this again.', v_email;
      continue;
    end if;

    -- profiles is what purchases points at, and a row should already be
    -- there from sign-up. Make sure, so the insert below cannot fail on
    -- a foreign key for a reason nobody would guess from the error.
    insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

    v_added := 0;
    foreach v_app in array v_apps loop
      /* Checked rather than ON CONFLICT, because ON CONFLICT (user_id, app)
         needs that unique constraint to exist - and on this database it may
         not yet, which is the whole subject of supabase-dedupe-purchases.sql.
         A tester grant should not fail over somebody else's missing index. */
      if not exists (select 1 from public.purchases
                      where user_id = v_uid and app = v_app) then
        insert into public.purchases (user_id, app, amount_cents, license_key,
                                      update_eligible_until, expires_at, granted_reason)
        values (v_uid, v_app, 0, public.generate_license_key(v_app),
                'infinity', null, 'tester');
        v_added := v_added + 1;
      end if;
    end loop;

    v_total := v_total + v_added;
    raise notice '% : % new licence(s), % app(s) in total', v_email, v_added, array_length(v_apps, 1);
  end loop;

  raise notice '--- % licence(s) created across % tester account(s)', v_total,
    array_length(v_testers, 1) - v_missing;
end $$;


-- ---------------------------------------------------------------------
--  3 · What the testers now hold
-- ---------------------------------------------------------------------

select u.email,
       count(*)                                              as apps,
       count(*) filter (where p.granted_reason = 'tester')    as as_tester,
       count(*) filter (where p.granted_reason is null)       as really_bought
from public.purchases p
join auth.users u on u.id = p.user_id
where lower(u.email) in ('studioamanorsac@gmail.com', 'aofierti@gmail.com')
group by u.email
order by u.email;


-- ---------------------------------------------------------------------
--  4 · Taking it back, when they are done
--
--  Deliberately commented out. Removing a licence removes the devices
--  activated against it, and that is not something to run by accident.
--
--    delete from public.purchases
--     where granted_reason = 'tester'
--       and user_id in (select id from auth.users
--                        where lower(email) in ('studioamanorsac@gmail.com',
--                                               'aofierti@gmail.com'));
--
--  To keep the accounts but stop a specific app, delete just that row.
-- ---------------------------------------------------------------------
