-- =====================================================================
--  PRODUCT ANALYTICS
--
--  supabase-analytics.sql answers "who came to the website". This file
--  answers the questions a software business actually runs on: what
--  sold, what was downloaded, what got installed, on how many machines,
--  in which countries, and which apps are carrying the others.
--
--  WHAT WAS MISSING. Nothing counted an app download. app_download_counts
--  reads download_events, which is only ever written by the old
--  email-gated flow on the website - so every download made through
--  Amanorsac Hub, and every ticketed download from an app page, was
--  invisible. The badge on the store has been quietly under-reporting
--  since the Hub shipped. app_downloads below is the fix, written by the
--  Worker at the moment a download ticket is issued, which is the one
--  place every download of every kind passes through.
--
--  WHAT THE HUB KNOWS. Today, nothing leaves it. hub_installs is where
--  a heartbeat lands once the Hub is built to send one - one row per
--  installation, not per person: an id the Hub makes for itself, the
--  version, the platform, when it was first and last seen. That is
--  enough to answer "how many Hubs are out there, on what, and are they
--  on the current build" without following anybody around.
--
--  WHAT IS DELIBERATELY NOT HERE. No IP addresses, no machine
--  fingerprints, no record of which app somebody opened and when, no
--  paths through the interface. Country comes from Cloudflare's own
--  two-letter code and is stored as two letters. The privacy policy
--  says the studio collects what it needs to run the shop, and this
--  file is held to that.
--
--  Run the whole thing in the Supabase SQL editor. Safe to run twice.
-- =====================================================================


-- =====================================================================
--  0 · TWO COLUMNS ON PURCHASES
--
--  Which code paid for a discount, and how much it took off. The
--  webhooks write both when a code was used - the checkout knows the
--  price before and after, and the webhook is the only place that knows
--  the money actually arrived, so the figure travels between them in the
--  payment's own metadata rather than being worked out again from a
--  catalog that may have moved on by then.
-- =====================================================================

alter table public.purchases add column if not exists code           text;
alter table public.purchases add column if not exists discount_cents integer;

create index if not exists purchases_code_idx on public.purchases (code) where code is not null;


-- =====================================================================
--  1 · WHAT WAS DOWNLOADED
-- =====================================================================

create table if not exists public.app_downloads (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  app         text not null,
  platform    text,
  version     text,
  -- 'hub' when Amanorsac Hub asked, 'site' when a browser did. Told
  -- apart by the user agent, which the Hub sets to its own name.
  source      text not null default 'site',
  hub_version text,
  country     text,
  user_id     uuid references public.profiles(id) on delete set null
);

create index if not exists app_downloads_at_idx     on public.app_downloads (at desc);
create index if not exists app_downloads_app_idx    on public.app_downloads (app);
create index if not exists app_downloads_user_idx   on public.app_downloads (user_id);

alter table public.app_downloads enable row level security;

-- RLS on, no policy for anyone. Denies everything. The Worker writes
-- through the function below with the service key; the studio reads
-- through the reports in part 4, which return counts and never rows.
drop policy if exists app_downloads_admin on public.app_downloads;
create policy app_downloads_admin on public.app_downloads
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));


-- =====================================================================
--  2 · WHICH HUBS ARE OUT THERE
--
--  One row per installation. install_id is a random id the Hub makes
--  for itself on first run and keeps - it identifies a copy of the
--  software, not a person, and two people sharing a computer are one
--  row. Signing in attaches the account, which is what makes "how many
--  of my customers are on the old build" answerable.
-- =====================================================================

create table if not exists public.hub_installs (
  install_id  text primary key,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  version     text,
  platform    text,
  os          text,
  arch        text,
  country     text,
  user_id     uuid references public.profiles(id) on delete set null,
  launches    integer not null default 1
);

create index if not exists hub_installs_seen_idx    on public.hub_installs (last_seen desc);
create index if not exists hub_installs_version_idx on public.hub_installs (version);

alter table public.hub_installs enable row level security;

