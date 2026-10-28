-- M&M Startup Tour Berlin 2026 — Supabase schema
-- Run once in the Supabase SQL Editor.

-- ─── Archive the old M&M party data (renamed, nothing deleted) ───
alter index if exists completions_pkey rename to completions_mm_party_pkey;
alter table if exists completions rename to completions_mm_party;
-- Archive is read-only from the outside now
drop policy if exists "anyone can insert" on completions_mm_party;

-- Old party bucket ("bingo photos"): drop any write policies, photos stay public
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and coalesce(qual, '') || coalesce(with_check, '') like '%bingo photos%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
exception when others then
  raise notice 'Could not clean old bucket policies: %', sqlerrm;
end $$;

-- ─── Config: kickoff locks tasks + check-offs until then (change here to move it) ───
create table config (
  id         int primary key default 1 check (id = 1),
  kickoff_at timestamptz not null
);
insert into config (kickoff_at) values ('2026-10-29 15:00 Europe/Berlin');

-- ─── Tasks (points can be changed live here, no redeploy needed) ───
create table tasks (
  id     text primary key,
  text   text not null,
  points int  not null check (points > 0),
  sort   int  not null default 0
);

insert into tasks (id, text, points, sort) values
  ('pitch_15',        'Do a 60-second elevator pitch about a startup idea in front of at least 15 people', 5, 1),
  ('drinking_game',   'Successfully host a (drinking) game for at least 15 people',                       4, 2),
  ('good_question',   'Ask a question at a visit that makes the moderator say "That''s a good question"', 3, 3),
  ('linkedin_10',     'Make 10 new LinkedIn connections with people based in Berlin',                      3, 4),
  ('on_time',         'Be on time for all company visits (check off at the end)',                          3, 5),
  ('visit_photos',    'Take at least one picture at every company visit (check off at the end)',           3, 6),
  ('merch',           'Convince a random non-MM person to wear MM merch',                                  3, 7),
  ('reonic_question', 'Ask a smart question at the Reonic event',                                          2, 8),
  ('talk_10',         'Do the 10-minute personal-talking challenge with someone',                          2, 9),
  ('pitch_friend',    'Pitch your MM friend to someone who isn''t their friend yet (min. 60 sec)',          2, 10),
  ('pitch_mm',        'Pitch MM to someone outside MM',                                                    2, 11),
  ('shot',            'Invite a stranger to a shot at the club',                                           2, 12),
  ('makeup',          'Help someone who isn''t your friend yet with their Halloween makeup',                2, 13),
  ('reonic_fact',     'Research a fact about Reonic and tell someone who didn''t know it',                 1, 14),
  ('drink',           'Buy a (non-alcoholic) drink for someone who isn''t your friend yet',                1, 15),
  ('series_a',        'Get the number or LinkedIn of a founder who has raised a Series A',                 3, 16),
  ('coffee_munich',   'Get someone at a visit to promise you a coffee in Munich',                          2, 17),
  ('team_logo',       'Team (3+): recreate the logo of a startup you visit with your bodies, in front of their office. Everyone in the photo checks it off', 3, 18),
  ('team_founder',    'Team (3+): get a founder from a visit into your crew selfie. Everyone in the photo checks it off', 3, 19),
  ('team_costume',    'Team (3+): costume group photo with at least one stranger at the party. Everyone in the photo checks it off', 2, 20),
  ('dj_selfie',       'Club: get a selfie with the DJ or someone behind the decks',                       4, 21),
  ('fake_founder',    'Club: convince a stranger you''re a famous Munich founder until they want a selfie with you', 3, 22),
  ('last_standing',   'Club: still be on the dance floor when the lights go on (photo with lights on)',  3, 23),
  ('queue_conga',     'Club queue: start a conga line with at least 5 strangers in the Lokschuppen queue', 3, 24);

-- ─── Agenda (editable live in the Table Editor; times in Berlin time) ───
create table agenda (
  id        serial      primary key,
  starts_at timestamptz not null,
  ends_at   timestamptz,
  title     text        not null,
  note      text
);

