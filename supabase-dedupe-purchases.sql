-- =====================================================================
--  ONE LICENCE ROW PER ACCOUNT PER APP
--
--  supabase-licenses.sql adds a unique constraint on (user_id, app), so
--  a second row for the same app should be impossible. My Apps showed
--  PulseRoom seven times over, which means the constraint is not on this
--  database - almost certainly because duplicates already existed when
--  it was first run, and adding a unique constraint over duplicate rows
--  fails with unique_violation, which that script's exception handler
--  does not catch. It stopped there, and the duplicates kept arriving.
--
--  This clears them and then puts the constraint on, so it cannot happen
--  again. Run the whole file in the Supabase SQL editor. It is safe to
--  run twice.
--
--  What it will NOT do: delete anything that looks like a real second
--  payment. A duplicate carrying its own stripe_session_id is money that
--  changed hands, and this file reports those and leaves them alone
--  rather than quietly destroying a receipt.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1 · What is actually there
-- ---------------------------------------------------------------------
select 'before' as when, app, user_id, count(*) as rows,
       count(stripe_session_id) as paid_rows
from public.purchases
group by app, user_id
having count(*) > 1
order by rows desc, app;


do $$
declare
  g            record;
  v_keeper     bigint;
  v_paid       int;
  v_moved      int := 0;
  v_deleted    int := 0;
  v_left_alone int := 0;
begin
  for g in
    select user_id, app
    from public.purchases
    group by user_id, app
    having count(*) > 1
  loop
    -- Two paid rows for one app is two payments. Not this file's call.
    select count(stripe_session_id) into v_paid
      from public.purchases where user_id = g.user_id and app = g.app;
    if v_paid > 1 then
      v_left_alone := v_left_alone + 1;
      raise notice 'LEFT ALONE: % / % has % paid rows - look at these by hand',
        g.user_id, g.app, v_paid;
      continue;
    end if;

    -- The keeper is the row somebody actually paid for if there is one,
    -- otherwise the oldest - that is the licence the key was minted on
    -- and the one whose key is already typed into somebody's plug-in.
    select id into v_keeper
      from public.purchases
     where user_id = g.user_id and app = g.app
     order by (stripe_session_id is not null) desc, purchased_at asc, id asc
     limit 1;

    -- Move activated machines onto the keeper, unless that machine is
    -- already on it - (license_id, device_id) is unique, and a collision
    -- here just means the same computer activated twice.
    update public.device_activations d
       set license_id = v_keeper
     where d.license_id in (select id from public.purchases
                             where user_id = g.user_id and app = g.app and id <> v_keeper)
       and not exists (select 1 from public.device_activations k
                        where k.license_id = v_keeper and k.device_id = d.device_id);
    get diagnostics v_moved = row_count;

    delete from public.purchases
     where user_id = g.user_id and app = g.app and id <> v_keeper;
    get diagnostics v_deleted = row_count;

    raise notice 'tidied % / %: kept row %, moved % device(s), removed % row(s)',
      g.user_id, g.app, v_keeper, v_moved, v_deleted;
  end loop;

  if v_left_alone > 0 then
    raise notice '% group(s) left alone because they carry more than one payment', v_left_alone;
  end if;
end $$;


-- ---------------------------------------------------------------------
--  2 · Stop it happening again
--
--  Named, because an unnamed one would be added a second time on the
--  next run. duplicate_table is what a repeat raises: a constraint's
--  index shares a namespace with tables.
-- ---------------------------------------------------------------------
do $$ begin
  alter table public.purchases add constraint purchases_user_app_unique unique (user_id, app);
  raise notice 'constraint added - one row per account per app from now on';
exception
  when duplicate_table then
    raise notice 'constraint was already there';
  when unique_violation then
    raise notice 'STILL DUPLICATED: the rows above with more than one payment have to be sorted out first';
end $$;


-- ---------------------------------------------------------------------
--  3 · What is there now. An empty result is the answer you want.
-- ---------------------------------------------------------------------
select 'after' as when, app, user_id, count(*) as rows
from public.purchases
group by app, user_id
having count(*) > 1
order by rows desc, app;
