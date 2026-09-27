-- =====================================================================
--  ONE WORD, ONE NUMBER  ·  the admin back end after the audit
--
--  Run in Supabase → SQL Editor → New query → Run. Safe to run again.
--  Run it AFTER supabase-product-analytics.sql, supabase-hub-usage.sql,
--  supabase-downloads.sql and supabase-analytics.sql, because it
--  replaces the reports those files used to define. From now on the
--  reports live here and only here.
--
--  WHAT WAS WRONG. The dashboard showed three different "Downloads"
--  for the same month because three stores were each reporting under
--  the same word: the old email gate (download_events), the Worker's
--  ticket counter (app_downloads, site and Hub), and the site tracker's
--  download clicks. "Sales" counted free claims and test entitlements.
--  "Opted in 280%" divided accounts by machines. The funnel put Bought
--  before Downloaded, so a free app could never pass. None of the data
--  was wrong; the definitions were.
--
--  WHAT THIS DOES
--    1  downloads_all       every completed download, one view, with a
--                           source (site | hub), a via, an app and an
--                           identity, so "downloads" and "people" are
--                           both one query
--    2  purchases.kind      paid | free | comp | beta | test, set once,
--                           kept by a trigger, so Sales means paid and
--                           test rows are out of every count
--    3  reports             product_*, hub_usage_* rebuilt on those two
--                           definitions; a funnel that free apps can
--                           pass, an app filter, actives per app
--                           (DAU/WAU/MAU), minutes in app, a mailing
--                           list that pages and searches
--    4  data                the "Mxing" typo, and beta licences that
--                           were never given an end
--
--  DEFINITIONS (the glossary the pages show)
--    Visitors      distinct visitors on the public site in the period
--    Visits        sessions on the public site
--    Downloads     completed downloads of apps, site + Hub, from
--                  downloads_all (the Hub installer itself is counted
--                  apart, as hub_installers)
--    People        distinct identities behind those downloads - an
--                  account or an address; anonymous downloads add to
--                  Downloads and never to People
--    Hub share     downloads via Hub ÷ downloads
--    Sales         entitlements with kind = paid
--    Free claims   kind = free      Comps  kind = comp     Betas  kind = beta
--    Revenue       gross paid amount, dollars; other currencies beside
--    Machines      device activations (keyed apps only)
--    Hubs          installations that have sent a heartbeat
--    Reporting     machines sending usage notes ÷ Hubs known
--
--  Nothing here loosens who may read what: every report checks
--  is_admin() first, the view is granted to nobody, and the one
--  write function still only inserts.
-- =====================================================================


-- =====================================================================
--  0 · CLEAR OUT THE OLD SHAPES
--
--  create-or-replace cannot widen a returns table, and a changed
--  argument list makes a second overload. Drop by name, whatever the
--  arguments; everything is put back below. Tables and rows untouched.
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
        'product_summary', 'product_by_app', 'product_daily', 'product_funnel',
        'product_geography', 'product_hub', 'product_licences', 'product_recent',
        'product_money',
        'hub_usage_summary', 'hub_usage_by_app', 'hub_usage_daily',
        'hub_usage_weekly', 'hub_usage_actives',
        'admin_mailing_list', 'entitlement_kind', 'mark_entitlement', 'analytics_summary')
  loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;


-- =====================================================================
--  1 · EVERY DOWNLOAD, ONE VIEW
--
--  download_events is the old email gate on the website; it stopped
--  being written the day the Hub took over. app_downloads is written
--  by the Worker when it issues a ticket, for a browser and for the
--  Hub alike. The two never describe the same download, so a union is
--  a count, not a double count.
--
--  identity is an address (the gate) or the account's address (a
--  ticket for a signed-in account), lower-cased, so one person is one
--  identity across both eras. A ticket with no account has none, and
--  counts as a download but never as a person.
--
--  The view is granted to nobody. The reports below read it as their
--  owner; the publishable key on the site cannot see it exists.
-- =====================================================================

create or replace view public.downloads_all as
  select 'gate:' || e.id                     as id,
         e.at,
         'site'::text                        as source,
         'email gate'::text                  as via,
         e.app,
         e.platform,
         null::text                          as version,
         lower(e.email)                      as identity,
         null::uuid                          as user_id,
         e.country
  from public.download_events e
  union all
  select 'ticket:' || d.id,
         d.at,
         case when d.source = 'hub' then 'hub' else 'site' end,
         case when d.source = 'hub' then 'hub' else 'app page' end,
         d.app,
         nullif(d.platform, ''),
         nullif(d.version, ''),
         coalesce(lower(u.email::text), d.user_id::text),
         d.user_id,
         nullif(d.country, '')
  from public.app_downloads d
  left join auth.users u on u.id = d.user_id;

revoke all on public.downloads_all from public;
revoke all on public.downloads_all from anon, authenticated;


-- =====================================================================
--  2 · WHAT KIND OF ENTITLEMENT
--
--  One column answers what four scattered signals used to: was this
--  paid for, claimed free, given, a beta, or a test. Set on insert by
--  a trigger, backfilled once here, and never changed by the trigger
--  afterwards - so a row the studio marks by hand stays marked.
--
--    test   a Stripe test-mode session, or a reason with the word
--           test in it ("email:TEST CHORDLIGHT"). Out of every count.
--    paid   money changed hands
--    comp   given: a tester, a code, an address the studio granted
--    beta   free with an end date
--    free   free, forever (the free apps)
-- =====================================================================

alter table public.purchases add column if not exists kind text;

