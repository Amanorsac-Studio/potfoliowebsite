-- =====================================================================
--  REDEEM CODES
--
--  One code, handed to somebody, that they redeem themselves. Two kinds
--  share a table because they are nearly the same object:
--
--    access    the code grants the app. A tester, a collaborator, a
--              room full of people at a workshop.
--    discount  the code takes money off at checkout.
--
--  What this replaces: sending the studio an email address and waiting
--  for a row to be added by hand, one person at a time.
--
--  HOW LONG A GRANT LASTS IS PER CODE. grant_days makes a licence that
--  ends in that many days from the moment it is redeemed; grant_until
--  ends on a fixed date whoever redeems it and whenever; neither means
--  it is theirs to keep. So the same machinery hands out a thirty-day
--  beta, a licence that dies the day a conference ends, and a permanent
--  comp for a collaborator, without a new kind of thing each time.
--
--  WHY OUR OWN DISCOUNTS RATHER THAN STRIPE'S. Stripe has promotion
--  codes and Paystack has nothing comparable. Using Stripe's would mean
--  discounts that work for a card in London and silently do not work
--  for mobile money in Accra. Both checkouts already compute the price
--  on the server, so one system of our own applies to both identically.
--
--  Run the whole thing in the Supabase SQL editor. Safe to run twice.
-- =====================================================================


-- =====================================================================
--  0 · WHAT THIS NEEDS FROM THE PURCHASES TABLE
--
--  A granted licence has no Stripe session behind it, and expires_at is
--  what makes a grant end. Both are done by other files in this folder -
--  supabase-licenses.sql drops the NOT NULL, supabase-beta-licenses.sql
--  adds the column - and both are repeated here because "run that one
--  first" is not a property a script should have. Whichever order they
--  are run in, they work.
-- =====================================================================

alter table public.purchases alter column stripe_session_id drop not null;
alter table public.purchases add column if not exists expires_at     timestamptz;
alter table public.purchases add column if not exists granted_reason text;


-- =====================================================================
--  1 · THE CODES
-- =====================================================================

create table if not exists public.codes (
  code         text primary key,
  kind         text not null check (kind in ('access', 'discount')),

  -- Which apps it is good for. '*' means any of them. Kept as an array
  -- so one code can cover a bundle without inventing a bundle.
  apps         text[] not null default array['*'],

  -- access: how long the licence lasts. Both null means for keeps.
  grant_days   integer check (grant_days is null or grant_days > 0),
  grant_until  timestamptz,

  -- discount: one or the other, never both.
  percent_off  integer check (percent_off is null or (percent_off between 1 and 100)),
  amount_off_cents integer check (amount_off_cents is null or amount_off_cents > 0),

  -- both kinds
  max_uses     integer check (max_uses is null or max_uses > 0),   -- null = unlimited
  uses         integer not null default 0,
  expires_at   timestamptz,          -- when the CODE stops working
  note         text,                 -- "October worship conference"
  disabled     boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null,

  constraint codes_discount_has_a_value check (
    kind <> 'discount' or (percent_off is not null) <> (amount_off_cents is not null)),
  constraint codes_access_has_no_discount check (
    kind <> 'access' or (percent_off is null and amount_off_cents is null))
);

create index if not exists codes_kind_idx on public.codes (kind, created_at desc);

alter table public.codes enable row level security;

-- Nobody reads this table from a browser. Not even to check a code:
-- that goes through redeem_code() below, which answers yes or no and
-- never hands over the row. A codes table anybody could SELECT is a
-- codes table anybody can spend.
drop policy if exists codes_admin on public.codes;
create policy codes_admin on public.codes
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));


-- =====================================================================
--  2 · WHO USED WHAT
--
--  One row per (code, person). The unique constraint is the rule, not a
--  convenience: it is what stops one person spending a fifty-use
--  workshop code fifty times.
-- =====================================================================

create table if not exists public.code_redemptions (
  id       bigserial primary key,
  code     text not null references public.codes(code) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  app      text,
  at       timestamptz not null default now(),
  unique (code, user_id)
);

create index if not exists code_redemptions_code_idx on public.code_redemptions (code);
create index if not exists code_redemptions_user_idx on public.code_redemptions (user_id);

alter table public.code_redemptions enable row level security;

drop policy if exists code_redemptions_own on public.code_redemptions;
create policy code_redemptions_own on public.code_redemptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists code_redemptions_admin on public.code_redemptions;
create policy code_redemptions_admin on public.code_redemptions
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));


-- =====================================================================
--  3 · MAKING CODES
--
--  The alphabet leaves out O, 0, I, 1, S and 5. These get read down a
--  phone line and written on paper, and every pair above is the pair
--  somebody gets wrong.
-- =====================================================================

