-- M&M Startup Tour Berlin 2026 — Supabase schema
-- Run once in the Supabase SQL Editor.

-- ─── Archive the old M&M party data (renamed, nothing deleted) ───
alter index if exists completions_pkey rename to completions_mm_party_pkey;
alter table if exists completions rename to completions_mm_party;

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
  ('drink',           'Buy a (non-alcoholic) drink for someone who isn''t your friend yet',                1, 15);

-- ─── Completions: one row per player and task, photo required ───
create table completions (
  id          uuid        primary key default gen_random_uuid(),
  player_id   uuid        not null,
  player_name text        not null check (char_length(player_name) between 1 and 40),
  task_id     text        not null references tasks(id) on delete cascade,
  photo_url   text        not null check (photo_url like 'https://%'),
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
alter table tasks       enable row level security;
alter table completions enable row level security;

create policy "read tasks"        on tasks       for select using (true);
create policy "read completions"  on completions for select using (true);
create policy "insert completion" on completions for insert with check (true);

grant select on leaderboard to anon, authenticated;

-- ─── Realtime (feed + leaderboard) ───
alter publication supabase_realtime add table completions;

-- ─── Photo storage ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bingo-photos', 'bingo-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "upload tour photos" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'bingo-photos');
create policy "read tour photos" on storage.objects
  for select to anon, authenticated using (bucket_id = 'bingo-photos');
