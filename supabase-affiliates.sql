-- =====================================================================
--  AFFILIATES
--
--  Somebody with an audience sends people to the store and earns a cut
--  of what those people pay. The whole thing rides on the discount
--  codes that already exist (supabase-redeem-codes.sql): an affiliate IS
--  a discount code with an owner. The buyer gets the code's percentage
--  off, the owner gets a commission on what was actually paid, and the
--  purchases row the webhook writes is the only record anyone needs.
--
--  The link form - amanorsac.studio/chordlight88?ref=NENE10 - is the
--  same code, remembered by the buyer's browser for thirty days and
--  typed into the checkout for them (assets/track.js saves it,
--  assets/app-purchase.js applies it). Last link wins. A code typed by
--  hand beats a remembered one.
--
--  MONEY. Commission is on amount_cents, which is what the buyer paid
--  after the discount and in whatever currency they paid it: a cedi
--  sale through Paystack earns a cedi commission, a dollar sale a dollar
--  one, and the payout page keeps the currencies apart. An earning is
--  held for fourteen days (the refund window) before it counts as owed,
--  is reversed if the sale is refunded, and is paid by hand once a
--  month from the admin page, which records what was sent and marks
--  the earnings paid.
--
--  WHAT THIS NEEDS. codes.reusable, which code_value and spend_code in
--  supabase-redeem-codes.sql honour: an affiliate code can be used by
--  the same person again for another app. The column is added here too
--  so the order the files run in does not matter, but if the codes file
--  was run before October 2026 run it again so the two functions learn
--  the column.
--
--  Run the whole thing in the Supabase SQL editor. Safe to run twice.
-- =====================================================================

alter table public.codes add column if not exists reusable boolean not null default false;
-- the checkout's code travels on the purchases row (supabase-product-analytics.sql
-- adds these too; repeated so this file runs on its own)
alter table public.purchases add column if not exists code           text;
alter table public.purchases add column if not exists discount_cents integer;


-- =====================================================================
--  1 · THE AFFILIATES
-- =====================================================================

create table if not exists public.affiliates (
  id             bigserial primary key,
  user_id        uuid not null unique references public.profiles(id) on delete cascade,

  -- what they told us when they applied
  name           text not null,              -- how they want to be known
  links          text,                       -- channel, page, site
  audience       text,                       -- "worship keys players, ~12k on YouTube"
  message        text,

  -- how they are paid. PayPal takes an email, MoMo a number.
  payout_method  text not null check (payout_method in ('paypal', 'momo')),
  payout_to      text not null,

  -- set on approval
  code           text unique references public.codes(code) on delete set null,
  commission_pct integer not null default 20 check (commission_pct between 1 and 90),

  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'declined', 'disabled')),
  note           text,                       -- the studio's, never shown to them
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);
create index if not exists affiliates_status_idx on public.affiliates (status, created_at desc);

alter table public.affiliates enable row level security;

-- They see their own row. Everything they may change goes through a
-- function below, so there is no update policy on purpose.
drop policy if exists affiliates_own on public.affiliates;
create policy affiliates_own on public.affiliates
  for select to authenticated using (user_id = auth.uid());

drop policy if exists affiliates_admin on public.affiliates;
create policy affiliates_admin on public.affiliates
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select on public.affiliates to authenticated;
grant all on public.affiliates to service_role;


-- =====================================================================
--  2 · EARNINGS, PAYOUTS, CLICKS
-- =====================================================================

create table if not exists public.affiliate_payouts (
  id            bigserial primary key,
  affiliate_id  bigint not null references public.affiliates(id) on delete cascade,
  amount_cents  integer not null,
  currency      text not null default 'usd',
  method        text not null,
  reference     text,                        -- the PayPal transaction, the MoMo id
  note          text,
  paid_at       timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null
);
create index if not exists affiliate_payouts_aff_idx on public.affiliate_payouts (affiliate_id, paid_at desc);

