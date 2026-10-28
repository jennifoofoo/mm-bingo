# M&M Startup Tour Berlin 2026

## Setup in 5 Schritten

### 1. Supabase Projekt anlegen
- Geh auf supabase.com → New Project
- Namen: `mm-bingo`, Region: Frankfurt (eu-central-1)
- Passwort notieren (brauchst du nicht in der App, nur intern)

### 2. Datenbank + Storage einrichten
- In Supabase: SQL Editor → New Query
- Inhalt von `schema.sql` reinkopieren → Run
- Legt Tasks, Completions, Leaderboard-View, Realtime, den Bucket `bingo-photos` und die Upload-Policies an
- Alte Party-Daten werden nach `completions_mm_party` archiviert, nicht gelöscht

### 3. Punkte ändern
- Table Editor → `tasks` → `points` anpassen, wirkt sofort ohne Deploy
- Schummel-Einträge: Table Editor → `completions` → Zeile löschen, Leaderboard aktualisiert sich live

### 4. Credentials eintragen
- In Supabase: Settings → API
- `Project URL` und `anon public` Key kopieren
- In `supabase-config.js` eintragen:

```js
const SUPABASE_URL      = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...';
```

### 5. Auf Vercel deployen
- vercel.com → New Project → Import Git Repository
- Oder einfach: `npx vercel` im `mm-bingo/` Ordner ausführen
- URL an alle Teilnehmer schicken

---

## Lokales Testen (ohne Supabase)
Einfach `index.html` im Browser öffnen. Alles funktioniert lokal —
nur der Live Feed und die Foto-Uploads gehen ohne Supabase nicht.

Die Bingo-Karte + Fortschritt wird in localStorage gespeichert.

---

## Beamer
`https://mm-bingo.vercel.app/?display=true` zeigt Leaderboard + Live-Feed.