create or replace function public.entitlement_kind(
  p_amount int, p_reason text, p_expires timestamptz, p_session text
) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_session, '') like 'cs_test_%'          then 'test'
    when coalesce(p_reason, '') = 'tester'                 then 'comp'
    when coalesce(p_reason, '') ~* '\mtest(ing)?\M'        then 'test'
    when coalesce(p_amount, 0) > 0                         then 'paid'
    when p_reason like 'code:%' or p_reason like 'email:%' then 'comp'
    when p_reason is not null                              then 'comp'
    when p_expires is not null                             then 'beta'
    else 'free' end;
$$;

create or replace function public.purchases_set_kind()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind is null then
    new.kind := public.entitlement_kind(new.amount_cents, new.granted_reason, new.expires_at, new.stripe_session_id);
  end if;
  return new;
end $$;

drop trigger if exists purchases_kind on public.purchases;
create trigger purchases_kind before insert or update on public.purchases
  for each row execute function public.purchases_set_kind();

update public.purchases
   set kind = public.entitlement_kind(amount_cents, granted_reason, expires_at, stripe_session_id)
 where kind is null;

create index if not exists purchases_kind_idx on public.purchases (kind);

-- The studio's override: "that one was a test", "that one is a comp".
create or replace function public.mark_entitlement(p_id bigint, p_kind text)
returns void language sql security definer set search_path = '' as $$
  update public.purchases set kind = p_kind
   where id = p_id and p_kind in ('paid','free','comp','beta','test') and public.is_admin();
$$;
revoke all on function public.mark_entitlement(bigint, text) from public;
grant execute on function public.mark_entitlement(bigint, text) to authenticated;

-- Usage notes gain a length, for session_end, so "minutes in app" is a
-- number rather than a guess. Older notes have null and count zero.
alter table public.hub_usage add column if not exists seconds integer;


-- =====================================================================
--  3 · THE REPORTS  (admin only; every one checks is_admin first)
-- =====================================================================

/* The headline. Every figure is defined once, above, and its
   comparison window sits beside it so the page can say "new" when the
   period before was too small to compare against. */
create or replace function public.product_summary(p_days int default 30)
returns table (
  revenue_cents bigint, revenue_other jsonb, discount_given_cents bigint,
  sales bigint, free_claims bigint, comps bigint,
  downloads bigint, hub_downloads bigint, site_downloads bigint, people bigint,
  hub_share_pct numeric, hub_installers bigint,
  machines_new bigint, machines_active bigint,
  hubs_new bigint, hubs_active bigint, hubs_signed_in bigint,
  new_accounts bigint, refunds bigint,
  prev_revenue_cents bigint, prev_sales bigint, prev_downloads bigint, prev_people bigint,
  prev_new_accounts bigint, prev_machines_new bigint, prev_hubs_new bigint
)
language sql security definer stable set search_path = '' as $$
  with
  win  as (select now() - make_interval(days => p_days) as a, now() as b),
  prev as (select now() - make_interval(days => p_days * 2) as a,
                  now() - make_interval(days => p_days) as b),
  paid as (select * from public.purchases where kind = 'paid'),
  dl   as (select * from public.downloads_all, win where at >= win.a and app <> 'hub'),
  pdl  as (select * from public.downloads_all, prev where at >= prev.a and at < prev.b and app <> 'hub')
  select
    (select coalesce(sum(amount_cents),0) from paid, win
       where purchased_at >= win.a and coalesce(currency,'usd') = 'usd'),
    (select coalesce(jsonb_object_agg(cur, cents), '{}'::jsonb) from (
       select coalesce(currency,'usd') cur, sum(amount_cents) cents
       from paid, win where purchased_at >= win.a and coalesce(currency,'usd') <> 'usd'
       group by 1) o),
    (select coalesce(sum(discount_cents),0) from paid, win
       where purchased_at >= win.a and coalesce(currency,'usd') = 'usd'),
    (select count(*) from paid, win where purchased_at >= win.a),
    (select count(*) from public.purchases, win where kind = 'free' and purchased_at >= win.a),
    (select count(*) from public.purchases, win where kind = 'comp' and purchased_at >= win.a),
    (select count(*) from dl),
    (select count(*) from dl where source = 'hub'),
    (select count(*) from dl where source = 'site'),
    (select count(distinct identity) from dl where identity is not null),
    (select case when count(*) > 0 then round(100.0 * count(*) filter (where source = 'hub') / count(*), 1) end from dl),
    (select count(*) from public.downloads_all, win where at >= win.a and app = 'hub'),
    (select count(*) from public.device_activations da join public.purchases p on p.id = da.license_id, win
       where da.first_seen >= win.a and p.kind <> 'test'),
    (select count(*) from public.device_activations da join public.purchases p on p.id = da.license_id
       where da.revoked_at is null and da.last_seen > now() - interval '30 days' and p.kind <> 'test'),
    (select count(*) from public.hub_installs, win where first_seen >= win.a),
    (select count(*) from public.hub_installs where last_seen > now() - interval '30 days'),
    (select count(*) from public.hub_installs where user_id is not null),
    (select count(*) from public.profiles, win where created_at >= win.a),
    (select count(*) from public.device_activations, win
       where revoked_at is not null and revoked_at >= win.a),
    (select coalesce(sum(amount_cents),0) from paid, prev
       where purchased_at >= prev.a and purchased_at < prev.b and coalesce(currency,'usd') = 'usd'),
    (select count(*) from paid, prev where purchased_at >= prev.a and purchased_at < prev.b),
    (select count(*) from pdl),
    (select count(distinct identity) from pdl where identity is not null),
    (select count(*) from public.profiles, prev where created_at >= prev.a and created_at < prev.b),
    (select count(*) from public.device_activations da join public.purchases p on p.id = da.license_id, prev
       where da.first_seen >= prev.a and da.first_seen < prev.b and p.kind <> 'test'),
    (select count(*) from public.hub_installs, prev where first_seen >= prev.a and first_seen < prev.b)
  where public.is_admin();
