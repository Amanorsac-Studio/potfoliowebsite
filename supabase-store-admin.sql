-- =====================================================================
--  THE STORE'S BACK ROOM  ·  what the admin page needs to be allowed
--
--  Run in Supabase → SQL Editor after supabase-store.sql. Safe to re-run.
--
--  Row Level Security already says only the studio may write these
--  rows, but a policy is worth nothing without the table-level grant
--  beside it, and the store file granted only what creators and buyers
--  needed. The admin page edits titles, adds artists by hand, gives a
--  song to an account and finishes sections on a song in review, so:
--
--    store_songs       update, delete   (creators: insert only, as before)
--    store_creators    insert, delete   (creators: update their own, as before)
--    store_purchases   insert, update, delete + the id sequence
--    store_sections    a policy for the studio, on a song in any state
--
--  Nothing here widens what a creator or a buyer can do: every write
--  policy on these tables checks is_admin() or ownership, exactly as
--  before. The grants only stop the studio's own page being refused.
-- =====================================================================

grant update, delete on public.store_songs to authenticated;
grant insert, delete on public.store_creators to authenticated;
grant insert, update, delete on public.store_purchases to authenticated;
grant usage, select on sequence public.store_purchases_id_seq to authenticated;

drop policy if exists sections_admin on public.store_sections;
create policy sections_admin on public.store_sections
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists tracks_admin on public.store_tracks;
create policy tracks_admin on public.store_tracks
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

select 'store_songs'     as what, has_table_privilege('authenticated', 'public.store_songs', 'UPDATE')     as ok
union all select 'store_creators',  has_table_privilege('authenticated', 'public.store_creators', 'INSERT')
union all select 'store_purchases', has_table_privilege('authenticated', 'public.store_purchases', 'INSERT');
