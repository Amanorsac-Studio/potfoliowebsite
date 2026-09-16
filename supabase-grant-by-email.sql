-- =====================================================================
--  GIVE SOMEBODY AN APP, BY EMAIL
--  Run in Supabase → SQL Editor → New query → Run. Safe to run again.
--
--  The short way in. A code is a thing you make, send, and hope is typed
--  correctly by somebody who is signed in to the right account. This
--  skips all of it: you type their email, they get the app. Nothing to
--  redeem, nothing to mistype, nothing to explain.
--
--  What it needs from them: an account on the site, made with that
--  exact email. That is the one thing this cannot do for them - a
--  licence has to belong to somebody, and until they sign up there is
--  nobody to give it to. The function says so plainly rather than
--  failing, so you can tell them to sign up and then press the button
--  again.
--
--  When to prefer a code instead: when you do not know who they are -
--  a forum post, a room of people at a workshop, a reply-to-this-post
--  giveaway. Codes are for strangers; this is for people whose email
--  you already have in front of you.
--
--  Everything lands in the same purchases table as a real sale, so My
--  Apps, the Hub, the download door and the licence key all behave
--  exactly as if they had bought it. granted_reason records that they
--  did not, so the books stay honest.
-- =====================================================================

alter table public.purchases alter column stripe_session_id drop not null;
alter table public.purchases add column if not exists expires_at     timestamptz;
alter table public.purchases add column if not exists granted_reason text;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('grant_app_to_email', 'ungrant_app_from_email', 'granted_list')
  loop execute 'drop function if exists ' || f.sig; end loop;
end $$;


-- ---------------------------------------------------------------------
--  GIVING
--
--  p_days null means theirs to keep. Any number makes it a loan that
--  ends, which is what a tester usually should have.
-- ---------------------------------------------------------------------
create or replace function public.grant_app_to_email(
  p_email text,
  p_app   text,
  p_days  integer default null,
  p_note  text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_app     text := lower(trim(coalesce(p_app, '')));
  v_uid     uuid;
  v_expires timestamptz;
  v_key     text;
begin
  if not public.is_admin() then
    raise exception 'Only the studio can give apps away';
  end if;
  if v_email = '' or v_email not like '%@%' then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;
  if v_app = '' then
    return jsonb_build_object('ok', false, 'error', 'no_app');
  end if;

  -- Emails are compared lowercased because people type them however
  -- they like and Gmail does not care, so neither should this.
  select u.id into v_uid from auth.users u where lower(u.email) = v_email limit 1;
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_account', 'email', v_email);
  end if;

  if exists (select 1 from public.purchases p where p.user_id = v_uid and p.app = v_app) then
    return jsonb_build_object('ok', false, 'error', 'already_owned',
                              'email', v_email, 'app', v_app);
  end if;

  v_expires := case when p_days is not null and p_days > 0
                    then now() + make_interval(days => p_days) else null end;
  v_key := public.generate_license_key(v_app);

  insert into public.purchases (user_id, app, amount_cents, license_key,
                                update_eligible_until, expires_at, granted_reason)
  values (v_uid, v_app, 0, v_key, 'infinity', v_expires,
          'email:' || coalesce(nullif(trim(coalesce(p_note, '')), ''), 'given by the studio'));

  return jsonb_build_object('ok', true, 'email', v_email, 'app', v_app,
                            'license_key', v_key, 'expires_at', v_expires);
end $$;

revoke all on function public.grant_app_to_email(text, text, integer, text) from public;
revoke all on function public.grant_app_to_email(text, text, integer, text) from anon;
grant execute on function public.grant_app_to_email(text, text, integer, text) to authenticated;


-- ---------------------------------------------------------------------
--  TAKING IT BACK
--
--  Only ever a licence that was GIVEN. A purchase somebody paid for is
--  not reachable from here at any price - the whole point of the
--  granted_reason filter below is that a slip of the finger on this
--  function cannot delete a sale.
-- ---------------------------------------------------------------------
create or replace function public.ungrant_app_from_email(p_email text, p_app text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_app   text := lower(trim(coalesce(p_app, '')));
  v_n     integer;
begin
  if not public.is_admin() then
    raise exception 'Only the studio can take an app back';
  end if;

  delete from public.purchases p
   using auth.users u
   where p.user_id = u.id
     and lower(u.email) = v_email
     and p.app = v_app
     and p.granted_reason is not null       -- never a real sale
     and p.amount_cents = 0;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', v_n > 0, 'removed', v_n,
    'error', case when v_n = 0 then 'nothing_given' else null end);
end $$;

revoke all on function public.ungrant_app_from_email(text, text) from public;
revoke all on function public.ungrant_app_from_email(text, text) from anon;
grant execute on function public.ungrant_app_from_email(text, text) to authenticated;


-- ---------------------------------------------------------------------
--  WHO HAS BEEN GIVEN WHAT
-- ---------------------------------------------------------------------
create or replace function public.granted_list(p_limit integer default 200)
returns table (email text, app text, license_key text, reason text,
               expires_at timestamptz, given_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;
  return query
  select u.email, p.app, p.license_key, p.granted_reason, p.expires_at, p.created_at
  from public.purchases p
  join auth.users u on u.id = p.user_id
  where p.granted_reason is not null
  order by p.created_at desc
  limit greatest(coalesce(p_limit, 200), 1);
end $$;

revoke all on function public.granted_list(integer) from public;
revoke all on function public.granted_list(integer) from anon;
grant execute on function public.granted_list(integer) to authenticated;