$$;

/* Money, in one place: app sales by rail, the store, and client
   invoices - collected in the period and still owed. Billing and the
   dashboard used to be two money systems with no note between them. */
create or replace function public.product_money(p_days int default 30)
returns table (
  app_revenue_cents bigint, store_revenue_cents bigint,
  by_rail jsonb,
  invoices_paid_cents bigint, invoices_paid bigint,
  invoices_owed_cents bigint, invoices_owed bigint,
  prev_app_revenue_cents bigint, prev_store_revenue_cents bigint, prev_invoices_paid_cents bigint
)
language sql security definer stable set search_path = '' as $$
  with
  win  as (select now() - make_interval(days => p_days) as a),
  prev as (select now() - make_interval(days => p_days * 2) as a,
                  now() - make_interval(days => p_days) as b),
  paid as (select * from public.purchases where kind = 'paid' and coalesce(currency,'usd') = 'usd'),
  store as (select * from public.store_purchases where amount_cents > 0 and coalesce(currency,'usd') = 'usd')
  select
    (select coalesce(sum(amount_cents),0) from paid, win where purchased_at >= win.a),
    (select coalesce(sum(amount_cents),0) from store, win where purchased_at >= win.a),
    (select coalesce(jsonb_object_agg(rail, cents), '{}'::jsonb) from (
       select case when stripe_session_id like 'paystack:%' then 'paystack' else 'stripe' end rail,
              sum(amount_cents) cents
       from paid, win where purchased_at >= win.a group by 1) r),
    (select coalesce(sum(amount_cents),0) from public.invoices, win
       where status = 'paid' and coalesce(paid_at, created_at) >= win.a),
    (select count(*) from public.invoices, win
       where status = 'paid' and coalesce(paid_at, created_at) >= win.a),
    (select coalesce(sum(amount_cents),0) from public.invoices where status not in ('paid','void')),
    (select count(*) from public.invoices where status not in ('paid','void')),
    (select coalesce(sum(amount_cents),0) from paid, prev where purchased_at >= prev.a and purchased_at < prev.b),
    (select coalesce(sum(amount_cents),0) from store, prev where purchased_at >= prev.a and purchased_at < prev.b),
    (select coalesce(sum(amount_cents),0) from public.invoices, prev
       where status = 'paid' and coalesce(paid_at, created_at) >= prev.a and coalesce(paid_at, created_at) < prev.b)
  where public.is_admin();
$$;

/* One row per app. Downloads and people from downloads_all; sales are
   paid only; activations are licence activations (apps that have ever
   activated a machine; the rest show a dash, not a zero); machines, opens, minutes and
   version come from the usage notes, which only reporting machines
   send - the page says so in the column head. */
create or replace function public.product_by_app(p_days int default 30)
returns table (
  app text, sales bigint, revenue_cents bigint, free_claims bigint,
  downloads bigint, people bigint, hub_share_pct numeric,
  keyed boolean, activations bigint, seats bigint,
  machines bigint, opens bigint, minutes bigint, version text, on_version bigint,
  rating numeric, reviews bigint, licences bigint
)
language sql security definer stable set search_path = '' as $$
  with win as (select now() - make_interval(days => p_days) as a),
  apps as (
    select app from public.purchases union
    select app from public.downloads_all where app <> 'hub' union
    select app from public.app_reviews union
    select app from public.hub_usage where app is not null
  ),
  d as (
    select app, count(*) n, count(*) filter (where source = 'hub') hub,
           count(distinct identity) filter (where identity is not null) ppl
    from public.downloads_all, win where at >= win.a and app <> 'hub' group by app
  ),
  p as (
    select app,
           count(*) filter (where kind = 'paid') n,
           coalesce(sum(amount_cents) filter (where kind = 'paid' and coalesce(currency,'usd') = 'usd'),0) cents,
           count(*) filter (where kind = 'free') free
    from public.purchases, win where purchased_at >= win.a group by app
  ),
  allp as (
    select app, count(*) filter (where kind <> 'test') n
    from public.purchases group by app
  ),
  /* An app that has ever activated a machine is one that phones home
     with a key; the rest show a dash rather than a zero that looks
     like an installer problem. */
  act as (
    select pu.app, count(*) filter (where da.first_seen >= win.a) fresh,
           count(*) filter (where da.revoked_at is null) live,
           count(*) ever
    from public.device_activations da
    join public.purchases pu on pu.id = da.license_id and pu.kind <> 'test', win
    group by pu.app
  ),
  use as (
    select app,
           count(distinct install_id) filter (where event = 'app_open') machines,
           count(*) filter (where event = 'app_open') opens,
           coalesce(sum(seconds) filter (where event = 'session_end'), 0) / 60 minutes
    from public.hub_usage, win where occurred_at >= win.a and app is not null group by app
  ),
  latest as (
    select distinct on (app, install_id) app, install_id, app_version
    from public.hub_usage, win
    where occurred_at >= win.a and app is not null and app_version is not null
    order by app, install_id, occurred_at desc
  ),
  ver as (
    select distinct on (app) app, app_version, n from (
      select app, app_version, count(*) n from latest group by 1, 2) v
    order by app, n desc
  ),
  rv as (
    select app, round(avg(rating)::numeric, 2) avg, count(*) n
    from public.app_reviews where status = 'approved' group by app
  )
  select apps.app,
         coalesce(p.n, 0), coalesce(p.cents, 0), coalesce(p.free, 0),
         coalesce(d.n, 0), coalesce(d.ppl, 0),
         case when coalesce(d.n,0) > 0 then round(100.0 * d.hub / d.n, 1) end,
         coalesce(act.ever, 0) > 0,
         case when coalesce(act.ever, 0) > 0 then act.fresh end,
         case when coalesce(act.ever, 0) > 0 then act.live end,
         coalesce(use.machines, 0), coalesce(use.opens, 0), coalesce(use.minutes, 0)::bigint,
         ver.app_version, ver.n,
         rv.avg, coalesce(rv.n, 0), coalesce(allp.n, 0)
  from apps
  left join d    on d.app    = apps.app
  left join p    on p.app    = apps.app
  left join allp on allp.app = apps.app
  left join act  on act.app  = apps.app
  left join use  on use.app  = apps.app
  left join ver  on ver.app  = apps.app
  left join rv   on rv.app   = apps.app
  where public.is_admin()
  order by coalesce(p.cents, 0) desc, coalesce(d.n, 0) desc, apps.app;
