-- M&M Founder Bingo — Supabase Schema
-- Einmal im SQL Editor von Supabase ausführen

-- Completions table
CREATE TABLE completions (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT        NOT NULL,
  generation  TEXT        NOT NULL,
  field_text  TEXT        NOT NULL,
  photo_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security: für die Party offen (kein Login nötig)
ALTER TABLE completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read"   ON completions FOR SELECT USING (true);
CREATE POLICY "anyone can insert" ON completions FOR INSERT WITH CHECK (true);

-- Realtime aktivieren (für den Live Feed)
ALTER PUBLICATION supabase_realtime ADD TABLE completions;
