-- =====================================================================
--  THE STORE
--  Run in Supabase → SQL Editor → New query → Run. Safe to re-run.
--
--  One song can exist in several versions: the artist's own, and
--  arrangements or medleys other creators upload. Every version is ten
--  tracks in fixed slots, a list of sections, two prices (rent for
--  fourteen days, or buy), and a status that says whether the studio
--  has approved it yet.
--
--  WHO CAN DO WHAT
--    anyone         read the shelf: approved and coming-soon versions,
--                   approved creators, sections of approved versions
--    signed in      apply to be a creator; read their own purchases
--    a creator      make, edit and submit their own versions; read
--                   their own tracks and sales
--    the studio     everything, and the two review functions
--    the Worker     writes tracks (service key) after an upload
--    the webhook    writes purchases (service key) after a payment
-- =====================================================================

-- ---------------------------------------------------------------------
--  0 · clear earlier signatures so the shapes below can change
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_store_creator','my_creator','has_version_access','store_library',
                        'submit_version','review_version','approve_creator','decline_application',
                        'record_store_sale','creator_sales','store_applications_pending')
  loop execute 'drop function if exists ' || f.sig; end loop;
end $$;


-- =====================================================================
--  1 · CREATORS AND APPLICATIONS
-- =====================================================================

create table if not exists public.store_creators (
  slug         text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  user_id      uuid unique references public.profiles(id) on delete set null,
  name         text not null,
  kind         text not null default 'creator' check (kind in ('artist','creator')),
  country      text,
  flag         text,
  youtube      text,
  links        jsonb not null default '[]',
  bio          text,
  approved_at  timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.store_creators enable row level security;

drop policy if exists creators_public on public.store_creators;
create policy creators_public on public.store_creators
  for select to anon, authenticated
  using (approved_at is not null or user_id = auth.uid() or (select public.is_admin()));

drop policy if exists creators_own_edit on public.store_creators;
create policy creators_own_edit on public.store_creators
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists creators_admin on public.store_creators;
create policy creators_admin on public.store_creators
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select on public.store_creators to anon, authenticated;
grant update on public.store_creators to authenticated;
grant all on public.store_creators to service_role;

-- Is the caller an approved creator, and which one.
create or replace function public.my_creator()
returns public.store_creators
language sql security definer stable set search_path = '' as $$
  select c from public.store_creators c
  where c.user_id = auth.uid() and c.approved_at is not null limit 1;
$$;
grant execute on function public.my_creator() to authenticated;

create or replace function public.is_store_creator()
returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.store_creators
                 where user_id = auth.uid() and approved_at is not null);
$$;
grant execute on function public.is_store_creator() to authenticated;