insert into agenda (starts_at, ends_at, title, note) values
  ('2026-10-29 09:19 Europe/Berlin', '2026-10-29 13:57 Europe/Berlin', 'Train Munich → Berlin', null),
  ('2026-10-29 14:00 Europe/Berlin', '2026-10-29 15:00 Europe/Berlin', 'HBF → Friedrichshain', null),
  ('2026-10-29 15:00 Europe/Berlin', null,                             'Housing check-in', null),
  ('2026-10-29 16:00 Europe/Berlin', '2026-10-29 17:15 Europe/Berlin', 'Speedinvest visit', null),
  ('2026-10-29 17:30 Europe/Berlin', '2026-10-29 19:00 Europe/Berlin', 'Telli visit', null),
  ('2026-10-29 19:30 Europe/Berlin', '2026-10-29 22:00 Europe/Berlin', 'Reonic visit + dinner & drinks', null),
  ('2026-10-29 22:00 Europe/Berlin', '2026-10-29 23:30 Europe/Berlin', 'Bar', null),
  ('2026-10-30 10:00 Europe/Berlin', '2026-10-30 12:00 Europe/Berlin', 'Knowunity visit', null),
  ('2026-10-30 12:30 Europe/Berlin', '2026-10-30 14:00 Europe/Berlin', 'Lunch: Planet A', null),
  ('2026-10-30 12:30 Europe/Berlin', '2026-10-30 14:00 Europe/Berlin', 'Alternative lunch', null),
  ('2026-10-30 15:00 Europe/Berlin', '2026-10-30 17:15 Europe/Berlin', 'ICEYE + LiveEO + Reflex Aerospace', null),
  ('2026-10-30 18:15 Europe/Berlin', '2026-10-30 21:30 Europe/Berlin', 'Zauber x Lucid Capital visit + dinner & drinks', null),
  ('2026-10-30 21:30 Europe/Berlin', '2026-10-30 23:30 Europe/Berlin', 'Bar', null),
  ('2026-10-31 09:30 Europe/Berlin', '2026-10-31 10:30 Europe/Berlin', 'Sightseeing coffee run', null),
  ('2026-10-31 11:00 Europe/Berlin', '2026-10-31 12:00 Europe/Berlin', 'Breakfast together', null),
  ('2026-10-31 12:30 Europe/Berlin', '2026-10-31 16:00 Europe/Berlin', 'Architecture tour with Desi', null),
  ('2026-10-31 12:30 Europe/Berlin', '2026-10-31 16:00 Europe/Berlin', 'Coworking', null),
  ('2026-10-31 12:30 Europe/Berlin', '2026-10-31 16:00 Europe/Berlin', 'Hackathon GTM', null),
  ('2026-10-31 12:30 Europe/Berlin', '2026-10-31 16:00 Europe/Berlin', 'Underground tour', null),
  ('2026-10-31 16:00 Europe/Berlin', '2026-10-31 18:00 Europe/Berlin', 'Team building', null),
  ('2026-10-31 18:00 Europe/Berlin', '2026-10-31 19:30 Europe/Berlin', 'Costumes on + dinner', null),
  ('2026-10-31 19:30 Europe/Berlin', '2026-10-31 21:00 Europe/Berlin', 'Pre-drinks + makeup', 'Costume pitch'),
  ('2026-10-31 23:00 Europe/Berlin', null,                             'Lokschuppen: Disco', null),
  ('2026-11-01 13:00 Europe/Berlin', '2026-11-01 14:30 Europe/Berlin', 'Train Berlin → Munich', 'Individual');

-- ─── Completions: one row per player and task, photo required ───
create table completions (
  id          uuid        primary key default gen_random_uuid(),
  player_id   uuid        not null,
  player_name text        not null check (char_length(player_name) between 1 and 40),
  task_id     text        not null references tasks(id) on delete cascade,
  -- Photo must live in our bucket, in this player's own folder
  photo_url   text        not null check (photo_url like 'https://%/storage/v1/object/public/bingo-photos/' || player_id::text || '/%'),
  photo_w     int,
  photo_h     int,
  created_at  timestamptz not null default now(),
  unique (player_id, task_id)
);

create index completions_created_at_idx on completions (created_at desc);
create index completions_player_idx     on completions (player_id);

-- ─── Leaderboard: points are summed in the DB, not on the client ───
create view leaderboard with (security_invoker = true) as
select
  c.player_id,
  (array_agg(c.player_name order by c.created_at desc))[1] as player_name,
  sum(t.points)::int  as points,
  count(*)::int       as done,
  max(c.created_at)   as last_at
from completions c
join tasks t on t.id = c.task_id
group by c.player_id;

-- ─── Row Level Security: open read, insert only (orga deletes via dashboard) ───
alter table config      enable row level security;
alter table tasks       enable row level security;
alter table agenda      enable row level security;
alter table completions enable row level security;

create policy "read config"       on config      for select using (true);
-- Tasks stay a surprise: unreadable until kickoff
create policy "read tasks after kickoff" on tasks for select
  using (now() >= (select kickoff_at from config where id = 1));
create policy "read agenda"       on agenda      for select using (true);
create policy "read completions"  on completions for select using (true);
create policy "insert completion after kickoff" on completions for insert
  with check (now() >= (select kickoff_at from config where id = 1));

grant select on leaderboard to anon, authenticated;

-- ─── Realtime (feed + leaderboard) ───
alter publication supabase_realtime add table completions;