$$;

/* A day at a time, every day present. Downloads split by source so
   the move from site to Hub is one chart. */
create or replace function public.product_daily(p_days int default 30)
returns table (
  day date, revenue_cents bigint, sales bigint,
  downloads bigint, downloads_site bigint, downloads_hub bigint, people bigint,
  activations bigint
)
language sql security definer stable set search_path = '' as $$
  with days as (
    select generate_series(
      (now() - make_interval(days => p_days))::date, now()::date, interval '1 day')::date d
  ),
  dl as (
    select at::date d, source, identity from public.downloads_all
    where at >= (now() - make_interval(days => p_days))::date and app <> 'hub'
  )
  select days.d,
    (select coalesce(sum(amount_cents),0) from public.purchases
       where purchased_at::date = days.d and kind = 'paid' and coalesce(currency,'usd') = 'usd'),
    (select count(*) from public.purchases where purchased_at::date = days.d and kind = 'paid'),
    (select count(*) from dl where dl.d = days.d),
    (select count(*) from dl where dl.d = days.d and source = 'site'),
    (select count(*) from dl where dl.d = days.d and source = 'hub'),
    (select count(distinct identity) from dl where dl.d = days.d and identity is not null),
    (select count(*) from public.device_activations da join public.purchases p on p.id = da.license_id
       where da.first_seen::date = days.d and p.kind <> 'test')
  from days where public.is_admin() order by days.d;
$$;

/* The funnel, free-safe.

   A cohort: everybody who made an account in the window, and how far
   each got - ever. Each stage is a subset of the one above by
   construction, so the bottom can never outnumber the top.

     Viewed an app page   sessions, a different unit, drawn apart
     Made an account      the cohort
     Downloaded           a ticket for this account, or the gate with
                          this account's address
     Ran it               an app_open note from this account, or a
                          device activation on one of its licences
     Came back            ran it again on a later day
     Paid                 returned last, unit 'aside': not a stage,
                          a conversion drawn beside the funnel, so a
                          free app is never asked to pass it

   p_app narrows every stage to one app. */
create or replace function public.product_funnel(p_days int default 30, p_app text default null)
returns table (stage text, n bigint, unit text)
language sql security definer stable set search_path = '' as $$
  with win as (select now() - make_interval(days => p_days) as a),
  app as (select nullif(lower(trim(coalesce(p_app,''))), '') as a),
  names as (
    select '(' || string_agg(distinct app, '|') || ')' as re from (
      select app from public.purchases union select app from public.app_downloads
      union select app from public.hub_usage where app is not null) x
    where app <> 'hub'
  ),
  cohort as (
    select p.id, lower(u.email::text) email
    from public.profiles p join auth.users u on u.id = p.id, win
    where p.created_at >= win.a
  ),
  got as (
    select distinct c.id from cohort c
    join public.downloads_all d on (d.user_id = c.id or d.identity = c.email), app
    where d.app <> 'hub' and (app.a is null or d.app = app.a)
  ),
  opens as (
    select u.account_id id, u.app, u.occurred_at at
    from public.hub_usage u join got on got.id = u.account_id, app
    where u.event = 'app_open' and (app.a is null or u.app = app.a)
    union all
    select pu.user_id, pu.app, da.first_seen
    from public.device_activations da join public.purchases pu on pu.id = da.license_id
    join got on got.id = pu.user_id, app
    where pu.kind <> 'test' and (app.a is null or pu.app = app.a)
    union all
    select pu.user_id, pu.app, da.last_seen
    from public.device_activations da join public.purchases pu on pu.id = da.license_id
    join got on got.id = pu.user_id, app
    where pu.kind <> 'test' and da.last_seen::date > da.first_seen::date
      and (app.a is null or pu.app = app.a)
  ),
  ran as (select distinct id from opens),
  again as (
    select id from opens group by id having count(distinct at::date) > 1
  ),
  paid as (
    select distinct pu.user_id from public.purchases pu join cohort c on c.id = pu.user_id, app
    where pu.kind = 'paid' and (app.a is null or pu.app = app.a)
  )
  select 'Viewed an app page'::text,
         (select count(distinct v.session_id) from public.page_views v, win, app, names
            where v.at >= win.a and v.path ~ coalesce('/' || app.a, names.re)),
         'visits'::text
  where public.is_admin()
  union all select 'Made an account', (select count(*) from cohort), 'accounts' where public.is_admin()
  union all select 'Downloaded',      (select count(*) from got),    'accounts' where public.is_admin()
  union all select 'Ran it',          (select count(*) from ran),    'accounts' where public.is_admin()
  union all select 'Came back another day', (select count(*) from again), 'accounts' where public.is_admin()
  union all select 'Paid',            (select count(*) from paid),   'aside'    where public.is_admin();