create or replace function public.generate_code(p_prefix text default 'AMAN')
returns text
language plpgsql security definer set search_path = '' as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  out text := upper(left(regexp_replace(coalesce(p_prefix, 'AMAN'), '[^A-Za-z0-9]', '', 'g'), 6));
  i int;
begin
  if out = '' then out := 'AMAN'; end if;
  for i in 1..12 loop
    if i % 4 = 1 then out := out || '-'; end if;
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;

/* Make a batch. Returns the codes so the admin page can print them
   once - there is no other moment they are shown as a list, because
   after this they are rows to be spent, not a document. */
create or replace function public.create_codes(
  p_count       int,
  p_kind        text,
  p_apps        text[] default array['*'],
  p_grant_days  int default null,
  p_grant_until timestamptz default null,
  p_percent_off int default null,
  p_amount_off_cents int default null,
  p_max_uses    int default 1,
  p_expires_at  timestamptz default null,
  p_note        text default null,
  p_prefix      text default 'AMAN'
) returns table (code text)
language plpgsql security definer set search_path = '' as $$
declare
  i int;
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'Only the studio can make codes';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'Make between 1 and 500 codes at a time';
  end if;

  for i in 1..p_count loop
    -- Collisions are vanishingly unlikely and free to retry, so retry
    -- rather than reason about it.
    loop
      v_code := public.generate_code(p_prefix);
      exit when not exists (select 1 from public.codes c where c.code = v_code);
    end loop;

    insert into public.codes (code, kind, apps, grant_days, grant_until,
                              percent_off, amount_off_cents, max_uses,
                              expires_at, note, created_by)
    values (v_code, p_kind, coalesce(p_apps, array['*']), p_grant_days, p_grant_until,
            p_percent_off, p_amount_off_cents, p_max_uses,
            p_expires_at, p_note, auth.uid());

    code := v_code;
    return next;
  end loop;
end $$;

revoke all on function public.create_codes(int,text,text[],int,timestamptz,int,int,int,timestamptz,text,text) from public;
grant execute on function public.create_codes(int,text,text[],int,timestamptz,int,int,int,timestamptz,text,text) to authenticated;


-- =====================================================================
--  4 · REDEEMING
--
--  The only door a visitor has into any of this. It answers what
--  happened and never returns the code row, so a wrong guess learns
--  nothing except that it was wrong.
-- =====================================================================