drop policy if exists hub_installs_admin on public.hub_installs;
create policy hub_installs_admin on public.hub_installs
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));


-- =====================================================================
--  3 · WRITING (the only doors in)
--
--  Both are called by the Worker with the service key and are granted
--  to nobody else. A download count anyone could POST to is a download
--  count that means nothing.
-- =====================================================================

create or replace function public.record_app_download(
  p_app         text,
  p_platform    text default null,
  p_version     text default null,
  p_source      text default 'site',
  p_hub_version text default null,
  p_country     text default null,
  p_user_id     uuid default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.app_downloads (app, platform, version, source, hub_version, country, user_id)
  values (lower(left(p_app, 40)),
          lower(left(coalesce(p_platform, ''), 20)),
          left(coalesce(p_version, ''), 20),
          case when p_source = 'hub' then 'hub' else 'site' end,
          left(coalesce(p_hub_version, ''), 20),
          upper(left(coalesce(p_country, ''), 2)),
          p_user_id);
$$;

/* A new function is granted to PUBLIC by default, which would let the
   publishable key on the open website invent downloads. Revoked from
   everyone, then handed back to service_role alone - the key the Worker
   holds, and the only caller that has any business counting a
   download. Note that revoking from public takes it away from
   service_role too, which is why the grant has to be explicit and why
   it must come after the revoke. */
revoke all on function public.record_app_download(text,text,text,text,text,text,uuid) from public;
revoke all on function public.record_app_download(text,text,text,text,text,text,uuid) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_app_download(text,text,text,text,text,text,uuid) to service_role;
  end if;
end $$;

/* The Hub saying hello. Idempotent by install_id: the first call makes
   the row, every one after it moves last_seen and the version along.
   launches counts calls, not days - the Hub is expected to send this
   once when it starts, not on a timer. */
create or replace function public.record_hub_install(
  p_install_id text,
  p_version    text default null,
  p_platform   text default null,
  p_os         text default null,
  p_arch       text default null,
  p_country    text default null,
  p_user_id    uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_install_id is null or length(p_install_id) < 8 then return; end if;

  insert into public.hub_installs (install_id, version, platform, os, arch, country, user_id)
  values (left(p_install_id, 64), left(coalesce(p_version,''), 20), left(coalesce(p_platform,''), 20),
          left(coalesce(p_os,''), 40), left(coalesce(p_arch,''), 20),
          upper(left(coalesce(p_country,''), 2)), p_user_id)
  on conflict (install_id) do update set
    last_seen = now(),
    version   = coalesce(nullif(excluded.version, ''), public.hub_installs.version),
    platform  = coalesce(nullif(excluded.platform, ''), public.hub_installs.platform),
    os        = coalesce(nullif(excluded.os, ''), public.hub_installs.os),
    arch      = coalesce(nullif(excluded.arch, ''), public.hub_installs.arch),
    country   = coalesce(nullif(excluded.country, ''), public.hub_installs.country),
    -- an account only ever gets attached, never cleared by a signed-out launch
    user_id   = coalesce(excluded.user_id, public.hub_installs.user_id),
    launches  = public.hub_installs.launches + 1;
end $$;

revoke all on function public.record_hub_install(text,text,text,text,text,text,uuid) from public;
revoke all on function public.record_hub_install(text,text,text,text,text,text,uuid) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_hub_install(text,text,text,text,text,text,uuid) to service_role;
  end if;
end $$;


-- =====================================================================
--  4 · REPORTS  (admin only - every one checks is_admin first)
--
--  Same discipline as supabase-analytics.sql: security definer so they
--  can read tables the caller cannot, and a where public.is_admin() in
--  every one so that privilege is worth nothing to anybody else.
-- =====================================================================

/* The headline row, with the same window immediately before it for
   comparison - a number with no direction is decoration. */
/* CURRENCY. revenue_cents is DOLLARS ONLY, and revenue_other carries
   every other currency beside it. Summing amount_cents across the whole
   table was right while Stripe was the only way to pay and became wrong
   the day Paystack arrived: a GHS 190 sale is stored as 19000 pesewas,
   and adding that to a dollar total reports it as $190. There is no
   honest single number without a rate that is only ever approximate, so
   the dashboard shows the currencies side by side and nothing is
   silently converted. */
drop function if exists public.product_summary(int);
create or replace function public.product_summary(p_days int default 30)
returns table (
  revenue_cents bigint, revenue_other jsonb, discount_given_cents bigint,
  sales bigint, downloads bigint, hub_downloads bigint,
  installs bigint, active_devices bigint, new_accounts bigint, refunds bigint,
  prev_revenue_cents bigint, prev_sales bigint, prev_downloads bigint, prev_new_accounts bigint
)
language sql security definer stable set search_path = '' as $$
  with
  win  as (select now() - make_interval(days => p_days) as a, now() as b),
  prev as (select now() - make_interval(days => p_days * 2) as a,
                  now() - make_interval(days => p_days) as b)
  select
    (select coalesce(sum(amount_cents),0) from public.purchases, win
       where purchased_at >= win.a and amount_cents > 0
         and coalesce(currency,'usd') = 'usd'),
    (select coalesce(jsonb_object_agg(cur, cents), '{}'::jsonb) from (
       select coalesce(currency,'usd') cur, sum(amount_cents) cents
       from public.purchases, win
       where purchased_at >= win.a and amount_cents > 0
         and coalesce(currency,'usd') <> 'usd'
       group by 1) o),
    (select coalesce(sum(discount_cents),0) from public.purchases, win
       where purchased_at >= win.a and coalesce(currency,'usd') = 'usd'),
    (select count(*) from public.purchases, win
       where purchased_at >= win.a and amount_cents > 0),
    (select count(*) from public.app_downloads, win where at >= win.a),
    (select count(*) from public.app_downloads, win where at >= win.a and source = 'hub'),
    (select count(*) from public.device_activations, win where first_seen >= win.a),
    (select count(*) from public.device_activations
       where revoked_at is null and last_seen > now() - interval '30 days'),
    (select count(*) from public.profiles, win where created_at >= win.a),
    (select count(*) from public.device_activations, win
       where revoked_at is not null and revoked_at >= win.a),
    (select coalesce(sum(amount_cents),0) from public.purchases, prev
       where purchased_at >= prev.a and purchased_at < prev.b and amount_cents > 0
         and coalesce(currency,'usd') = 'usd'),
    (select count(*) from public.purchases, prev
       where purchased_at >= prev.a and purchased_at < prev.b and amount_cents > 0),
    (select count(*) from public.app_downloads, prev
       where at >= prev.a and at < prev.b),
    (select count(*) from public.profiles, prev
       where created_at >= prev.a and created_at < prev.b)
  where public.is_admin();
$$;

/* One row per app: everything about it side by side. This is the table
   that says which app to build next and which one to stop selling. */
create or replace function public.product_by_app(p_days int default 30)
returns table (
  app text, sales bigint, revenue_cents bigint, downloads bigint,
  hub_share_pct numeric, installs bigint, devices bigint,
  rating numeric, reviews bigint, licences bigint
)
language sql security definer stable set search_path = '' as $$
  with win as (select now() - make_interval(days => p_days) as a),
  apps as (
    select app from public.purchases union
    select app from public.app_downloads union
    select app from public.app_reviews
  ),
  d as (
    select app, count(*) n, count(*) filter (where source = 'hub') hub
    from public.app_downloads, win where at >= win.a group by app
  ),
  p as (
    select app, count(*) filter (where amount_cents > 0) n,
           -- dollars only, for the same reason product_summary splits them
           coalesce(sum(amount_cents) filter (
             where amount_cents > 0 and coalesce(currency,'usd') = 'usd'),0) cents,
           count(*) total
    from public.purchases, win where purchased_at >= win.a group by app
  ),
  allp as (select app, count(*) n from public.purchases group by app),
  act as (
    select pu.app, count(*) filter (where da.first_seen >= win.a) fresh,
           count(*) filter (where da.revoked_at is null) live
    from public.device_activations da
    join public.purchases pu on pu.id = da.license_id, win
    group by pu.app
  ),
  rv as (
    select app, round(avg(rating)::numeric, 2) avg, count(*) n
    from public.app_reviews where status = 'approved' group by app
  )
  select apps.app,
         coalesce(p.n, 0), coalesce(p.cents, 0), coalesce(d.n, 0),
         case when coalesce(d.n,0) > 0 then round(100.0 * d.hub / d.n, 1) else null end,
         coalesce(act.fresh, 0), coalesce(act.live, 0),
         rv.avg, coalesce(rv.n, 0), coalesce(allp.n, 0)
  from apps
  left join d    on d.app    = apps.app
  left join p    on p.app    = apps.app
  left join allp on allp.app = apps.app
  left join act  on act.app  = apps.app
  left join rv   on rv.app   = apps.app
  where public.is_admin()
  order by coalesce(p.cents, 0) desc, coalesce(d.n, 0) desc;
$$;

/* A day at a time, with every day present even when nothing happened -
   a chart with holes in it lies about the shape. */
create or replace function public.product_daily(p_days int default 30)
returns table (day date, revenue_cents bigint, sales bigint, downloads bigint, installs bigint)
language sql security definer stable set search_path = '' as $$
  with days as (
    select generate_series(
      (now() - make_interval(days => p_days))::date, now()::date, interval '1 day')::date d
  )
  select days.d,
    (select coalesce(sum(amount_cents),0) from public.purchases
       where purchased_at::date = days.d and amount_cents > 0
         and coalesce(currency,'usd') = 'usd'),
    (select count(*) from public.purchases
       where purchased_at::date = days.d and amount_cents > 0),
    (select count(*) from public.app_downloads where at::date = days.d),
    (select count(*) from public.device_activations where first_seen::date = days.d)
  from days where public.is_admin() order by days.d;
$$;

/* The funnel.

   Written as a cohort, not as five separate counts: everybody who made
   an account in the window, and how far each of them got - ever, not
   only inside the window. Counting each stage over the same date range
   independently is how a funnel ends up with more people at the bottom
   than the top, which is the one thing a funnel must never do. Here
   every stage is a subset of the one above it by construction.

   The visitor line above the cohort is deliberately a different unit
   and is labelled as one. It is sessions, because before somebody makes
   an account there is nobody to count.

   The step worth watching is bought to downloaded: somebody who paid
   and never took the file is somebody about to ask for their money
   back. */
-- Dropped first: the shape of this one changed after it had already
-- been run once, and create or replace cannot widen a returns table.
drop function if exists public.product_funnel(int);
create or replace function public.product_funnel(p_days int default 30)
returns table (stage text, n bigint, unit text)
language sql security definer stable set search_path = '' as $$
  with win as (select now() - make_interval(days => p_days) as a),
  cohort as (
    select p.id from public.profiles p, win where p.created_at >= win.a
  ),
  bought as (
    select distinct pu.user_id from public.purchases pu
    join cohort c on c.id = pu.user_id where pu.amount_cents > 0
  ),
  got as (
    select distinct d.user_id from public.app_downloads d
    join bought b on b.user_id = d.user_id
  ),
  ran as (
    select distinct pu.user_id from public.device_activations da
    join public.purchases pu on pu.id = da.license_id
    join got g on g.user_id = pu.user_id
  )
  select 'Opened an app page'::text, (select count(distinct session_id) from public.page_views, win
      where at >= win.a and path ~ '(secondout|aether|afdgate|alignpro|ambanalog|chordlight88|nebulatide|pulseroom|performlive|stemsorter|harmoniemd)'),
      'visits'::text
  where public.is_admin()
  union all select 'Made an account',     (select count(*) from cohort), 'of these accounts' where public.is_admin()
  union all select 'Bought something',    (select count(*) from bought), 'of these accounts' where public.is_admin()
  union all select 'Downloaded it',       (select count(*) from got),    'of these accounts' where public.is_admin()
  union all select 'Ran it on a machine', (select count(*) from ran),    'of these accounts' where public.is_admin();
$$;

/* Where in the world. Visits and downloads side by side, because they
   are rarely the same map, and the difference between the two is the
   argument for local pricing.

   There is no revenue column here on purpose: a purchase row carries no
   country. Stripe and Paystack both know where the card was, and
   neither is asked - the studio does not need it to sell software, and
   a column that would have to be filled by guessing at an address is
   worse than no column. */
create or replace function public.product_geography(p_days int default 30, p_limit int default 14)
returns table (country text, visits bigint, downloads bigint)
language sql security definer stable set search_path = '' as $$
  with win as (select now() - make_interval(days => p_days) as a),
  /* Unknown is folded into a real value in both halves rather than
     left as null: Postgres cannot plan a FULL JOIN on "is not
     distinct from", and a country nobody knows is a row worth showing
     anyway. */
  d as (select coalesce(nullif(country,''),'unknown') c, count(*) n
          from public.app_downloads, win where at >= win.a group by 1),
  v as (select coalesce(nullif(country,''),'unknown') c, count(distinct session_id) n
          from public.page_views, win where at >= win.a group by 1)
  select coalesce(d.c, v.c), coalesce(v.n, 0), coalesce(d.n, 0)
  from d full outer join v on v.c = d.c
  where public.is_admin()
  order by coalesce(d.n,0) desc, coalesce(v.n,0) desc
  limit p_limit;
$$;

/* The installed base. Which builds are actually running, on what, and
   how many have gone quiet. Empty until the Hub is built to send a
   heartbeat - the dashboard says so rather than drawing a zero. */
create or replace function public.product_hub()
returns table (
  installs bigint, active_30d bigint, signed_in bigint,
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

/* Licences and seats. Betas are counted separately because a beta that
   ends on Tuesday is a thing to act on, not a statistic. */
create or replace function public.product_licences()
returns table (
  licences bigint, paid bigint, comped bigint, seats_used bigint,
  betas_live bigint, betas_ending_7d bigint, betas_expired bigint
)
language sql security definer stable set search_path = '' as $$
  select
    (select count(*) from public.purchases),
    (select count(*) from public.purchases where amount_cents > 0),
    (select count(*) from public.purchases where amount_cents = 0),
    (select count(*) from public.device_activations where revoked_at is null),
    (select count(*) from public.purchases where expires_at is not null and expires_at > now()),
    (select count(*) from public.purchases
       where expires_at is not null and expires_at > now()
         and expires_at < now() + interval '7 days'),
    (select count(*) from public.purchases where expires_at is not null and expires_at <= now())
  where public.is_admin();
$$;

/* Codes, as a business question rather than an admin one.

   The Codes page answers "what have I made and what is spent". This
   answers "what are they costing me and are they working" - how many
   licences were given away rather than sold, how much money the
   discounts took off, and which codes people actually use.

   given_cents is what the comped licences would have been worth at
   today's price. It is an opportunity cost, not a loss: most of those
   people would not have bought it. Worth knowing, not worth mourning. */
create or replace function public.product_codes(p_days int default 30)
returns table (
  codes_made bigint, redemptions bigint,
  access_granted bigint, given_cents bigint,
  discounted_sales bigint, discount_given_cents bigint,
  live_grants bigint, grants_ending_7d bigint,
  top_codes jsonb
)
language sql security definer stable set search_path = '' as $$
  with win as (select now() - make_interval(days => p_days) as a),
  granted as (
    select p.app, count(*) n
    from public.purchases p, win
    where p.granted_reason like 'code:%' and p.purchased_at >= win.a
    group by p.app
  )
  select
    (select count(*) from public.codes, win where created_at >= win.a),
    (select count(*) from public.code_redemptions, win where at >= win.a),
    (select coalesce(sum(n),0) from granted),
    /* Priced from the catalog the store is selling from today, joined
       through the app name. An app with no price - a free one, or one
       pulled since - contributes nothing rather than a guess. */
    (select coalesce(sum(granted.n * coalesce(pr.price_cents,0)),0)
       from granted
       left join (select app, max(amount_cents) price_cents
                    from public.purchases
                   where amount_cents > 0 and coalesce(currency,'usd') = 'usd'
                   group by app) pr on pr.app = granted.app),
    (select count(*) from public.purchases, win
       where code is not null and purchased_at >= win.a),
    (select coalesce(sum(discount_cents),0) from public.purchases, win
       where code is not null and purchased_at >= win.a
         and coalesce(currency,'usd') = 'usd'),
    (select count(*) from public.purchases
       where granted_reason like 'code:%'
         and (expires_at is null or expires_at > now())),
    (select count(*) from public.purchases
       where granted_reason like 'code:%'
         and expires_at is not null and expires_at > now()
         and expires_at < now() + interval '7 days'),
    (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
       select c.code, c.kind, c.note, c.uses, c.max_uses
       from public.codes c
       where c.uses > 0
       order by c.uses desc, c.created_at desc
       limit 8) t)
  where public.is_admin();
$$;


/* The most recent sales, for the feed at the bottom of the dashboard.
   An email is shown because the studio already has it on the account
   and needs it to answer "who was that" - it never leaves this page. */
create or replace function public.product_recent(p_limit int default 15)
returns table (at timestamptz, app text, email text, amount_cents int, currency text, kind text)
language sql security definer stable set search_path = '' as $$
  select p.purchased_at, p.app, u.email, p.amount_cents, p.currency,
         case when p.amount_cents = 0 then coalesce(p.granted_reason, 'free')
              when p.stripe_session_id like 'paystack:%' then 'paystack'
              else 'stripe' end
  from public.purchases p
  join auth.users u on u.id = p.user_id
  where public.is_admin()
  order by p.purchased_at desc
  limit p_limit;
$$;


-- =====================================================================
--  5 · THE BADGE ON THE STORE
--
--  app_download_counts is what draws "1.2k downloads" under a tile, and
--  it has only ever read download_events - the old email-gated flow.
--  Every download since the Hub shipped went uncounted, so the badge has
--  been telling visitors a smaller number than the truth.
--
--  Counting both, without double counting: the old table stopped being
--  written when the new one started, so the two never describe the same
--  download. Still public, and still only ever a count - which is what
--  made it safe to show to anyone in the first place.
-- =====================================================================

create or replace function public.app_download_counts()
returns table (app text, downloads bigint)
language sql security definer stable set search_path = '' as $$
  select app, sum(n)::bigint from (
    select app, count(*) n from public.download_events where app is not null group by app
    union all
    select app, count(*) n from public.app_downloads  where app is not null group by app
  ) both_of_them
  group by app;
$$;

grant execute on function public.app_download_counts() to anon, authenticated;


-- =====================================================================
--  6 · HOUSEKEEPING
--
--  Downloads are kept for two years. Long enough for a year-on-year
--  comparison, short enough that this never becomes a pile of history
--  nobody looks at. hub_installs is not pruned by age - an install that
--  has been quiet for a year is itself the interesting fact.
-- =====================================================================

create or replace function public.product_prune()
returns void language sql security definer set search_path = '' as $$
  delete from public.app_downloads where at < now() - interval '2 years';
$$;


-- =====================================================================
--  7 · WHAT IS THERE NOW
-- =====================================================================

select 'app_downloads' as table, count(*) as rows from public.app_downloads
union all
select 'hub_installs', count(*) from public.hub_installs
union all
select 'purchases', count(*) from public.purchases
union all
select 'device_activations', count(*) from public.device_activations
union all
select 'download_events (old, website only)', count(*) from public.download_events;