$$;

/* Where in the world: visits, downloads and people as three columns,
   never one figure "of" another. */
create or replace function public.product_geography(p_days int default 30, p_limit int default 14)
returns table (country text, visits bigint, downloads bigint, people bigint)
language sql security definer stable set search_path = '' as $$
  with win as (select now() - make_interval(days => p_days) as a),
  d as (select coalesce(nullif(country,''),'unknown') c, count(*) n,
               count(distinct identity) filter (where identity is not null) ppl
          from public.downloads_all, win where at >= win.a and app <> 'hub' group by 1),
  v as (select coalesce(nullif(country,''),'unknown') c, count(distinct session_id) n
          from public.page_views, win where at >= win.a group by 1)
  select coalesce(d.c, v.c), coalesce(v.n, 0), coalesce(d.n, 0), coalesce(d.ppl, 0)
  from d full outer join v on v.c = d.c
  where public.is_admin()
  order by coalesce(d.n,0) desc, coalesce(v.n,0) desc
  limit p_limit;
$$;

/* The installed base of the Hub itself, from heartbeats. */
create or replace function public.product_hub()
returns table (
  installs bigint, active_30d bigint, signed_in bigint, accounts bigint,
  current_version text, on_current bigint, versions jsonb, platforms jsonb
)
language sql security definer stable set search_path = '' as $$
  with cur as (
    select version from public.hub_installs
    where version is not null and version <> ''
    group by version order by count(*) desc limit 1
  )
  select
    (select count(*) from public.hub_installs),
    (select count(*) from public.hub_installs where last_seen > now() - interval '30 days'),
    (select count(*) from public.hub_installs where user_id is not null),
    (select count(distinct user_id) from public.hub_installs where user_id is not null),
    (select version from cur),
    (select count(*) from public.hub_installs where version = (select version from cur)),
    (select coalesce(jsonb_object_agg(v, n), '{}'::jsonb) from (
       select coalesce(nullif(version,''),'unknown') v, count(*) n
       from public.hub_installs group by 1 order by 2 desc limit 10) x),
    (select coalesce(jsonb_object_agg(p, n), '{}'::jsonb) from (
       select coalesce(nullif(platform,''),'unknown') p, count(*) n
       from public.hub_installs group by 1) y)
  where public.is_admin();
$$;

/* Licences by kind. Test rows are shown once, here, so the studio
   knows they exist, and nowhere else. */
create or replace function public.product_licences()
returns table (
  licences bigint, paid bigint, free bigint, comp bigint, beta bigint, test bigint,
  seats_used bigint, betas_live bigint, betas_ending_7d bigint, betas_expired bigint
)
language sql security definer stable set search_path = '' as $$
  select
    (select count(*) from public.purchases where kind <> 'test'),
    (select count(*) from public.purchases where kind = 'paid'),
    (select count(*) from public.purchases where kind = 'free'),
    (select count(*) from public.purchases where kind = 'comp'),
    (select count(*) from public.purchases where kind = 'beta'),
    (select count(*) from public.purchases where kind = 'test'),
    (select count(*) from public.device_activations da join public.purchases p on p.id = da.license_id
       where da.revoked_at is null and p.kind <> 'test'),
    (select count(*) from public.purchases where kind <> 'test' and expires_at is not null and expires_at > now()),
    (select count(*) from public.purchases
       where kind <> 'test' and expires_at is not null and expires_at > now()
         and expires_at < now() + interval '7 days'),
    (select count(*) from public.purchases where kind <> 'test' and expires_at is not null and expires_at <= now())
  where public.is_admin();
$$;

/* The latest sales - paid by default, because a feed of $0 claims
   buries the money. p_paid_only false shows every kind but test. */
create or replace function public.product_recent(p_limit int default 15, p_paid_only boolean default true)
returns table (at timestamptz, app text, email text, amount_cents int, currency text, kind text, rail text)
language sql security definer stable set search_path = '' as $$
  select p.purchased_at, p.app, u.email::text, p.amount_cents, p.currency, p.kind,
         case when p.kind = 'paid' and p.stripe_session_id like 'paystack:%' then 'paystack'
              when p.kind = 'paid' then 'stripe'
              else coalesce(p.granted_reason, p.kind) end
  from public.purchases p
  join auth.users u on u.id = p.user_id
  where public.is_admin()
    and p.kind <> 'test'
    and (not p_paid_only or p.kind = 'paid')
  order by p.purchased_at desc
  limit p_limit;
$$;

/* ---- usage notes (opt-in, from the Hub) ------------------------- */

/* record_hub_usage grows two events and one number, same signature.
   session_start / session_end bracket time in an app; seconds rides
   on session_end. hub_install and first_run are the two the funnel
   wanted. Consent is unchanged: nothing is sent until the person says
   yes, and revoke_hub_usage() still erases it all. */
