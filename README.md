# M&M Founder Bingo

## Setup in 5 Schritten

### 1. Supabase Projekt anlegen
- Geh auf supabase.com → New Project
- Namen: `mm-bingo`, Region: Frankfurt (eu-central-1)
- Passwort notieren (brauchst du nicht in der App, nur intern)

### 2. Datenbank einrichten
- In Supabase: SQL Editor → New Query
- Inhalt von `schema.sql` reinkopieren → Run

### 3. Photo Storage einrichten
- In Supabase: Storage → New Bucket
- Name: `bingo-photos`
- ✅ Public bucket aktivieren
- Bucket öffnen → Policies → "Allow public access for all" aktivieren

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

## Generationen-Logik
| Auswahl | Wer |
|---|---|
| G45 | Newest cohort — G45 |
| G42–44 | Aktuelle Members |
| Alumni | G41 und älter |

Cross-Gen Felder (rot markiert) erfordern ein Foto mit einer Person
aus einer anderen Generation — das ist der ganze Witz.
