-- =====================================================================
--  CHORDLIGHT 88 2.0  ·  a key for everyone who has it
--
--  Run in Supabase → SQL Editor. Safe to run again.
--
--  1.x asked for nothing. 2.0 activates with a licence key, one key
--  for two computers, the same way SecondOut and AETHER do. Everyone
--  who bought or was given 1.x already owns 2.0 - the Hub offers the
--  update for free - but a purchase row written before keys were
--  minted for every row may still have none, and a row with no key is
--  an app that asks for one and cannot be told it.
--
--  This mints a key on every Chordlight row that lacks one, makes sure
--  each allows two machines, and lists who has which key, so a person
--  who asks can be answered from here.
-- =====================================================================

update public.purchases
   set license_key = public.generate_license_key(app)
 where app = 'chordlight88' and license_key is null;

update public.purchases
   set max_devices = 2
 where app = 'chordlight88' and coalesce(max_devices, 0) < 2;

-- Who has it, and the key they activate with. The key is shown in
-- My Apps and in the Hub as well; this is for answering a message.
select u.email, p.license_key, p.kind, p.purchased_at::date as since,
       (select count(*) from public.device_activations d
         where d.license_id = p.id and d.revoked_at is null) as machines
  from public.purchases p
  join auth.users u on u.id = p.user_id
 where p.app = 'chordlight88'
 order by p.purchased_at desc;