-- ─── Photo storage ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bingo-photos', 'bingo-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "upload tour photos" on storage.objects
  for insert to anon, authenticated with check (
    bucket_id = 'bingo-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  );
create policy "read tour photos" on storage.objects
  for select to anon, authenticated using (bucket_id = 'bingo-photos');

-- Originals for printing: private bucket, players can upload but nobody can browse it publicly
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bingo-originals', 'bingo-originals', false, 31457280,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy "upload originals" on storage.objects
  for insert to anon, authenticated with check (
    bucket_id = 'bingo-originals'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  );

-- ─── Orga preview: password lives only here (table has no policies = unreadable from outside) ───
create table if not exists admin_secret (
  id       int  primary key default 1 check (id = 1),
  password text not null
);
alter table admin_secret enable row level security;

create or replace function preview_tasks(pw text) returns setof tasks
language sql stable security definer set search_path = public as $$
  select t.* from tasks t
  where exists (select 1 from admin_secret s where s.password = pw)
  order by t.sort;
$$;
grant execute on function preview_tasks(text) to anon, authenticated;
-- Set the password once in the SQL Editor (not committed):
-- insert into admin_secret (password) values ('...') on conflict (id) do update set password = excluded.password;

-- Task categories (tour / team / club / special) + cleaner texts without prefixes
alter table tasks add column if not exists category text not null default 'tour'
  check (category in ('tour', 'team', 'club', 'special'));

update tasks set category = 'team'    where id in ('team_logo', 'team_founder', 'team_costume', 'drinking_game');
update tasks set category = 'club'    where id in ('dj_selfie', 'last_standing', 'queue_conga', 'shot', 'makeup');
update tasks set category = 'special' where id in ('fake_founder');

update tasks set text = 'Recreate the logo of a startup you visit with your bodies, in front of their office' where id = 'team_logo';
update tasks set text = 'Get a founder from a visit into your crew selfie'                                     where id = 'team_founder';
update tasks set text = 'Costume group photo with at least one stranger at the party'                          where id = 'team_costume';
update tasks set text = 'Get a selfie with the DJ or someone behind the decks'                                 where id = 'dj_selfie';
update tasks set text = 'Convince a stranger you''re a famous Munich founder until they want a selfie with you' where id = 'fake_founder';
update tasks set text = 'Still be on the dance floor when the lights go on (photo with lights on)'            where id = 'last_standing';
update tasks set text = 'Start a conga line with at least 5 strangers in the Lokschuppen queue'                where id = 'queue_conga';

-- Recreate preview function so it returns the new column
create or replace function preview_tasks(pw text) returns setof tasks
language sql stable security definer set search_path = public as $$
  select t.* from tasks t
  where exists (select 1 from admin_secret s where s.password = pw)
  order by t.sort;
$$;

-- Special: speaker shoutout
insert into tasks (id, text, points, sort, category)
values ('shoutout', 'Get a speaker to give you a shoutout during a visit', 5, 25, 'special')
on conflict (id) do update set text = excluded.text, points = excluded.points, category = excluded.category;

-- Spicier specials
update tasks set points = 5 where id = 'fake_founder';
insert into tasks (id, text, points, sort, category) values
  ('iceye_defense', 'At ICEYE, ask the defense question nobody else dares to ask, and get a real answer', 5, 26, 'special'),
  ('real_offer',    'Leave Berlin with a real offer: job, internship or investor intro from someone you met on the tour (screenshot counts)', 10, 27, 'special')
on conflict (id) do update set text = excluded.text, points = excluded.points, category = excluded.category;

-- Rebalance to exactly 100 points (28 tasks)
insert into tasks (id, text, points, sort, category) values
  ('iceye_defense', 'At ICEYE, ask the defense question nobody else dares to ask, and get a real answer', 6, 26, 'special'),
  ('real_offer',    'Leave Berlin with a real offer: job, internship or investor intro from someone you met on the tour (screenshot counts)', 10, 27, 'special'),
  ('win_drinking',  'Win a drinking game', 3, 28, 'club')
on conflict (id) do nothing;

update tasks set text = 'Buy a drink (any kind) for someone who isn''t your friend yet' where id = 'drink';
update tasks set text = 'Start a conga line (Polonaise) with at least 5 strangers in the Lokschuppen queue' where id = 'queue_conga';

update tasks t set points = v.points from (values
  ('real_offer', 10),
  ('fake_founder', 6),
  ('iceye_defense', 6),
  ('shoutout', 6),
  ('dj_selfie', 6),
  ('last_standing', 4),
  ('queue_conga', 4),
  ('win_drinking', 3),
  ('shot', 2),
  ('makeup', 2),
  ('drinking_game', 5),
  ('team_logo', 5),
  ('team_founder', 4),
  ('team_costume', 3),
  ('pitch_15', 6),
  ('good_question', 4),
  ('merch', 4),
  ('series_a', 4),
  ('coffee_munich', 3),
  ('linkedin_10', 1),
  ('on_time', 1),
  ('visit_photos', 1),
  ('reonic_question', 2),
  ('talk_10', 2),
  ('pitch_friend', 2),
  ('pitch_mm', 2),
  ('reonic_fact', 1),
  ('drink', 1)
) as v(id, points) where t.id = v.id;

-- Orga preview may check off before kickoff (password checked here, never in the app code)
create or replace function orga_complete(pw text, p_player_id uuid, p_player_name text, p_task_id text,
                                         p_photo_url text, p_w int, p_h int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_secret s where s.password = pw) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into completions (player_id, player_name, task_id, photo_url, photo_w, photo_h)
  values (p_player_id, p_player_name, p_task_id, p_photo_url, p_w, p_h);
end $$;
grant execute on function orga_complete(text, uuid, text, text, text, int, int) to anon, authenticated;

-- Random snaps: free photos, no points, kept strictly apart from challenge completions
create table if not exists snaps (
  id          uuid        primary key default gen_random_uuid(),
  player_id   uuid        not null,
  player_name text        not null check (char_length(player_name) between 1 and 40),
  caption     text        check (char_length(caption) <= 80),
  photo_url   text        not null check (photo_url like 'https://%/storage/v1/object/public/bingo-photos/' || player_id::text || '/%'),
  photo_w     int,
  photo_h     int,
  created_at  timestamptz not null default now()
);
create index if not exists snaps_created_at_idx on snaps (created_at desc);

alter table snaps enable row level security;
drop policy if exists "read snaps" on snaps;
drop policy if exists "insert snap after kickoff" on snaps;
create policy "read snaps" on snaps for select using (true);
create policy "insert snap after kickoff" on snaps for insert
  with check (now() >= (select kickoff_at from config where id = 1));

alter publication supabase_realtime add table snaps;

create or replace function orga_snap(pw text, p_player_id uuid, p_player_name text, p_caption text,
                                     p_photo_url text, p_w int, p_h int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_secret s where s.password = pw) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into snaps (player_id, player_name, caption, photo_url, photo_w, photo_h)
  values (p_player_id, p_player_name, nullif(p_caption, ''), p_photo_url, p_w, p_h);
end $$;
grant execute on function orga_snap(text, uuid, text, text, text, int, int) to anon, authenticated;

-- Agenda: what each visit is about + Berlin address (shown under the agenda row)
alter table agenda add column if not exists info    text;
alter table agenda add column if not exists tags    text[];
alter table agenda add column if not exists address text;

update agenda set info = 'European early-stage VC, backs startups from pre-seed to Series A.',
  tags = array['VC', 'early stage', 'Europe'], address = 'Schwedter Str. 263, 10119 Berlin' where title = 'Speedinvest visit';
update agenda set info = 'Berlin startup whose AI voice agents make and take phone calls for companies.',
  tags = array['AI voice agents', 'founded 2024'], address = 'Knaackstraße 78, 10435 Berlin' where title = 'Telli visit';
update agenda set info = 'Software that helps solar and heat pump installers plan, quote and sell faster.',
  tags = array['GreenTech', 'SaaS', 'solar & heat pumps'], address = 'Rosenstraße 16, 10178 Berlin' where title = 'Reonic visit + dinner & drinks';
update agenda set info = 'Learning app where students share study notes and get AI help for school.',
  tags = array['EdTech', 'learning app', 'AI'], address = 'Julie-Wolfthorn-Straße 1, 10115 Berlin' where title = 'Knowunity visit';
update agenda set info = 'Berlin VC investing in startups that fight climate change.',
  tags = array['climate VC', 'Planet A Ventures'], address = 'Neue Schönhauser Str. 16, 10178 Berlin' where title = 'Lunch: Planet A';
update agenda set info = 'ICEYE: radar satellites that see Earth day and night, through clouds. LiveEO: satellite + AI monitoring of railways, pipelines and power lines. Reflex Aerospace: builds small satellites faster and cheaper.',
  tags = array['SAR satellites', 'defense', 'Earth observation', 'NewSpace'] where title = 'ICEYE + LiveEO + Reflex Aerospace';
update agenda set info = 'Lucid Capital: Berlin VC that backs AI founders at the very start (€36m inception fund). Zauber: AI agents for global logistics.',
  tags = array['VC', 'AI', 'inception fund'], address = 'Neue Schönhauser Straße 2, 10178 Berlin' where title = 'Zauber x Lucid Capital visit + dinner & drinks';
