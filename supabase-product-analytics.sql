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
--  Run the whole thing in the Supabase SQL editor, then
--  supabase-admin-audit.sql, which holds the reports. Safe to run twice.
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
--  4 · REPORTS
--
--  Moved. The reports the dashboard reads - product_summary,
--  product_by_app, product_daily, product_funnel, product_geography,
--  product_hub, product_licences, product_recent and product_money -
--  now live in supabase-admin-audit.sql, built on one downloads view
--  and one entitlement kind, so that "downloads" and "sales" mean one
--  thing everywhere. Run that file after this one. product_codes stays
--  here because nothing about it changed.
-- =====================================================================

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
