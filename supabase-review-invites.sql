-- =====================================================================
--  REVIEW INVITES
--  Run in Supabase → SQL Editor → New query → Run. Safe to re-run.
--
--  A review only proves anything if it comes from someone who actually
--  used the app. The Worker checks that by emailing a signed link about
--  a week after a confirmed download - long enough to have an opinion,
--  short enough to still remember it - and only that link's signature
--  ever unlocks the review form. This file is the half of that living
--  in the database: who has already downloaded for long enough to be
--  asked, and who has already been asked so nobody gets emailed twice.
--
--  Nothing here is reachable with the publishable key every page on
--  this site already carries. Both functions return real addresses, so
--  both are service_role only - the Worker's own secret key, set once
--  as a Cloudflare secret and never shipped to a browser. Same shape as
--  DOWNLOAD_SECRET: a key that only ever exists on the server.
-- =====================================================================


-- =====================================================================
--  0 · CLEAR OUT ANY EARLIER VERSION OF THE FUNCTIONS
-- =====================================================================

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('review_invite_candidates', 'mark_review_invite_sent')
  loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;


-- =====================================================================
--  1 · WHO HAS ALREADY BEEN ASKED
--
--  One row per person per app, ever - not per download. Someone who
--  grabbed both the Windows and Mac build, or updated later, is still
--  only asked once.
-- =====================================================================

create table if not exists public.review_invites (
  id       bigserial primary key,
  email    text not null,
  app      text not null,
  sent_at  timestamptz not null default now(),
  unique (email, app)
);

alter table public.review_invites enable row level security;

drop policy if exists review_invites_admin on public.review_invites;
create policy review_invites_admin on public.review_invites
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.review_invites to authenticated;
grant usage, select on sequence public.review_invites_id_seq to authenticated;


-- =====================================================================
--  2 · WHO IS DUE ONE TODAY
--
--  A confirmed download at least a week old, for the app asked about,
--  with nobody at that address already asked for that app. Grouped by
--  email so a person who downloaded the same app twice in one week
--  still gets one row back, not two.
-- =====================================================================

create or replace function public.review_invite_candidates(p_app text)
returns table (email text)
language sql security definer stable set search_path = '' as $$
  select distinct d.email
  from public.download_events d
  where d.app = lower(trim(coalesce(p_app,'')))
    and d.email is not null
    and d.at <= now() - interval '7 days'
    and not exists (
      select 1 from public.review_invites r
      where r.email = d.email and r.app = d.app
    );
$$;

revoke all on function public.review_invite_candidates(text) from public, anon, authenticated;
grant execute on function public.review_invite_candidates(text) to service_role;


-- =====================================================================
--  3 · MARKING ONE SENT
--
--  Called once the Worker has the email provider's word that it went
--  out - not before - so a delivery failure gets retried tomorrow
--  instead of being silently recorded as done.
-- =====================================================================

create or replace function public.mark_review_invite_sent(p_email text, p_app text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.review_invites (email, app)
  values (lower(trim(coalesce(p_email,''))), lower(trim(coalesce(p_app,''))))
  on conflict (email, app) do nothing;
end;
$$;

revoke all on function public.mark_review_invite_sent(text,text) from public, anon, authenticated;
grant execute on function public.mark_review_invite_sent(text,text) to service_role;
