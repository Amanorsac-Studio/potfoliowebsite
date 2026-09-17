-- =====================================================================
--  WHY ARE THE CODES NOT WORKING
--
--  Paste the whole thing into Supabase → SQL Editor → Run.
--  It reads only. It changes nothing. Safe to run any time.
--
--  ONE query on purpose. The SQL editor only ever shows you the result
--  of the LAST statement in a script, so a file made of five separate
--  selects runs all five and shows you one - which looks exactly like
--  nothing happening. Everything below arrives in a single table.
--
--  Read the ANSWER column. Anything that is not "ok" is the problem,
--  and the rows are ordered so the most fundamental come first.
-- =====================================================================
with

-- 1 ── is the machinery installed --------------------------------------
fn as (
  select p.proname::text as name, p.oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
col as (
  select column_name::text as name, is_nullable::text as nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'purchases'
),
installed as (
  select '1 · installed' as section, t.thing, t.answer from (values
    ('redeem_code()',
     case when exists (select 1 from fn where name='redeem_code') then 'ok'
          else 'MISSING — run supabase-redeem-codes.sql' end),
    ('create_codes()',
     case when exists (select 1 from fn where name='create_codes') then 'ok'
          else 'MISSING — run supabase-redeem-codes.sql' end),
    ('generate_license_key()',
     case when exists (select 1 from fn where name='generate_license_key') then 'ok'
          else 'MISSING — redeem_code cannot mint a key, so every redeem fails. Run supabase-licenses.sql' end),
    ('has_app_access()',
     case when exists (select 1 from fn where name='has_app_access') then 'ok'
          else 'MISSING — run supabase-purchases.sql' end),
    ('purchases.granted_reason',
     case when exists (select 1 from col where name='granted_reason') then 'ok'
          else 'MISSING — the INSERT inside redeem_code fails. Re-run supabase-redeem-codes.sql' end),
    ('purchases.expires_at',
     case when exists (select 1 from col where name='expires_at') then 'ok'
          else 'MISSING — the INSERT inside redeem_code fails. Re-run supabase-redeem-codes.sql' end),
    ('purchases.stripe_session_id nullable',
     coalesce((select case when nullable='YES' then 'ok'
                           else 'NOT NULL — a free grant has no Stripe session, so EVERY redeem fails. Re-run supabase-redeem-codes.sql' end
               from col where name='stripe_session_id'), 'no purchases table at all'))
  ) as t(thing, answer)
),

-- 2 ── may a signed-in visitor call it ---------------------------------
perms as (
  select '2 · permission' as section,
         f.name || '  (needs: authenticated)' as thing,
         case when has_function_privilege('authenticated', f.oid, 'EXECUTE') then 'ok'
              else 'DENIED — nobody can redeem. Re-run supabase-redeem-codes.sql' end as answer
  from fn f where f.name in ('redeem_code','has_app_access')
  union all
  -- These two are deliberately closed to visitors; only the checkout
  -- functions call them with the service key. Denied here is correct.
  select '2 · permission',
         f.name || '  (needs: service_role)',
         case when has_function_privilege('service_role', f.oid, 'EXECUTE') then 'ok'
              else 'DENIED — discount codes at checkout fail. Re-run supabase-redeem-codes.sql' end
  from fn f where f.name in ('code_value','spend_code')
),

-- 3 ── every code you have made, and whether anything blocks it --------
codes as (
  select '3 · your codes' as section,
         c.code || '  ·  ' || c.kind || '  ·  ' || array_to_string(c.apps, ', ')
           || '  ·  used ' || c.uses || ' of ' || coalesce(c.max_uses::text, 'unlimited')
           || coalesce('  ·  ' || c.note, '') as thing,
         case
           when c.disabled                                         then 'NO — switched off'
           when c.expires_at is not null and c.expires_at <= now() then 'NO — past its date (' || c.expires_at::date || ')'
           when c.max_uses is not null and c.uses >= c.max_uses    then 'NO — all used up'
           -- A code naming an app that does not exist is dead whatever
           -- else is true of it, so this must not report "ok" and leave
           -- section 4 to contradict it further down the table.
           when exists (
             select 1 from unnest(c.apps) a
             where a <> '*' and a not in
               ('performlive','chordlight88','secondout','stemsorter','ambanalog',
                'alignpro','afdgate','aether','pulseroom','nebulatide2',
                'nebulatide','harmoniemd'))                        then 'NO — names an app that does not exist, see section 4'
           else 'ok — nothing about this code stops it'
         end as answer
  from public.codes c
),

-- 4 ── a code naming an app id that does not exist can never work ------
ids as (
  select '4 · app ids' as section,
         c.code || '  is for  "' || a || '"' as thing,
         'NO SUCH APP — this code can never be redeemed. The ids are lowercase: performlive, chordlight88, secondout, ambanalog, alignpro, afdgate, aether, pulseroom, nebulatide2, nebulatide' as answer
  from public.codes c, unnest(c.apps) a
  where a <> '*'
    and a not in ('performlive','chordlight88','secondout','stemsorter','ambanalog',
                  'alignpro','afdgate','aether','pulseroom','nebulatide2',
                  'nebulatide','harmoniemd')
),

-- 5 ── has anybody actually got through --------------------------------
totals as (
  select '5 · so far' as section, 'codes made' as thing, count(*)::text as answer from public.codes
  union all
  select '5 · so far', 'codes redeemed', count(*)::text from public.code_redemptions
  union all
  select '5 · so far', 'licences granted by a code',
         count(*)::text from public.purchases where granted_reason like 'code:%'
  union all
  select '5 · so far', 'accounts on the site', count(*)::text from auth.users
),

everything as (
  select * from installed
  union all select * from perms
  union all select * from codes
  union all select * from ids
  union all select * from totals
)
select section, thing, answer from everything order by section, thing;