create or replace function public.record_hub_usage(
  p_install_id uuid,
  p_events     jsonb
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_written integer := 0;
  v_uid     uuid := auth.uid();
begin
  if p_install_id is null or p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;
  if jsonb_array_length(p_events) > 200 then
    return 0;
  end if;

  insert into public.hub_usage
    (account_id, install_id, event, app, app_version, hub_version,
     platform, arch, os_release, occurred_at, seconds)
  select
    v_uid,
    p_install_id,
    e ->> 'event',
    nullif(left(e ->> 'app', 60), ''),
    nullif(left(e ->> 'app_version', 40), ''),
    nullif(left(e ->> 'hub_version', 40), ''),
    nullif(left(e ->> 'platform', 20), ''),
    nullif(left(e ->> 'arch', 20), ''),
    nullif(left(e ->> 'os_release', 40), ''),
    coalesce((e ->> 'at')::timestamptz, now()),
    case when (e ->> 'seconds') ~ '^[0-9]{1,6}$' then least((e ->> 'seconds')::int, 86400) end
  from jsonb_array_elements(p_events) as e
  where e ->> 'event' in ('hub_open', 'app_open', 'app_install', 'app_update',
                          'session_start', 'session_end', 'hub_install', 'first_run')
    and coalesce((e ->> 'at')::timestamptz, now())
        between now() - interval '400 days' and now() + interval '2 days'
  on conflict do nothing;

  get diagnostics v_written = row_count;
  return v_written;
exception
  when others then return 0;
end $$;

revoke all on function public.record_hub_usage(uuid, jsonb) from public;
grant execute on function public.record_hub_usage(uuid, jsonb) to anon, authenticated;

/* The shape of usage. reporting_pct is machines sending notes ÷ Hubs
   known from heartbeats - one denominator, one unit. */
create or replace function public.hub_usage_summary(p_days integer default 30)
returns table (
  machines_reporting bigint, machines_known bigint, reporting_pct numeric,
  accounts bigint, hub_opens bigint, app_opens bigint, minutes bigint,
  installs_done bigint, updates_done bigint,
  windows_share numeric, mac_share numeric
)
language plpgsql security definer set search_path = ''
as $$
declare v_since timestamptz := now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval;
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;
  return query
  with rows as (select * from public.hub_usage where occurred_at >= v_since),
       machines as (select distinct install_id, platform from rows),
       known as (select count(*) n from public.hub_installs)
  select
    (select count(distinct install_id) from rows),
    (select n from known),
    (select case when (select n from known) > 0
             then round(100.0 * (select count(distinct install_id) from rows) / (select n from known), 1) end),
    (select count(distinct account_id) from rows where account_id is not null),
    (select count(*) from rows where event = 'hub_open'),
    (select count(*) from rows where event = 'app_open'),
    (select coalesce(sum(seconds), 0) / 60 from rows where event = 'session_end')::bigint,
    (select count(*) from rows where event = 'app_install'),
    (select count(*) from rows where event = 'app_update'),
    (select round(count(*) filter (where platform = 'windows')::numeric / nullif(count(*), 0), 3) from machines),
    (select round(count(*) filter (where platform = 'mac')::numeric / nullif(count(*), 0), 3) from machines);
end $$;

revoke all on function public.hub_usage_summary(integer) from public;
grant execute on function public.hub_usage_summary(integer) to authenticated;

/* Per app: machines, opens, minutes, and which version they are on.
   last_opened is null when never - the page must say "never", not
   render the epoch. */
create or replace function public.hub_usage_by_app(p_days integer default 30)
returns table (
  app text, machines bigint, opens bigint, opens_per_machine numeric,
  minutes bigint, installs bigint, updates bigint, last_opened timestamptz,
  version text, on_version bigint
)
language plpgsql security definer set search_path = ''
as $$
declare v_since timestamptz := now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval;
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;
  return query
  with latest as (
    select distinct on (u.app, u.install_id) u.app, u.install_id, u.app_version
    from public.hub_usage u
    where u.occurred_at >= v_since and u.app is not null and u.app_version is not null
    order by u.app, u.install_id, u.occurred_at desc
  ),
  ver as (
    select distinct on (l.app) l.app, l.app_version, l.n from (
      select latest.app, latest.app_version, count(*) n from latest group by 1, 2) l
    order by l.app, l.n desc
  )
  select
    u.app,
    count(distinct u.install_id) filter (where u.event = 'app_open'),
    count(*) filter (where u.event = 'app_open'),
    round(count(*) filter (where u.event = 'app_open')::numeric
          / nullif(count(distinct u.install_id) filter (where u.event = 'app_open'), 0), 2),
    (coalesce(sum(u.seconds) filter (where u.event = 'session_end'), 0) / 60)::bigint,
    count(*) filter (where u.event = 'app_install'),
    count(*) filter (where u.event = 'app_update'),
    max(u.occurred_at) filter (where u.event = 'app_open'),
    max(ver.app_version), max(ver.n)
  from public.hub_usage u
  left join ver on ver.app = u.app
  where u.occurred_at >= v_since and u.app is not null
  group by u.app
  order by count(*) filter (where u.event = 'app_open') desc;
end $$;

revoke all on function public.hub_usage_by_app(integer) from public;
grant execute on function public.hub_usage_by_app(integer) to authenticated;

create or replace function public.hub_usage_daily(p_days integer default 30)
returns table (day date, machines bigint, app_opens bigint)
language plpgsql security definer set search_path = ''
as $$
declare v_since timestamptz := now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval;
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;
  return query
  select u.occurred_at::date, count(distinct u.install_id), count(*) filter (where u.event = 'app_open')
  from public.hub_usage u where u.occurred_at >= v_since
  group by 1 order by 1;
end $$;

revoke all on function public.hub_usage_daily(integer) from public;
grant execute on function public.hub_usage_daily(integer) to authenticated;

/* Opens per app per week, for one line per app. */
create or replace function public.hub_usage_weekly(p_days integer default 90)
returns table (week date, app text, opens bigint, machines bigint)
language plpgsql security definer set search_path = ''
as $$
declare v_since timestamptz := now() - (greatest(coalesce(p_days, 90), 7) || ' days')::interval;
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;
  return query
  select date_trunc('week', u.occurred_at)::date, u.app,
         count(*) filter (where u.event = 'app_open'), count(distinct u.install_id)
  from public.hub_usage u
  where u.occurred_at >= v_since and u.app is not null and u.event = 'app_open'
  group by 1, 2 order by 1, 2;
end $$;

revoke all on function public.hub_usage_weekly(integer) from public;
grant execute on function public.hub_usage_weekly(integer) to authenticated;

/* Actives per app: machines that opened it in the last day, week,
   month. The three numbers that say whether it is a tool or a
   curiosity. */
create or replace function public.hub_usage_actives()
returns table (app text, dau bigint, wau bigint, mau bigint)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'not permitted'; end if;
  return query
  select u.app,
         count(distinct u.install_id) filter (where u.occurred_at > now() - interval '1 day'),
         count(distinct u.install_id) filter (where u.occurred_at > now() - interval '7 days'),
         count(distinct u.install_id) filter (where u.occurred_at > now() - interval '30 days')
  from public.hub_usage u
  where u.event = 'app_open' and u.app is not null and u.occurred_at > now() - interval '30 days'
  group by u.app order by 4 desc, 3 desc;
end $$;

revoke all on function public.hub_usage_actives() from public;
grant execute on function public.hub_usage_actives() to authenticated;

/* ---- the speed beacon ------------------------------------------- */

/* "2 measured" was the beacon being effectively off: the load time
   was read while the page was still loading, so it was almost always
   zero and dropped. The view is sent early on purpose; the timing now
   arrives with the goodbye. Same function, one more argument - the
   old shape is dropped so the call is never ambiguous. */
drop function if exists public.track_engagement(bigint, integer, integer);
create or replace function public.track_engagement(
  p_id bigint, p_duration_ms integer default null, p_max_scroll integer default null,
  p_load_ms integer default null
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.page_views
     set duration_ms = case when p_duration_ms between 0 and 3600000
                            then p_duration_ms else duration_ms end,
         max_scroll  = case when p_max_scroll between 0 and 100
                            then p_max_scroll else max_scroll end,
         load_ms     = case when p_load_ms between 1 and 120000
                            then p_load_ms else load_ms end
   where id = p_id and at > now() - interval '1 hour';
end;
$$;
grant execute on function public.track_engagement(bigint,integer,integer,integer) to anon, authenticated;

/* ---- what counts as a conversion --------------------------------- */

/* Same shape as in supabase-analytics.sql, one line changed. A session
   used to convert on any named event, so a click on the email address
   or a link out to WhatsApp counted the same as an enquiry sent. Now
   only the events that are worth the word: an enquiry, early access
   asked for, a download taken or asked for, an account made. Every
   traffic report reads sessions through this, so they all agree. */
create or replace function public.analytics_sessions(p_days int default 30, p_offset int default 0)
returns table (
  session_id text, visitor_id text, started timestamptz, views bigint,
  duration_ms bigint, channel text, ref_host text, country text,
  device text, browser text, os text, is_returning boolean,
  entry_path text, exit_path text, engaged boolean, converted boolean
)
language sql security definer stable set search_path = '' as $$
  with w as (
    select * from public.page_views
    where at >  now() - make_interval(days => p_days * (p_offset + 1))
      and at <= now() - make_interval(days => p_days * p_offset)
  ),
  ev as (select distinct e.session_id from public.site_events e
          where e.at >  now() - make_interval(days => p_days * (p_offset + 1))
            and e.at <= now() - make_interval(days => p_days * p_offset)),
  conv as (select distinct e.session_id from public.site_events e
          where e.at >  now() - make_interval(days => p_days * (p_offset + 1))
            and e.at <= now() - make_interval(days => p_days * p_offset)
            and e.name in ('enquiry', 'early_access', 'download', 'download_requested',
                           'hub_download', 'signup', 'account', 'purchase', 'checkout'))
  select
    w.session_id,
    (array_agg(w.visitor_id) filter (where w.visitor_id is not null))[1],
    min(w.at),
    count(*),
    coalesce(sum(w.duration_ms), 0),
    public.analytics_channel(
      (array_agg(w.ref_host   order by w.at))[1],
      (array_agg(w.utm_medium order by w.at))[1],
      (array_agg(w.utm_source order by w.at))[1]),
    (array_agg(w.ref_host order by w.at))[1],
    (array_agg(w.country  order by w.at desc))[1],
    (array_agg(w.device   order by w.at desc))[1],
    (array_agg(w.browser  order by w.at desc))[1],
    (array_agg(w.os       order by w.at desc))[1],
    bool_or(coalesce(w.is_returning,false)),
    (array_agg(w.path order by w.at))[1],
    (array_agg(w.path order by w.at desc))[1],
    count(*) > 1 or coalesce(sum(w.duration_ms),0) >= 10000 or w.session_id in (select ev.session_id from ev),
    w.session_id in (select conv.session_id from conv)
  from w group by w.session_id;
$$;

/* analytics_summary, one column wider: the visitors of the period
   before, so the Visitors card compares visitors with visitors rather
   than borrowing the visits comparison. */
create or replace function public.analytics_summary(p_days int default 30)
returns table (
  views bigint, visits bigint, visitors bigint, new_visitors bigint,
  bounce_pct numeric, avg_session_s numeric, avg_page_s numeric,
  pages_per_visit numeric, conversions bigint, conversion_pct numeric,
  prev_views bigint, prev_visits bigint, prev_bounce_pct numeric,
  prev_avg_session_s numeric, prev_conversion_pct numeric, prev_visitors bigint
)
language sql security definer stable set search_path = '' as $$
  with
  cur  as (select * from public.analytics_sessions(p_days, 0)),
  prev as (select * from public.analytics_sessions(p_days, 1)),
  pv   as (select * from public.page_views where at > now() - make_interval(days => p_days))
  select
    (select count(*) from pv),
    (select count(*) from cur),
    (select count(distinct coalesce(cur.visitor_id, cur.session_id)) from cur),
    (select count(*) from cur where not cur.is_returning),
    (select round(100.0 * count(*) filter (where not cur.engaged) / nullif(count(*),0), 1) from cur),
    (select round(avg(cur.duration_ms)/1000.0, 1) from cur where cur.duration_ms > 0),
    (select round(avg(pv.duration_ms)/1000.0, 1) from pv  where pv.duration_ms > 0),
    (select round(avg(cur.views), 1) from cur),
    (select count(*) filter (where cur.converted) from cur),
    (select round(100.0 * count(*) filter (where cur.converted) / nullif(count(*),0), 1) from cur),
    (select count(*) from public.page_views
       where at <= now() - make_interval(days => p_days)
         and at >  now() - make_interval(days => p_days * 2)),
    (select count(*) from prev),
    (select round(100.0 * count(*) filter (where not prev.engaged) / nullif(count(*),0), 1) from prev),
    (select round(avg(prev.duration_ms)/1000.0, 1) from prev where prev.duration_ms > 0),
    (select round(100.0 * count(*) filter (where prev.converted) / nullif(count(*),0), 1) from prev),
    (select count(distinct coalesce(prev.visitor_id, prev.session_id)) from prev)
  where public.is_admin();
$$;
revoke all on function public.analytics_summary(int) from public;
grant execute on function public.analytics_summary(int) to authenticated;

/* ---- the mailing list, paged ------------------------------------ */

/* The list is a list of people (one row per address already), so this
   pages and searches rather than rendering nine hundred rows. total is
   the count behind the filter, so the page can say "of 914".
   looks_wrong flags an address that cannot be delivered to: gmail.coom,
   gmacil.com and their cousins. */
-- The list was made before confirming an address was part of the
-- arrangement, and the confirm step was never run on this database -
-- which is also why "Confirmed" has always read zero. The columns the
-- list needs are added here so the report never depends on which
-- version of supabase-downloads.sql was run.
alter table public.subscribers add column if not exists confirmed_at    timestamptz;
alter table public.subscribers add column if not exists unsubscribed_at timestamptz;
alter table public.subscribers add column if not exists consented       boolean not null default false;
alter table public.subscribers add column if not exists consented_at    timestamptz;
alter table public.subscribers add column if not exists source          text;
alter table public.subscribers add column if not exists app             text;
alter table public.subscribers add column if not exists last_seen_at    timestamptz not null default now();

create or replace function public.admin_mailing_list(
  p_q text default null, p_limit int default 50, p_offset int default 0, p_confirmed_only boolean default false
)
returns table (
  email text, app text, source text, consented boolean, consented_at timestamptz,
  confirmed_at timestamptz, unsubscribed_at timestamptz, created_at timestamptz,
  looks_wrong boolean, total bigint
)
language sql security definer stable set search_path = '' as $$
  with q as (select nullif(lower(trim(coalesce(p_q,''))), '') as q),
  rows as (
    select s.* from public.subscribers s, q
    where (q.q is null or lower(s.email) like '%' || q.q || '%' or lower(coalesce(s.app,'')) like '%' || q.q || '%')
      and (not p_confirmed_only or (s.consented and s.confirmed_at is not null and s.unsubscribed_at is null))
  )
  select r.email, r.app, r.source, r.consented, r.consented_at, r.confirmed_at, r.unsubscribed_at, r.created_at,
         r.email ~* '@(gmail|gmial|gmal|gamil|gmaill|gmacil)\.(coom|con|cm|comm|co)$|@[^.]+\.(coom|con|comm)$|gmacil|gmial|gamil',
         (select count(*) from rows)
  from rows r
  where public.is_admin()
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 5000)) offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_mailing_list(text, int, int, boolean) from public;
grant execute on function public.admin_mailing_list(text, int, int, boolean) to authenticated;

