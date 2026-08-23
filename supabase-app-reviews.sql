-- =====================================================================
--  APP REVIEWS AND PUBLIC DOWNLOAD COUNTS
--  Run in Supabase → SQL Editor → New query → Run. Safe to re-run.
--
--  Two public-facing numbers and one public-facing list:
--    how many people have downloaded an app,
--    what people who tried it think of it,
--    and the words they left, once the studio has actually read them.
--
--  Nobody's address is anywhere in this file. A review does not ask for
--  one - the moderation queue is the anti-spam control, not a login.
-- =====================================================================


-- =====================================================================
--  0 · CLEAR OUT ANY EARLIER VERSION OF THE FUNCTIONS
--
--  create-or-replace can change what a function does but not the shape
--  of what it returns, so an older version with different columns has
--  to be dropped rather than replaced, and a changed argument list
--  creates a second overload instead of replacing the first. Drop every
--  overload by name first and let the rest of this file put the
--  current ones back. The tables are never touched here.
-- =====================================================================

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'submit_app_review', 'app_reviews_public', 'app_review_stats',
        'app_download_counts', 'app_reviews_pending', 'moderate_app_review')
  loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;


-- =====================================================================
--  1 · THE TABLE
-- =====================================================================

create table if not exists public.app_reviews (
  id           bigserial primary key,
  app          text not null,                 -- 'pulseroom' | 'nebulatide'
  rating       smallint not null check (rating between 1 and 5),
  name         text,                          -- whatever they typed; never an address
  body         text not null,
  status       text not null default 'pending'
               check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now(),
  moderated_at timestamptz
);
create index if not exists app_reviews_app_status_idx
  on public.app_reviews (app, status, created_at desc);

alter table public.app_reviews enable row level security;

-- The table itself is admin-only, same as subscribers. The public never
-- reads or writes it directly - only through the functions below, which
-- see exactly as much as they are built to show.
drop policy if exists app_reviews_admin on public.app_reviews;
create policy app_reviews_admin on public.app_reviews
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.app_reviews to authenticated;
grant usage, select on sequence public.app_reviews_id_seq to authenticated;


-- =====================================================================
--  2 · LEAVING ONE
--
--  Write-only, the same shape as record_subscriber: a visitor can add a
--  review and can never read the table back, so nothing they submit can
--  be harvested through this door. It goes in marked pending. Nothing
--  is public until a person at the studio has read it.
-- =====================================================================

create or replace function public.submit_app_review(
  p_app    text,
  p_rating int,
  p_name   text default null,
  p_body   text default ''
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_app text;
begin
  v_app := lower(trim(coalesce(p_app, '')));
  if v_app not in ('pulseroom', 'nebulatide') then return; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then return; end if;
  if length(trim(coalesce(p_body,''))) = 0 then return; end if;

  insert into public.app_reviews (app, rating, name, body)
  values (
    v_app,
    p_rating,
    nullif(left(trim(coalesce(p_name,'')), 60), ''),
    left(trim(p_body), 2000)
  );
end;
$$;

revoke all on function public.submit_app_review(text,int,text,text) from public;
grant execute on function public.submit_app_review(text,int,text,text) to anon, authenticated;


-- =====================================================================
--  3 · WHAT A VISITOR SEES
--
--  Approved rows only, and only the columns a reviewer already made
--  public by writing them - no email was ever collected, so there is
--  none to leak here.
-- =====================================================================

create or replace function public.app_reviews_public(p_app text, p_limit int default 50)
returns table (id bigint, rating smallint, name text, body text, created_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select id, rating, name, body, created_at
  from public.app_reviews
  where app = lower(trim(coalesce(p_app,''))) and status = 'approved'
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit,50), 200));
$$;

grant execute on function public.app_reviews_public(text,int) to anon, authenticated;

create or replace function public.app_review_stats(p_app text)
returns table (count bigint, average numeric)
language sql security definer stable set search_path = '' as $$
  select count(*), round(avg(rating)::numeric, 1)
  from public.app_reviews
  where app = lower(trim(coalesce(p_app,''))) and status = 'approved';
$$;

grant execute on function public.app_review_stats(text) to anon, authenticated;


-- =====================================================================
--  4 · HOW MANY PEOPLE HAVE IT
--
--  A count, nothing else - no address, no date finer than "ever",
--  which is what makes it safe to show to anyone who asks.
-- =====================================================================

create or replace function public.app_download_counts()
returns table (app text, downloads bigint)
language sql security definer stable set search_path = '' as $$
  select app, count(*) from public.download_events
  where app is not null
  group by app;
$$;

grant execute on function public.app_download_counts() to anon, authenticated;


-- =====================================================================
--  5 · WHAT THE STUDIO SEES
--
--  Every pending review, in full, and the one door that moves a review
--  from pending to public or gone. Admin-only, same as everything else
--  that reads the table directly.
-- =====================================================================

create or replace function public.app_reviews_pending()
returns table (id bigint, app text, rating smallint, name text, body text, created_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select id, app, rating, name, body, created_at
  from public.app_reviews
  where status = 'pending' and public.is_admin()
  order by created_at asc;
$$;

grant execute on function public.app_reviews_pending() to authenticated;

create or replace function public.moderate_app_review(p_id bigint, p_approve boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return; end if;
  update public.app_reviews
     set status = case when p_approve then 'approved' else 'rejected' end,
         moderated_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.moderate_app_review(bigint,boolean) from public;
grant execute on function public.moderate_app_review(bigint,boolean) to authenticated;
