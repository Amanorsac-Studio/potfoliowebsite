-- =====================================================================
--  WHY ARE THE CODES NOT WORKING
--
--  Paste into Supabase → SQL Editor → New query → Run. It reads and
--  reports; it changes nothing and is safe to run at any time.
--
--  Five answers, in the order they matter. The first one that says
--  something other than "ok" is the reason.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1 · IS THE MACHINERY EVEN THERE
--
--  A function that does not exist is the single most common cause: the
--  page calls it, the database says no such function, and the page says
--  "something went wrong on our end" without ever naming it.
-- ---------------------------------------------------------------------
select '1 · installed' as step, thing, answer from (
  values
    ('codes table',          case when to_regclass('public.codes') is not null then 'ok' else 'MISSING - run supabase-redeem-codes.sql' end),
    ('code_redemptions',     case when to_regclass('public.code_redemptions') is not null then 'ok' else 'MISSING - run supabase-redeem-codes.sql' end),
    ('redeem_code()',        case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='redeem_code') then 'ok' else 'MISSING - run supabase-redeem-codes.sql' end),
    ('create_codes()',       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_codes') then 'ok' else 'MISSING - run supabase-redeem-codes.sql' end),
    ('generate_license_key()', case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='generate_license_key') then 'ok' else 'MISSING - redeem_code cannot mint a key without it. Run supabase-licenses.sql' end),
    ('has_app_access()',     case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='has_app_access') then 'ok' else 'MISSING - run supabase-purchases.sql' end),
    ('purchases.granted_reason', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='purchases' and column_name='granted_reason') then 'ok' else 'MISSING - redeem_code INSERT fails. Re-run supabase-redeem-codes.sql' end),
    ('purchases.expires_at', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='purchases' and column_name='expires_at') then 'ok' else 'MISSING - redeem_code INSERT fails. Re-run supabase-redeem-codes.sql' end),
    ('stripe_session_id is nullable', coalesce((select case when is_nullable='YES' then 'ok' else 'NOT NULL - a free grant has no Stripe session, so every redeem fails. Re-run supabase-redeem-codes.sql' end
       from information_schema.columns where table_schema='public' and table_name='purchases' and column_name='stripe_session_id'), 'no purchases table'))
) as t(thing, answer);


-- ---------------------------------------------------------------------
--  2 · MAY A SIGNED-IN VISITOR CALL IT
--
--  redeem_code is granted to `authenticated` by the file. If that grant
--  is missing, every redeem fails with permission denied - which the
--  page also reports as "something went wrong on our end".
-- ---------------------------------------------------------------------
select '2 · permission' as step, func, needs_role, answer from (
  select p.proname as func, 'authenticated' as needs_role,
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'ok'
              else 'DENIED - a signed-in visitor cannot call this. Re-run the file that defines it.' end as answer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('redeem_code', 'has_app_access')
  union all
  -- These two are deliberately NOT open to visitors: only the checkout
  -- functions call them, with the service key. authenticated being
  -- denied here is correct and is not the bug.
  select p.proname, 'service_role',
         case when has_function_privilege('service_role', p.oid, 'EXECUTE')
              then 'ok'
              else 'DENIED - discount codes at checkout will fail. Re-run supabase-redeem-codes.sql' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('code_value', 'spend_code')
) t order by needs_role, func;


-- ---------------------------------------------------------------------
--  3 · THE CODES THEMSELVES
--
--  Every code you have made, and whether it would be accepted right
--  now. "usable" means nothing about the code stops it; a person can
--  still be refused for already owning the app or having used it once.
-- ---------------------------------------------------------------------
select '3 · your codes' as step,
       c.code, c.kind, c.apps, c.uses, c.max_uses,
       c.disabled, c.expires_at, c.note,
       case
         when c.disabled                                          then 'NO - switched off'
         when c.expires_at is not null and c.expires_at <= now()  then 'NO - past its date'
         when c.max_uses  is not null and c.uses >= c.max_uses    then 'NO - all used up'
         else 'usable'
       end as usable
from public.codes c
order by c.created_at desc nulls last
limit 50;


-- ---------------------------------------------------------------------
--  4 · DOES THE APP NAME ON THE CODE EXIST
--
--  A code for "Aether" or "aether " or "AFD Gate" matches nothing: the
--  site uses short lowercase ids. This lists any that will never match.
-- ---------------------------------------------------------------------
select '4 · app ids' as step, c.code, a as app_on_code,
       case when a = '*' then 'ok - any app'
            when a in ('performlive','chordlight88','secondout','stemsorter','ambanalog',
                       'alignpro','afdgate','aether','pulseroom','nebulatide2',
                       'nebulatide','harmoniemd') then 'ok'
            else 'NO SUCH APP - this code can never be redeemed' end as answer
from public.codes c, unnest(c.apps) a
where not (a = '*' or a in ('performlive','chordlight88','secondout','stemsorter','ambanalog',
                            'alignpro','afdgate','aether','pulseroom','nebulatide2',
                            'nebulatide','harmoniemd'));


-- ---------------------------------------------------------------------
--  5 · HAS ANYBODY ACTUALLY GOT THROUGH
-- ---------------------------------------------------------------------
select '5 · redemptions' as step, count(*) as redeemed_so_far from public.code_redemptions;

select '5 · granted licences' as step, app, count(*) as licences
from public.purchases where granted_reason like 'code:%'
group by app order by 2 desc;
