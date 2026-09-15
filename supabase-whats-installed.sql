-- =====================================================================
--  WHAT IS INSTALLED, AND WHAT IS NOT
--
--  Paste this into the Supabase SQL editor whenever you are not sure
--  which of the scripts in this folder have been run. It reads the
--  catalog of objects the database already keeps about itself: nothing
--  is changed, nothing is written, and it is safe to run at any time.
--
--  The last column is the answer. Anything reading "NO" means the file
--  in the first column has not been run - or has not been run since it
--  last changed.
--
--  The second result is the one a list of names cannot show: whether
--  product_summary is the version that keeps currencies apart. The one
--  before it summed every purchase together, which reports a GHS 190
--  sale as $190 once Paystack is taking money.
-- =====================================================================

with want(file, thing, kind, name) as (values
  ('supabase-redeem-codes.sql',     'codes table',            'table', 'codes'),
  ('supabase-redeem-codes.sql',     'redemptions table',      'table', 'code_redemptions'),
  ('supabase-redeem-codes.sql',     'redeem_code()',          'func',  'redeem_code'),
  ('supabase-redeem-codes.sql',     'create_codes()',         'func',  'create_codes'),
  ('supabase-redeem-codes.sql',     'code_value()  [phase 2]','func',  'code_value'),
  ('supabase-redeem-codes.sql',     'spend_code()  [phase 2]','func',  'spend_code'),
  ('supabase-product-analytics.sql','app_downloads table',    'table', 'app_downloads'),
  ('supabase-product-analytics.sql','hub_installs table',     'table', 'hub_installs'),
  ('supabase-product-analytics.sql','product_summary()',      'func',  'product_summary'),
  ('supabase-product-analytics.sql','product_codes() [ph 3]', 'func',  'product_codes'),
  ('supabase-product-analytics.sql','purchases.code [ph 3]',  'col',   'purchases.code'),
  ('supabase-update-notices.sql',   'update_notices table',   'table', 'update_notices'),
  ('supabase-update-notices.sql',   'notice_optouts table',   'table', 'notice_optouts'),
  ('supabase-beta-licenses.sql',    'claim_beta_license()',   'func',  'claim_beta_license')
)
select w.file, w.thing,
       case when found then 'yes' else 'NO - run this file' end as installed
from (
  select w.*,
    case w.kind
      when 'table' then exists (select 1 from pg_tables t
                                 where t.schemaname='public' and t.tablename=w.name)
      when 'func'  then exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                 where n.nspname='public' and p.proname=w.name)
      when 'col'   then exists (select 1 from information_schema.columns c
                                 where c.table_schema='public'
                                   and c.table_name=split_part(w.name,'.',1)
                                   and c.column_name=split_part(w.name,'.',2))
    end as found
  from want w
) w
order by w.file, w.thing;

-- And one thing a table cannot show: whether product_summary is the new
-- shape. The old one adds cedis to dollars and reports GHS 190 as $190.
select case
  when not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='public' and p.proname='product_summary')
    then 'product_summary is missing - run supabase-product-analytics.sql'
  when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='product_summary'
                  and 'revenue_other' = any(p.proargnames))
    then 'product_summary is up to date (keeps currencies apart)'
  else 'product_summary is the OLD one - re-run supabase-product-analytics.sql, it is adding cedis to dollars'
end as revenue_check;