/* ---- grants for the rebuilt reports ------------------------------ */
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('product_summary','product_money','product_by_app','product_daily',
                        'product_funnel','product_geography','product_hub','product_licences',
                        'product_recent','entitlement_kind')
  loop
    execute 'revoke all on function ' || f.sig || ' from public';
    execute 'grant execute on function ' || f.sig || ' to authenticated';
  end loop;
end $$;


-- =====================================================================
--  4 · DATA
-- =====================================================================

-- The typo that was on five of six invoices.
update public.invoices set label   = replace(label,   'Mxing', 'Mixing') where label   like '%Mxing%';
update public.projects set service = replace(service, 'Mxing', 'Mixing') where service like '%Mxing%';

-- Betas that were never given an end. A PerformLive beta is thirty days
-- from the day it was claimed; a row with no end date got one from a
-- path that forgot to set it. Everyone keeps at least a week from
-- today, so nobody is cut off by this file.
update public.purchases
   set expires_at = greatest(purchased_at + interval '30 days', now() + interval '7 days'),
       kind = 'beta'
 where app = 'performlive' and amount_cents = 0 and granted_reason is null and expires_at is null;


-- =====================================================================
--  5 · WHAT IS THERE NOW
-- =====================================================================
select 'downloads_all, last 30 days' as what, count(*)::text as n
  from public.downloads_all where at > now() - interval '30 days' and app <> 'hub'
union all
select 'people behind them', count(distinct identity)::text
  from public.downloads_all where at > now() - interval '30 days' and app <> 'hub' and identity is not null
union all
select 'entitlements: ' || kind, count(*)::text from public.purchases group by kind
union all
select 'betas with an end', count(*)::text from public.purchases where kind = 'beta' and expires_at is not null;