-- One row per sale that came through an affiliate's code. Written by
-- the trigger in §3 and never by hand.
create table if not exists public.affiliate_earnings (
  id               bigserial primary key,
  affiliate_id     bigint not null references public.affiliates(id) on delete cascade,
  purchase_id      bigint not null unique references public.purchases(id) on delete cascade,
  app              text not null,
  sale_cents       integer not null,         -- what the buyer paid, after the discount
  currency         text not null default 'usd',
  commission_cents integer not null,
  status           text not null default 'pending' check (status in ('pending', 'paid')),
  payable_at       timestamptz not null,     -- fourteen days after the sale
  paid_at          timestamptz,
  payout_id        bigint references public.affiliate_payouts(id) on delete set null,

  -- a refund. A reversed earning that was never paid simply stops being
  -- owed; one that was already paid is taken off the next payout, and
  -- clawed_back marks the payout that did it.
  reversed_at      timestamptz,
  clawed_back      boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists affiliate_earnings_aff_idx on public.affiliate_earnings (affiliate_id, created_at desc);

-- Link clicks, one counter per code per day. No visitor, no page, no
-- referrer: enough to tell an affiliate whether the link is being used.
create table if not exists public.affiliate_clicks (
  code    text not null references public.codes(code) on delete cascade,
  day     date not null default current_date,
  clicks  integer not null default 0,
  primary key (code, day)
);

alter table public.affiliate_payouts  enable row level security;
alter table public.affiliate_earnings enable row level security;
alter table public.affiliate_clicks   enable row level security;

drop policy if exists affiliate_payouts_own on public.affiliate_payouts;
create policy affiliate_payouts_own on public.affiliate_payouts
  for select to authenticated
  using (affiliate_id in (select id from public.affiliates where user_id = auth.uid()));
drop policy if exists affiliate_payouts_admin on public.affiliate_payouts;
create policy affiliate_payouts_admin on public.affiliate_payouts
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists affiliate_earnings_own on public.affiliate_earnings;
create policy affiliate_earnings_own on public.affiliate_earnings
  for select to authenticated
  using (affiliate_id in (select id from public.affiliates where user_id = auth.uid()));
drop policy if exists affiliate_earnings_admin on public.affiliate_earnings;
create policy affiliate_earnings_admin on public.affiliate_earnings
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Clicks are read through my_affiliate() and written by affiliate_click();
-- nobody reads the table directly.
drop policy if exists affiliate_clicks_admin on public.affiliate_clicks;
create policy affiliate_clicks_admin on public.affiliate_clicks
  for select to authenticated using ((select public.is_admin()));

grant select on public.affiliate_payouts, public.affiliate_earnings, public.affiliate_clicks to authenticated;
grant all on public.affiliate_payouts, public.affiliate_earnings, public.affiliate_clicks to service_role;


-- =====================================================================
--  3 · THE CREDIT, written the moment a sale lands
--
--  purchases rows arrive from stripe-webhook, paystack-webhook and
--  confirm-checkout, all of which copy the checkout's code onto the
--  row. If that code belongs to an approved affiliate, and the buyer is
--  not the affiliate, and money actually changed hands, the earning is
--  written here. Grants and free claims have no amount and earn nothing.
-- =====================================================================

create or replace function public.affiliate_credit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.affiliates%rowtype;
begin
  if new.code is null or coalesce(new.amount_cents, 0) <= 0 then return new; end if;
  select * into a from public.affiliates where code = new.code and status = 'approved';
  if not found or a.user_id = new.user_id then return new; end if;
  insert into public.affiliate_earnings
    (affiliate_id, purchase_id, app, sale_cents, currency, commission_cents, payable_at)
  values
    (a.id, new.id, new.app, new.amount_cents, lower(coalesce(new.currency, 'usd')),
     round(new.amount_cents * a.commission_pct / 100.0)::integer,
     coalesce(new.purchased_at, now()) + interval '14 days')
  on conflict (purchase_id) do nothing;
  return new;
end $$;

drop trigger if exists purchases_affiliate_credit on public.purchases;
create trigger purchases_affiliate_credit
  after insert on public.purchases
  for each row execute function public.affiliate_credit();


-- =====================================================================
--  4 · WHAT AN AFFILIATE CAN DO
-- =====================================================================

/* Apply. One row per account; a declined person may apply again and
   the row is simply refreshed. Approved and disabled rows are not
   touched from here. */
create or replace function public.apply_affiliate(
  p_name text, p_links text, p_audience text, p_message text,
  p_payout_method text, p_payout_to text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  cur public.affiliates%rowtype;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name'; end if;
  if p_payout_method not in ('paypal', 'momo') then raise exception 'payout_method'; end if;
  if length(trim(coalesce(p_payout_to, ''))) < 5 then raise exception 'payout_to'; end if;

  select * into cur from public.affiliates where user_id = v_uid;
  if found and cur.status in ('approved', 'disabled') then
    return jsonb_build_object('ok', false, 'status', cur.status);
  end if;

  insert into public.affiliates (user_id, name, links, audience, message, payout_method, payout_to)
  values (v_uid, left(trim(p_name), 80), left(p_links, 600), left(p_audience, 400), left(p_message, 1200),
          p_payout_method, left(trim(p_payout_to), 120))
  on conflict (user_id) do update
    set name = excluded.name, links = excluded.links, audience = excluded.audience,
        message = excluded.message, payout_method = excluded.payout_method,
        payout_to = excluded.payout_to, status = 'pending', note = null,
        created_at = now(), decided_at = null;
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;
grant execute on function public.apply_affiliate(text, text, text, text, text, text) to authenticated;

/* Change where the money goes. The only field they edit after approval. */
create or replace function public.set_affiliate_payout(p_method text, p_to text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_method not in ('paypal', 'momo') then raise exception 'payout_method'; end if;
  if length(trim(coalesce(p_to, ''))) < 5 then raise exception 'payout_to'; end if;
  update public.affiliates set payout_method = p_method, payout_to = left(trim(p_to), 120)
   where user_id = auth.uid();
end $$;
grant execute on function public.set_affiliate_payout(text, text) to authenticated;

/* Everything the dashboard draws, in one call. Buyers are never named:
   an affiliate sees the app, the day, the sale and the cut. */
create or replace function public.my_affiliate()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.affiliates%rowtype;
  c public.codes%rowtype;
  v_totals jsonb; v_recent jsonb; v_payouts jsonb; v_clicks jsonb;
begin
  select * into a from public.affiliates where user_id = auth.uid();
  if not found then return jsonb_build_object('status', 'none'); end if;
  if a.code is not null then select * into c from public.codes where code = a.code; end if;

  -- per currency: pending (in the hold), owed (past the hold, unpaid), paid, reversed
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_totals from (
    select currency,
      count(*) filter (where reversed_at is null)                                             as sales,
      coalesce(sum(commission_cents) filter (where status = 'pending' and reversed_at is null and payable_at >  now()), 0) as pending_cents,
      coalesce(sum(commission_cents) filter (where status = 'pending' and reversed_at is null and payable_at <= now()), 0)
      - coalesce(sum(commission_cents) filter (where status = 'paid' and reversed_at is not null and not clawed_back), 0) as owed_cents,
      coalesce(sum(commission_cents) filter (where status = 'paid'), 0)                       as paid_cents
    from public.affiliate_earnings where affiliate_id = a.id group by currency) t;

  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) into v_recent from (
    select app, sale_cents, currency, commission_cents, created_at, payable_at, paid_at, reversed_at,
      case when reversed_at is not null then 'refunded'
           when status = 'paid' then 'paid'
           when payable_at <= now() then 'owed' else 'pending' end as state
    from public.affiliate_earnings where affiliate_id = a.id
    order by created_at desc limit 100) t;

  select coalesce(jsonb_agg(t order by t.paid_at desc), '[]'::jsonb) into v_payouts from (
    select amount_cents, currency, method, reference, paid_at
    from public.affiliate_payouts where affiliate_id = a.id order by paid_at desc limit 36) t;

  select jsonb_build_object(
    'last_30', coalesce(sum(clicks) filter (where day > current_date - 30), 0),
    'all',     coalesce(sum(clicks), 0))
  into v_clicks from public.affiliate_clicks where code = a.code;

  return jsonb_build_object(
    'status', a.status, 'name', a.name, 'code', a.code,
    'percent_off', c.percent_off, 'commission_pct', a.commission_pct,
    'payout_method', a.payout_method, 'payout_to', a.payout_to,
    'applied_at', a.created_at, 'decided_at', a.decided_at,
    'totals', v_totals, 'recent', v_recent, 'payouts', v_payouts, 'clicks', v_clicks);
end $$;
grant execute on function public.my_affiliate() to authenticated;

/* A click on a ?ref= link, counted by the visitor's browser before
   anyone signs in. Only counts for a live affiliate code, so the table
   cannot be filled with junk. */
create or replace function public.affiliate_click(p_code text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
begin
  if v_code = '' or not exists (
      select 1 from public.affiliates where code = v_code and status = 'approved') then return; end if;
  insert into public.affiliate_clicks (code, day, clicks) values (v_code, current_date, 1)
  on conflict (code, day) do update set clicks = public.affiliate_clicks.clicks + 1;
end $$;
grant execute on function public.affiliate_click(text) to anon, authenticated;


-- =====================================================================
--  5 · WHAT THE STUDIO DOES
-- =====================================================================

/* Let someone in. Makes their code - a word they will say out loud, so
   it is chosen by hand, upper-cased, letters and digits only - and the
   discount their buyers get. */
create or replace function public.approve_affiliate(
  p_id bigint, p_code text, p_percent_off integer default 10, p_commission_pct integer default 20)
returns public.affiliates
language plpgsql security definer set search_path = '' as $$
declare
  a public.affiliates%rowtype;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into a from public.affiliates where id = p_id;
  if a.id is null then raise exception 'no such application'; end if;
  if length(v_code) < 4 or length(v_code) > 16 then raise exception 'code must be 4 to 16 letters or digits'; end if;
  if p_percent_off not between 0 and 50 then raise exception 'percent_off'; end if;
  if p_commission_pct not between 1 and 90 then raise exception 'commission_pct'; end if;
  if exists (select 1 from public.codes where code = v_code) and a.code is distinct from v_code then
    raise exception 'that code is already taken'; end if;

  -- a re-approval keeps the old code row if the word is unchanged
  if a.code is not null and a.code <> v_code then
    update public.codes set disabled = true where code = a.code;
  end if;
  insert into public.codes (code, kind, apps, percent_off, max_uses, reusable, note, created_by)
  values (v_code, 'discount', array['*'], nullif(p_percent_off, 0), null, true, 'affiliate: ' || a.name, auth.uid())
  on conflict (code) do update
    set percent_off = excluded.percent_off, disabled = false, reusable = true, note = excluded.note;

  update public.affiliates
     set status = 'approved', code = v_code, commission_pct = p_commission_pct, decided_at = now()
   where id = p_id returning * into a;
  return a;
end $$;
grant execute on function public.approve_affiliate(bigint, text, integer, integer) to authenticated;

create or replace function public.decline_affiliate(p_id bigint, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.affiliates set status = 'declined', note = p_note, decided_at = now()
   where id = p_id and status = 'pending';
end $$;
grant execute on function public.decline_affiliate(bigint, text) to authenticated;

/* Switch one off, or back on. Off also stops the code, so the link and
   the word stop working the same minute. Earnings already owed stay owed. */
create or replace function public.set_affiliate_disabled(p_id bigint, p_off boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare a public.affiliates%rowtype;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into a from public.affiliates where id = p_id and status in ('approved', 'disabled');
  if a.id is null then raise exception 'not an approved affiliate'; end if;
  update public.affiliates set status = case when p_off then 'disabled' else 'approved' end where id = p_id;
  if a.code is not null then update public.codes set disabled = p_off where code = a.code; end if;
end $$;
grant execute on function public.set_affiliate_disabled(bigint, boolean) to authenticated;

/* Every affiliate with their numbers. Owed is what the next payout
   would be: the earnings past the hold, less anything paid and then
   refunded. */
create or replace function public.affiliates_list()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(t order by
      case t.status when 'pending' then 0 when 'approved' then 1 when 'disabled' then 2 else 3 end,
      t.created_at desc), '[]'::jsonb)
  into out from (
    select a.id, a.user_id, p.email, a.name, a.links, a.audience, a.message, a.payout_method, a.payout_to,
           a.code, a.commission_pct, a.status, a.note, a.created_at, a.decided_at,
           c.percent_off,
           (select coalesce(sum(clicks), 0) from public.affiliate_clicks k where k.code = a.code) as clicks,
           (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from (
              select e.currency,
                count(*) filter (where e.reversed_at is null) as sales,
                coalesce(sum(e.commission_cents) filter (where e.status = 'pending' and e.reversed_at is null and e.payable_at >  now()), 0) as pending_cents,
                coalesce(sum(e.commission_cents) filter (where e.status = 'pending' and e.reversed_at is null and e.payable_at <= now()), 0)
                - coalesce(sum(e.commission_cents) filter (where e.status = 'paid' and e.reversed_at is not null and not e.clawed_back), 0) as owed_cents,
                coalesce(sum(e.commission_cents) filter (where e.status = 'paid'), 0) as paid_cents
              from public.affiliate_earnings e where e.affiliate_id = a.id
              group by e.currency) m) as money
    from public.affiliates a
    left join public.profiles p on p.id = a.user_id
    left join public.codes c on c.code = a.code) t;
  return out;
end $$;
grant execute on function public.affiliates_list() to authenticated;

/* One affiliate's sales, newest first, with the buyer's email: the
   studio may need to match a refund to it. */
create or replace function public.affiliate_earnings_admin(p_id bigint, p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) into out from (
    select e.id, e.purchase_id, e.app, e.sale_cents, e.currency, e.commission_cents, e.status,
           e.payable_at, e.paid_at, e.reversed_at, e.clawed_back, e.created_at,
           p.email as buyer, pu.stripe_session_id as session
    from public.affiliate_earnings e
    join public.purchases pu on pu.id = e.purchase_id
    left join public.profiles p on p.id = pu.user_id
    where e.affiliate_id = p_id
    order by e.created_at desc limit p_limit) t;
  return out;
end $$;
grant execute on function public.affiliate_earnings_admin(bigint, integer) to authenticated;

/* A refund. The earning stops being owed; if it was already paid it
   comes off the next payout. Twice is harmless. */
create or replace function public.reverse_affiliate_earning(p_purchase bigint)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rows int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.affiliate_earnings set reversed_at = coalesce(reversed_at, now())
   where purchase_id = p_purchase;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;
grant execute on function public.reverse_affiliate_earning(bigint) to authenticated;

/* The same, found by the payment reference the webhooks store -
   stripe-webhook calls this when Stripe says a charge was refunded. */
create or replace function public.reverse_affiliate_earning_by_session(p_session text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rows int;
begin
  update public.affiliate_earnings e set reversed_at = coalesce(e.reversed_at, now())
   from public.purchases p
   where p.id = e.purchase_id and p.stripe_session_id = p_session;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;
revoke all on function public.reverse_affiliate_earning_by_session(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.reverse_affiliate_earning_by_session(text) to service_role;
  end if;
end $$;

/* Money went out. Records the payout, marks every owed earning in that
   currency paid against it, and absorbs any paid-then-refunded ones.
   Returns the row, with the amount it worked out - the admin page shows
   the figure BEFORE this is called, and this is what makes it final. */
create or replace function public.record_affiliate_payout(
  p_id bigint, p_currency text, p_method text, p_reference text default null, p_note text default null)
returns public.affiliate_payouts
language plpgsql security definer set search_path = '' as $$
declare
  v_cur text := lower(coalesce(p_currency, 'usd'));
  v_owed integer; v_claw integer; pay public.affiliate_payouts%rowtype;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select coalesce(sum(commission_cents), 0) into v_owed from public.affiliate_earnings
   where affiliate_id = p_id and currency = v_cur and status = 'pending' and reversed_at is null and payable_at <= now();
  select coalesce(sum(commission_cents), 0) into v_claw from public.affiliate_earnings
   where affiliate_id = p_id and currency = v_cur and status = 'paid' and reversed_at is not null and not clawed_back;
  if v_owed - v_claw <= 0 then raise exception 'nothing owed in %', v_cur; end if;

  insert into public.affiliate_payouts (affiliate_id, amount_cents, currency, method, reference, note, created_by)
  values (p_id, v_owed - v_claw, v_cur, p_method, p_reference, p_note, auth.uid())
  returning * into pay;

  update public.affiliate_earnings set status = 'paid', paid_at = now(), payout_id = pay.id
   where affiliate_id = p_id and currency = v_cur and status = 'pending' and reversed_at is null and payable_at <= now();
  update public.affiliate_earnings set clawed_back = true
   where affiliate_id = p_id and currency = v_cur and status = 'paid' and reversed_at is not null and not clawed_back
     and payout_id is distinct from pay.id;
  return pay;
end $$;
grant execute on function public.record_affiliate_payout(bigint, text, text, text, text) to authenticated;

/* How many applications are waiting - the dashboard's to-do line. */
create or replace function public.affiliate_counts()
returns jsonb
language sql security definer stable set search_path = '' as $$
  select case when public.is_admin() then jsonb_build_object(
    'pending',  (select count(*) from public.affiliates where status = 'pending'),
    'approved', (select count(*) from public.affiliates where status = 'approved'),
    'owed_usd', (select coalesce(sum(commission_cents), 0) from public.affiliate_earnings
                  where currency = 'usd' and status = 'pending' and reversed_at is null and payable_at <= now()))
  else '{}'::jsonb end;
$$;
grant execute on function public.affiliate_counts() to authenticated;

notify pgrst, 'reload schema';