create table if not exists public.creator_applications (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  brand        text,
  email        text not null,
  country      text,
  links        text,
  lanes        text[] not null default '{}',
  rights       text,
  message      text,
  status       text not null default 'pending' check (status in ('pending','approved','declined')),
  note         text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index if not exists creator_applications_status_idx on public.creator_applications (status, created_at);
alter table public.creator_applications enable row level security;

drop policy if exists applications_own on public.creator_applications;
create policy applications_own on public.creator_applications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists applications_insert on public.creator_applications;
create policy applications_insert on public.creator_applications
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists applications_admin on public.creator_applications;
create policy applications_admin on public.creator_applications
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert on public.creator_applications to authenticated;
grant usage, select on sequence public.creator_applications_id_seq to authenticated;
grant all on public.creator_applications to service_role;

-- The studio lets someone in. Makes the creator row, marks the
-- application, and the person's next visit to the dashboard opens.
create or replace function public.approve_creator(p_application bigint, p_slug text, p_kind text default 'creator')
returns public.store_creators
language plpgsql security definer set search_path = '' as $$
declare a public.creator_applications; c public.store_creators;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into a from public.creator_applications where id = p_application;
  if a.id is null then raise exception 'no such application'; end if;
  insert into public.store_creators (slug, user_id, name, kind, country, approved_at)
  values (lower(p_slug), a.user_id, coalesce(nullif(a.brand,''), a.name), p_kind, a.country, now())
  on conflict (slug) do update
    set user_id = excluded.user_id, approved_at = coalesce(public.store_creators.approved_at, now())
  returning * into c;
  update public.creator_applications
    set status = 'approved', decided_at = now() where id = p_application;
  return c;
end $$;
grant execute on function public.approve_creator(bigint, text, text) to authenticated;

create or replace function public.decline_application(p_application bigint, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.creator_applications
    set status = 'declined', note = p_note, decided_at = now() where id = p_application;
end $$;
grant execute on function public.decline_application(bigint, text) to authenticated;


-- =====================================================================
--  2 · SONGS, VERSIONS, TRACKS, SECTIONS
-- =====================================================================

-- A song is a title. It is what search finds once, however many
-- versions of it are on the shelf.
create table if not exists public.store_songs (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  writers      text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.store_songs enable row level security;
drop policy if exists songs_public on public.store_songs;
create policy songs_public on public.store_songs for select to anon, authenticated using (true);
drop policy if exists songs_creator_insert on public.store_songs;
create policy songs_creator_insert on public.store_songs
  for insert to authenticated with check (created_by = auth.uid() and (select public.is_store_creator()));
drop policy if exists songs_admin on public.store_songs;
create policy songs_admin on public.store_songs
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.store_songs to anon, authenticated;
grant insert on public.store_songs to authenticated;
grant all on public.store_songs to service_role;

-- The ten slots, in the order PerformLive lays them out.
create or replace function public.store_track_slots()
returns text[] language sql immutable as $$
  select array['click','guide','drums','bass','keys','guitars','piano','aux_piano','horns','vocals'];
$$;
grant execute on function public.store_track_slots() to anon, authenticated;

create table if not exists public.store_versions (
  id             uuid primary key default gen_random_uuid(),
  song_id        uuid not null references public.store_songs(id) on delete cascade,
  creator_slug   text not null references public.store_creators(slug) on delete cascade,
  kind           text not null default 'song' check (kind in ('song','pack')),
  label          text not null default 'Original',        -- Original · Arrangement · Medley · Live
  is_original    boolean not null default false,
  lane           text not null default 'songs',
  key            text,
  bpm            numeric(6,2),
  time_sig       text default '4/4',
  length_seconds int,
  year           int,
  album          text,
  feat           text,
  youtube        text,                                     -- the video id
  art_key        text,                                     -- R2 key of the cover
  rent_cents     int not null default 400,
  buy_cents      int not null default 1200,
  currency       text not null default 'usd',
  status         text not null default 'draft'
                 check (status in ('draft','submitted','approved','rejected','coming_soon','hidden')),
  review_note    text,
  consent        text,                                     -- how the rights are cleared, in the creator's words
  sales          int not null default 0,
  submitted_at   timestamptz,
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists store_versions_song_idx    on public.store_versions (song_id);
create index if not exists store_versions_creator_idx on public.store_versions (creator_slug, status);
create index if not exists store_versions_status_idx  on public.store_versions (status, approved_at desc);
alter table public.store_versions enable row level security;

-- Does the caller own this creator slug.
create or replace function public.owns_creator(p_slug text)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.store_creators
                 where slug = p_slug and user_id = auth.uid() and approved_at is not null);
$$;
grant execute on function public.owns_creator(text) to authenticated;

drop policy if exists versions_public on public.store_versions;
create policy versions_public on public.store_versions
  for select to anon, authenticated
  using (status in ('approved','coming_soon')
         or (select public.owns_creator(creator_slug))
         or (select public.is_admin()));

drop policy if exists versions_creator_write on public.store_versions;
create policy versions_creator_write on public.store_versions
  for insert to authenticated
  with check ((select public.owns_creator(creator_slug)) and status = 'draft');

drop policy if exists versions_creator_edit on public.store_versions;
create policy versions_creator_edit on public.store_versions
  for update to authenticated
  using ((select public.owns_creator(creator_slug)) and status in ('draft','rejected'))
  with check ((select public.owns_creator(creator_slug)) and status in ('draft','rejected'));

drop policy if exists versions_creator_delete on public.store_versions;
create policy versions_creator_delete on public.store_versions
  for delete to authenticated
  using ((select public.owns_creator(creator_slug)) and status in ('draft','rejected'));

drop policy if exists versions_admin on public.store_versions;
create policy versions_admin on public.store_versions
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

grant select on public.store_versions to anon, authenticated;
grant insert, update, delete on public.store_versions to authenticated;
grant all on public.store_versions to service_role;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists store_versions_touch on public.store_versions;
create trigger store_versions_touch before update on public.store_versions
  for each row execute function public.touch_updated_at();


-- One row per uploaded file. Written by the Worker with the service
-- key once R2 has the bytes; the creator can read their own, the
-- public reads none - the Worker hands files out by ticket.
create table if not exists public.store_tracks (
  id              bigserial primary key,
  version_id      uuid not null references public.store_versions(id) on delete cascade,
  slot            text not null,
  r2_key          text not null,
  bytes           bigint not null,
  etag            text,
  sample_rate     int,
  channels        int,
  duration_seconds numeric(9,3),
  uploaded_at     timestamptz not null default now(),
  unique (version_id, slot)
);
alter table public.store_tracks enable row level security;
drop policy if exists tracks_creator on public.store_tracks;
create policy tracks_creator on public.store_tracks
  for select to authenticated
  using (exists (select 1 from public.store_versions v
                 where v.id = version_id and (select public.owns_creator(v.creator_slug)))
         or (select public.is_admin()));
drop policy if exists tracks_creator_delete on public.store_tracks;
create policy tracks_creator_delete on public.store_tracks
  for delete to authenticated
  using (exists (select 1 from public.store_versions v
                 where v.id = version_id and v.status in ('draft','rejected')
                   and (select public.owns_creator(v.creator_slug))));
grant select, delete on public.store_tracks to authenticated;
grant all on public.store_tracks to service_role;
grant usage, select on sequence public.store_tracks_id_seq to service_role;


-- Verse, chorus, bridge - where they start, in seconds and in bars.
create table if not exists public.store_sections (
  id          bigserial primary key,
  version_id  uuid not null references public.store_versions(id) on delete cascade,
  position    int not null,
  name        text not null,
  seconds     numeric(9,3) not null,
  bar         int,
  unique (version_id, position)
);
alter table public.store_sections enable row level security;
drop policy if exists sections_public on public.store_sections;
create policy sections_public on public.store_sections
  for select to anon, authenticated
  using (exists (select 1 from public.store_versions v where v.id = version_id
                   and (v.status in ('approved','coming_soon')
                        or (select public.owns_creator(v.creator_slug))
                        or (select public.is_admin()))));
drop policy if exists sections_creator on public.store_sections;
create policy sections_creator on public.store_sections
  for all to authenticated
  using (exists (select 1 from public.store_versions v where v.id = version_id
                   and v.status in ('draft','rejected') and (select public.owns_creator(v.creator_slug)))
         or (select public.is_admin()))
  with check (exists (select 1 from public.store_versions v where v.id = version_id
                   and v.status in ('draft','rejected') and (select public.owns_creator(v.creator_slug)))
         or (select public.is_admin()));
grant select, insert, update, delete on public.store_sections to authenticated;
grant select on public.store_sections to anon;
grant usage, select on sequence public.store_sections_id_seq to authenticated;
grant all on public.store_sections to service_role;


-- What the pages read. One row per version with the song and the
-- maker folded in; only what is public.
create or replace view public.store_shelf as
  select v.id, v.song_id, s.slug as song_slug, s.title, s.writers,
         v.creator_slug, c.name as creator_name, c.kind as creator_kind, c.flag, c.country, c.youtube as creator_youtube,
         v.kind, v.label, v.is_original, v.lane, v.key, v.bpm, v.time_sig, v.length_seconds,
         v.year, v.album, v.feat, v.youtube, v.art_key,
         v.rent_cents, v.buy_cents, v.currency, v.status, v.sales, v.approved_at, v.created_at
  from public.store_versions v
  join public.store_songs s on s.id = v.song_id
  join public.store_creators c on c.slug = v.creator_slug
  where v.status in ('approved','coming_soon') and c.approved_at is not null;
grant select on public.store_shelf to anon, authenticated;


-- =====================================================================
--  3 · SUBMIT AND REVIEW
-- =====================================================================

-- The creator says "this one is ready". Refused until the tracks that
-- every song needs are in, so the queue never holds something the
-- studio cannot listen to.
create or replace function public.submit_version(p_version uuid)
returns public.store_versions
language plpgsql security definer set search_path = '' as $$
declare v public.store_versions; missing text[];
begin
  select * into v from public.store_versions where id = p_version;
  if v.id is null or not public.owns_creator(v.creator_slug) then raise exception 'not yours'; end if;
  if v.status not in ('draft','rejected') then raise exception 'already submitted'; end if;
  if v.kind = 'song' then
    -- click and guide for the band's ears, and the core of the music.
    -- guitars, piano, aux piano, horns and vocals may be empty: not
    -- every song has them. Sections are not required here: the studio
    -- marks and checks them in review, against the audio.
    select array_agg(s) into missing from unnest(array['click','guide','drums','bass','keys']) s
      where not exists (select 1 from public.store_tracks t where t.version_id = v.id and t.slot = s);
    if missing is not null then raise exception 'tracks missing: %', array_to_string(missing, ', '); end if;
    if v.bpm is null or v.key is null then raise exception 'key and tempo are needed'; end if;
  end if;
  update public.store_versions
    set status = 'submitted', submitted_at = now(), review_note = null
    where id = v.id returning * into v;
  return v;
end $$;
grant execute on function public.submit_version(uuid) to authenticated;

-- The studio's answer. 'approved' puts it on the shelf; 'rejected'
-- sends it back with a note the creator sees on their dashboard.
create or replace function public.review_version(p_version uuid, p_decision text, p_note text default null)
returns public.store_versions
language plpgsql security definer set search_path = '' as $$
declare v public.store_versions;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_decision not in ('approved','rejected','hidden','coming_soon') then raise exception 'bad decision'; end if;
  update public.store_versions
    set status = p_decision, review_note = p_note,
        approved_at = case when p_decision = 'approved' then now() else approved_at end
    where id = p_version returning * into v;
  return v;
end $$;
grant execute on function public.review_version(uuid, text, text) to authenticated;


-- =====================================================================
--  4 · PURCHASES: RENT FOR FOURTEEN DAYS, OR BUY
-- =====================================================================

create table if not exists public.store_purchases (
  id                 bigserial primary key,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  version_id         uuid not null references public.store_versions(id) on delete cascade,
  kind               text not null check (kind in ('rent','buy')),
  amount_cents       int not null,
  currency           text not null default 'usd',
  stripe_session_id  text unique,
  paystack_ref       text unique,
  granted_reason     text,                         -- set when the studio gave it away
  purchased_at       timestamptz not null default now(),
  expires_at         timestamptz                   -- rentals only
);
create index if not exists store_purchases_user_idx on public.store_purchases (user_id, version_id);
alter table public.store_purchases enable row level security;
drop policy if exists store_purchases_own on public.store_purchases;
create policy store_purchases_own on public.store_purchases
  for select to authenticated using (user_id = auth.uid());
drop policy if exists store_purchases_admin on public.store_purchases;
create policy store_purchases_admin on public.store_purchases
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.store_purchases to authenticated;
grant all on public.store_purchases to service_role;
grant usage, select on sequence public.store_purchases_id_seq to service_role;

-- Does the caller have this version right now. Bought: always. Rented:
-- until the date. The creator of it and the studio: yes, so they can
-- open their own work in PerformLive to check it.
create or replace function public.has_version_access(p_version uuid)
returns boolean
language sql security definer stable set search_path = '' as $$
  select public.is_admin()
      or exists (select 1 from public.store_versions v
                 where v.id = p_version and public.owns_creator(v.creator_slug))
      or exists (select 1 from public.store_purchases p
                 where p.user_id = auth.uid() and p.version_id = p_version
                   and (p.kind = 'buy' or p.expires_at > now()));
$$;
grant execute on function public.has_version_access(uuid) to authenticated;

-- Everything the caller can open, with the rental clock where there is one.
create or replace function public.store_library()
returns table (version_id uuid, kind text, expires_at timestamptz, purchased_at timestamptz,
               title text, creator_name text, creator_slug text, label text, song_slug text,
               art_key text, lane text, version_kind text)
language sql security definer stable set search_path = '' as $$
  select p.version_id, p.kind, p.expires_at, p.purchased_at,
         s.title, c.name, c.slug, v.label, s.slug, v.art_key, v.lane, v.kind
  from public.store_purchases p
  join public.store_versions v on v.id = p.version_id
  join public.store_songs s on s.id = v.song_id
  join public.store_creators c on c.slug = v.creator_slug
  where p.user_id = auth.uid()
  order by p.purchased_at desc;
$$;
grant execute on function public.store_library() to authenticated;

-- Called by the webhook (service key) once money has arrived. A retry
-- of the same session is a no-op thanks to the unique column.
create or replace function public.record_store_sale(p_user uuid, p_version uuid, p_kind text,
                                                    p_amount int, p_currency text, p_session text)
returns void
language plpgsql security definer set search_path = '' as $$
declare inserted bigint;
begin
  insert into public.store_purchases (user_id, version_id, kind, amount_cents, currency, stripe_session_id, expires_at)
  values (p_user, p_version, p_kind, p_amount, coalesce(p_currency,'usd'), p_session,
          case when p_kind = 'rent' then now() + interval '14 days' else null end)
  on conflict (stripe_session_id) do nothing
  returning id into inserted;
  -- a retried delivery of the same session must not count twice
  if inserted is not null then
    update public.store_versions set sales = sales + 1 where id = p_version;
  end if;
end $$;
revoke all on function public.record_store_sale(uuid, uuid, text, int, text, text) from public, anon, authenticated;
grant execute on function public.record_store_sale(uuid, uuid, text, int, text, text) to service_role;

-- What a creator sees on their dashboard: their sales, by version.
create or replace function public.creator_sales(p_days int default 30)
returns table (version_id uuid, title text, label text, sales bigint, gross_cents bigint, last_sale timestamptz)
language sql security definer stable set search_path = '' as $$
  select v.id, s.title, v.label, count(p.id), coalesce(sum(p.amount_cents),0), max(p.purchased_at)
  from public.store_versions v
  join public.store_songs s on s.id = v.song_id
  left join public.store_purchases p on p.version_id = v.id
       and p.purchased_at > now() - make_interval(days => p_days)
  where public.owns_creator(v.creator_slug)
  group by v.id, s.title, v.label
  order by count(p.id) desc, s.title;
$$;
grant execute on function public.creator_sales(int) to authenticated;


-- =====================================================================
--  5 · THE THREE ARTISTS, COMING SOON
--  Their songs go on the shelf marked coming soon, with no account
--  behind them yet. When an artist joins, approve_creator with the
--  same slug attaches their account to these rows.
-- =====================================================================

insert into public.store_creators (slug, name, kind, country, flag, youtube, approved_at) values
  ('kingsley-anyenor', 'Kingsley Anyenor', 'artist', 'Ghana', '🇬🇭', 'https://www.youtube.com/channel/UCkjUIJjNjY6sa2VYT1ZumGw', now()),
  ('vivi-adjei',       'Vivi Adjei',       'artist', 'Ghana', '🇬🇭', 'https://www.youtube.com/@viviadjei', now()),
  ('isaac-narh',       'Isaac Narh',       'artist', 'Ghana', '🇬🇭', 'https://www.youtube.com/@isaacnarhofficial', now())
on conflict (slug) do nothing;

-- title, slug, artist, album, year, feat, live, youtube id
with songs (title, slug, artist, album, yr, feat, live, yt) as (values
  ('Praise The Lord',                      'kingsley-anyenor-praise-the-lord',           'kingsley-anyenor', null, 2026, null, false, null),
  ('Deeper Worship, Vol. 1',               'kingsley-anyenor-deeper-worship-vol-1',      'kingsley-anyenor', 'Deeper Worship, Vol. 1', 2025, null, false, 'b2L8O7DAJtA'),
  ('Deeper Worship, Vol. 2',               'kingsley-anyenor-deeper-worship-vol-2',      'kingsley-anyenor', 'Deeper Worship, Vol. 2', 2025, null, false, null),
  ('Deeper Worship 3.0 (Live)',            'kingsley-anyenor-deeper-worship-3',          'kingsley-anyenor', null, 2026, null, true,  '7xkyTCStRhs'),
  ('Deeper Worship 4.0',                   'kingsley-anyenor-deeper-worship-4',          'kingsley-anyenor', null, 2026, null, false, 'HRBRCWdqH9s'),
  ('Holy (Live)',                          'kingsley-anyenor-holy-live',                 'kingsley-anyenor', 'Holy (Live) - EP', 2026, 'Philip Adzale', true, null),
  ('Obotantim Nyame (Live)',               'kingsley-anyenor-obotantim-nyame',           'kingsley-anyenor', null, 2025, null, true,  null),
  ('God of Israel',                        'kingsley-anyenor-god-of-israel',             'kingsley-anyenor', null, 2024, null, false, '8UkWMnzuKZg'),
  ('Ghana Praise Medley',                  'kingsley-anyenor-ghana-praise-medley',       'kingsley-anyenor', null, 2024, null, false, null),
  ('Your Spirit (Live)',                   'kingsley-anyenor-your-spirit',               'kingsley-anyenor', 'The Great Revival', 2025, null, true, 'EcI7B8Es45k'),
  ('Spirit Medley (Local Medley)',         'kingsley-anyenor-spirit-medley',             'kingsley-anyenor', 'Spirit Medley - EP', 2023, null, false, null),
  ('Nipa Nyinaa Rehwehwɛ Wo',              'kingsley-anyenor-nipa-nyinaa',               'kingsley-anyenor', null, 2025, null, false, null),
  ('Be Lifted High',                       'kingsley-anyenor-be-lifted-high',            'kingsley-anyenor', null, 2024, null, false, null),
  ('Maranatha',                            'kingsley-anyenor-maranatha',                 'kingsley-anyenor', null, 2025, 'Vivi Adjei', false, null),
  ('Pentecost',                            'kingsley-anyenor-pentecost',                 'kingsley-anyenor', null, 2025, 'Siisi Baidoo', false, null),
  ('Holy Is The Lord',                     'kingsley-anyenor-holy-is-the-lord',          'kingsley-anyenor', null, 2025, 'Kwaku Kwame', false, null),
  ('Fire Medley',                          'vivi-adjei-fire-medley',                     'vivi-adjei', 'Fire Medley - EP', 2025, null, false, null),
  ('The Prevailing Travail (Yahweh Medley)','vivi-adjei-the-prevailing-travail',         'vivi-adjei', null, 2024, null, false, null),
  ('Sounds of Resilience',                 'vivi-adjei-sounds-of-resilience',            'vivi-adjei', null, 2024, null, true, 'R7g2Z68qssA'),
  ('Intense Ghana Thanksgiving Medley',    'isaac-narh-intense-ghana-thanksgiving-medley','isaac-narh', null, 2025, null, true, null),
  ('Kavod',                                'isaac-narh-kavod',                           'isaac-narh', null, 2025, null, false, null)
), made as (
  insert into public.store_songs (slug, title)
  select slug, title from songs
  on conflict (slug) do update set title = excluded.title
  returning id, slug
)
insert into public.store_versions (song_id, creator_slug, label, is_original, album, year, feat, youtube, status, approved_at)
select m.id, s.artist, case when s.live then 'Live' else 'Original' end, true, s.album, s.yr, s.feat, s.yt, 'coming_soon', now()
from made m join songs s on s.slug = m.slug
where not exists (select 1 from public.store_versions v where v.song_id = m.id and v.creator_slug = s.artist);
