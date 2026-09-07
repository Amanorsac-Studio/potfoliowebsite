-- =====================================================================
--  ACCOUNT KINDS: APP USER vs CLIENT
--  Run in Supabase → SQL Editor → New query → Run. Safe to re-run.
--
--  One login for everyone. What an account SEES is decided by two
--  flags on its profile:
--
--    is_admin   the studio (already existed)
--    is_client  someone the studio is mixing for - sees Projects,
--               Billing, mix reviews. Only the studio can grant it.
--
--  Everyone else is an app user: they signed up to download or buy an
--  app, and they see My Apps and their account, nothing more. A client
--  created by the studio (create-client, or "Make a client" on the
--  admin dashboard) gets is_client automatically; a self-signup never
--  does, and cannot give it to themselves - see the guard below.
-- =====================================================================

alter table public.profiles add column if not exists is_client boolean not null default false;

-- Anyone the studio itself created - the invite flow stamps
-- must_change_password into their metadata - or who already has a
-- project, is a client. Self-signups stay app users.
update public.profiles p
   set is_client = true
  from auth.users u
 where u.id = p.id
   and not p.is_client
   and ( p.is_admin
      or (u.raw_user_meta_data ? 'must_change_password')
      or exists (select 1 from public.projects pr where pr.client_id = p.id) );

-- New accounts: created by the studio -> client; signed up -> app user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, is_client)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          coalesce((new.raw_user_meta_data ? 'must_change_password'), false))
  on conflict (id) do nothing;
  return new;
end; $$;

-- The "update own profile" policy lets someone edit their own row, and
-- a row has these two flags on it. This is what stops an app user
-- promoting themselves: a signed-in non-admin changing either flag is
-- refused. The studio (is_admin), the service key and the SQL editor
-- (no auth.uid()) are unaffected.
create or replace function public.guard_profile_flags()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.is_client is distinct from old.is_client or new.is_admin is distinct from old.is_admin)
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only the studio can change what an account has access to.';
  end if;
  return new;
end; $$;

drop trigger if exists profiles_guard_flags on public.profiles;
create trigger profiles_guard_flags
  before update on public.profiles
  for each row execute function public.guard_profile_flags();


-- =====================================================================
--  DONE — TELL THE API ABOUT THE NEW COLUMN
--
--  Supabase's REST layer (PostgREST) caches the table schema and does
--  not always notice a column added a moment ago in the SQL editor - a
--  page loaded right after running this can get "Could not find the
--  'is_client' column of 'profiles' in the schema cache" on every read
--  and write, admin included, until the cache catches up on its own.
--  This line tells it to refresh right now instead of waiting.
-- =====================================================================
notify pgrst, 'reload schema';