create or replace function public.redeem_code(p_code text, p_app text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
  v_app  text := lower(trim(coalesce(p_app, '')));
  c      public.codes%rowtype;
  v_uid  uuid := auth.uid();
  v_expires timestamptz;
  v_key  text;
  v_spent int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sign_in');
  end if;
  if length(v_code) < 6 then
    return jsonb_build_object('ok', false, 'error', 'not_a_code');
  end if;

  /* for update: two people redeeming the last use of the same code at
     the same moment must not both win. Everything below happens with
     the row held. */
  select * into c from public.codes where code = v_code for update;

  if not found                              then return jsonb_build_object('ok', false, 'error', 'no_such_code'); end if;
  if c.disabled                             then return jsonb_build_object('ok', false, 'error', 'disabled');     end if;
  if c.expires_at is not null
     and c.expires_at <= now()              then return jsonb_build_object('ok', false, 'error', 'expired');      end if;
  if c.max_uses is not null
     and c.uses >= c.max_uses               then return jsonb_build_object('ok', false, 'error', 'all_used');     end if;

  if exists (select 1 from public.code_redemptions r
             where r.code = v_code and r.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'already_used_by_you');
  end if;

  -- Which app. A code good for exactly one app does not need telling.
  if v_app = '' and array_length(c.apps, 1) = 1 and c.apps[1] <> '*' then
    v_app := c.apps[1];
  end if;
  if v_app = '' then
    return jsonb_build_object('ok', false, 'error', 'choose_an_app', 'apps', to_jsonb(c.apps));
  end if;
  if not (c.apps @> array['*'] or c.apps @> array[v_app]) then
    return jsonb_build_object('ok', false, 'error', 'wrong_app', 'apps', to_jsonb(c.apps));
  end if;

  /* A discount is not spent here - it is spent when the payment lands,
     by the checkout. Saying so is all this does. */
  if c.kind = 'discount' then
    return jsonb_build_object('ok', true, 'kind', 'discount', 'app', v_app,
      'percent_off', c.percent_off, 'amount_off_cents', c.amount_off_cents);
  end if;

  if exists (select 1 from public.purchases p where p.user_id = v_uid and p.app = v_app) then
    return jsonb_build_object('ok', false, 'error', 'already_owned', 'app', v_app);
  end if;

  v_expires := case
    when c.grant_until is not null then c.grant_until
    when c.grant_days  is not null then now() + make_interval(days => c.grant_days)
    else null                                  -- theirs to keep
  end;

  v_key := public.generate_license_key(v_app);
  insert into public.purchases (user_id, app, amount_cents, license_key,
                                update_eligible_until, expires_at, granted_reason)
  values (v_uid, v_app, 0, v_key, 'infinity', v_expires, 'code:' || v_code);

  insert into public.code_redemptions (code, user_id, app) values (v_code, v_uid, v_app);
  update public.codes set uses = uses + 1 where code = v_code;

  return jsonb_build_object('ok', true, 'kind', 'access', 'app', v_app,
    'license_key', v_key, 'expires_at', v_expires);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_used_by_you');
end $$;

revoke all on function public.redeem_code(text, text) from public;
grant execute on function public.redeem_code(text, text) to authenticated;


-- =====================================================================
--  5 · DISCOUNTS AT CHECKOUT  (phase 2 uses these)
--
--  Two halves on purpose. The checkout asks what a code is worth before
--  it charges anybody; it marks the code spent only once the money has
--  actually arrived. A code marked spent for a checkout somebody
--  abandoned is a code the next person cannot use.
-- =====================================================================

create or replace function public.code_value(p_code text, p_app text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
  v_app  text := lower(trim(coalesce(p_app, '')));
  c public.codes%rowtype;
begin
  select * into c from public.codes where code = v_code and kind = 'discount';
  if not found or c.disabled then return jsonb_build_object('ok', false, 'error', 'no_such_code'); end if;
  if c.expires_at is not null and c.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if c.max_uses is not null and c.uses >= c.max_uses then
    return jsonb_build_object('ok', false, 'error', 'all_used'); end if;
  if not (c.apps @> array['*'] or c.apps @> array[v_app]) then
    return jsonb_build_object('ok', false, 'error', 'wrong_app'); end if;
  if p_user is not null and exists (
       select 1 from public.code_redemptions r where r.code = v_code and r.user_id = p_user) then
    return jsonb_build_object('ok', false, 'error', 'already_used_by_you'); end if;

  return jsonb_build_object('ok', true, 'code', v_code,
    'percent_off', c.percent_off, 'amount_off_cents', c.amount_off_cents);
end $$;

revoke all on function public.code_value(text,text,uuid) from public;
revoke all on function public.code_value(text,text,uuid) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.code_value(text,text,uuid) to service_role;
  end if;
end $$;

/* Called once the payment is real. Atomic: the update only succeeds
   while there are uses left, so two paid checkouts racing for the last
   use cannot both take it. */
create or replace function public.spend_code(p_code text, p_app text, p_user uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
  v_rows int;
begin
  update public.codes set uses = uses + 1
   where code = v_code
     and not disabled
     and (expires_at is null or expires_at > now())
     and (max_uses is null or uses < max_uses);
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;

  insert into public.code_redemptions (code, user_id, app)
  values (v_code, p_user, lower(p_app))
  on conflict (code, user_id) do nothing;
  return true;
end $$;

revoke all on function public.spend_code(text,text,uuid) from public;
revoke all on function public.spend_code(text,text,uuid) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.spend_code(text,text,uuid) to service_role;
  end if;
end $$;


-- =====================================================================
--  6 · WHAT THE STUDIO SEES
-- =====================================================================

create or replace function public.codes_list(p_limit int default 200)
returns table (
  code text, kind text, apps text[], note text,
  grant_days int, grant_until timestamptz,
  percent_off int, amount_off_cents int,
  max_uses int, uses int, expires_at timestamptz, disabled boolean,
  created_at timestamptz, state text
)
language sql security definer stable set search_path = '' as $$
  select c.code, c.kind, c.apps, c.note, c.grant_days, c.grant_until,
         c.percent_off, c.amount_off_cents, c.max_uses, c.uses,
         c.expires_at, c.disabled, c.created_at,
         case when c.disabled then 'off'
              when c.expires_at is not null and c.expires_at <= now() then 'expired'
              when c.max_uses is not null and c.uses >= c.max_uses then 'used up'
              when c.uses > 0 then 'in use'
              else 'unused' end
  from public.codes c
  where public.is_admin()
  order by c.created_at desc
  limit greatest(1, least(p_limit, 500));
$$;

create or replace function public.set_code_disabled(p_code text, p_off boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the studio can do that'; end if;
  update public.codes set disabled = coalesce(p_off, true)
   where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
end $$;

grant execute on function public.set_code_disabled(text, boolean) to authenticated;

create or replace function public.code_redemption_list(p_limit int default 100)
returns table (code text, email text, app text, at timestamptz)
language sql security definer stable set search_path = '' as $$
  select r.code, u.email, r.app, r.at
  from public.code_redemptions r
  join auth.users u on u.id = r.user_id
  where public.is_admin()
  order by r.at desc
  limit greatest(1, least(p_limit, 500));
$$;


-- =====================================================================
--  7 · WHAT IS THERE NOW
-- =====================================================================

select 'codes' as thing, count(*) as n from public.codes
union all
select 'redemptions', count(*) from public.code_redemptions;
