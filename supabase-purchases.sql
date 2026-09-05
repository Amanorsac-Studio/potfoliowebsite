-- =====================================================================
--  APP PURCHASES
--  Run in Supabase → SQL Editor → New query → Run. Safe to re-run.
--
--  One row per completed sale. Written only by the Stripe webhook,
--  using the service_role key, once Stripe has actually confirmed the
--  payment - never by the buyer's own browser, which could otherwise
--  just insert its own "paid" row for free. A signed-in visitor can
--  read their own rows and nothing else; the studio (is_admin) can
--  read all of them, same pattern as every other table here.
-- =====================================================================

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('has_app_access')
  loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;


-- =====================================================================
--  1 · THE TABLE
-- =====================================================================

create table if not exists public.purchases (
  id                     bigserial primary key,
  user_id                uuid not null references public.profiles(id) on delete cascade,
  app                    text not null,
  amount_cents           int not null,
  currency               text not null default 'usd',
  stripe_session_id      text not null unique,
  purchased_at           timestamptz not null default now(),
  update_eligible_until  timestamptz not null
);
create index if not exists purchases_user_app_idx on public.purchases (user_id, app);

alter table public.purchases enable row level security;

-- A visitor sees their own purchases and nothing else's existence -
-- not even that someone else bought the same app.
drop policy if exists purchases_own on public.purchases;
create policy purchases_own on public.purchases
  for select to authenticated
  using (user_id = auth.uid());

-- The studio sees every sale, same admin pattern as reviews/invites.
drop policy if exists purchases_admin on public.purchases;
create policy purchases_admin on public.purchases
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- No insert/update/delete grant to authenticated at all: a purchase
-- is only ever written by the webhook, which uses service_role and
-- bypasses RLS entirely regardless of what's granted here. The grants
-- below just say that in writing rather than leave it implicit.
grant select on public.purchases to authenticated;
grant insert, update, delete, select on public.purchases to service_role;
grant usage, select on sequence public.purchases_id_seq to service_role;


-- =====================================================================
--  2 · DOES THIS ACCOUNT HAVE THE APP
--
--  Free apps: always yes, no purchase needed - being signed in is the
--  whole gate. Everything else: yes only if a purchase row exists for
--  this exact account. Callable by any signed-in browser; it can only
--  ever answer for the caller's own account (auth.uid()), so there is
--  nothing here for one visitor to learn about another.
-- =====================================================================

create or replace function public.has_app_access(p_app text)
returns boolean
language sql security definer stable set search_path = '' as $$
  select case
    when lower(trim(coalesce(p_app,''))) in ('pulseroom', 'nebulatide') then true
    else exists (
      select 1 from public.purchases
      where user_id = auth.uid()
        and app = lower(trim(coalesce(p_app,'')))
    )
  end;
$$;

grant execute on function public.has_app_access(text) to authenticated;
