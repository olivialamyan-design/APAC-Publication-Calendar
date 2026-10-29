# Savills APAC Research — Publication Calendar

An internal, desktop-first publication calendar and planning platform for Savills
APAC Research. Pure static **HTML / CSS / vanilla JS** — no backend, no build step.
Open `index.html` and it works. Designed to be hosted on **GitHub Pages**.

Three audiences: regional research (coordinators), regional leadership
(high-level view), and regional marketing (timing + notes for activity planning).

---

## Quick start

1. Clone/download this repo.
2. Open `index.html` directly, or serve the folder:
   ```bash
   python3 -m http.server 8000   # then visit http://localhost:8000
   ```
3. On first load you see the **Calendar** view filtered to **Regional** reports for
   the **forward 12 months** (the planning default).

> The app never uses `localStorage`/`sessionStorage` — all working state is held
> in memory. Persistence happens by committing `data/publications.json` to the repo
> (see *Adding a publication* below).

---

## The data source — one JSON file

The single source of truth is **`data/publications.json`** — an array of publication
records. The record shape is described formally in **`data/schema.json`** (JSON Schema).
Market colours live in **`data/markets.json`**.

A record looks like:

```json
{
  "id": "hk-hong-kong-office-briefing-q3-2026-a1b2c3",
  "country": "Hong Kong",
  "city_state": "Hong Kong",
  "publication_name": "Hong Kong Office Briefing Q3 2026",
  "asset_class": ["Office", "Capital Markets"],
  "publication_type": "Market Reports",
  "language": "English",
  "expected_publication_date": "2026-09-15",
  "team": "HK Research",
  "notes": "Forward view on Kowloon East absorption.",
  "report_scope": "Regional",
  "status": null
}
```

- **Asset class** is multi-select: Office, Logistics, Residential, Retail, Hotels,
  Industrial, Capital Markets, Data Centres, Mixed Use.
- **Publication type** is single-select: Market Reports, Blogs, White Papers,
  Thought Leadership, Quarterly Outlooks, Sector Updates.
- **Report scope** is `Regional` or `In-Country`. Regional is the landing default.
- **Status** is reserved for a future release (see *Status field*). It is nullable
  and the whole UI tolerates `null`/missing values.

The 14 markets are: Japan, China, Thailand, Hong Kong, Singapore, Vietnam,
Philippines, Malaysia, South Korea, Taiwan, Australia, Indonesia, India, and
**Global Research** (treated as a country-like option — no special weighting).

### Savills events — `data/events.json`

Savills events (webinars, conferences, client events) live in a **separate**
file, **`data/events.json`**, described by **`data/events.schema.json`**. They are
a display-only layer: always shown, never filtered, not part of the URL and not
mixed into publications (Table / Quarters / Leadership / CSV export ignore them).

```json
{
  "generated_at": "2026-10-29T07:42:52+00:00",
  "events": [
    {
      "id": "global--savills-annual-global-luxury-event--9c57dc",
      "name": "Savills Annual Global Luxury Event",
      "start_date": "2027-04-14",
      "end_date": "2027-04-14",
      "market": "Global",
      "city": "Milan",
      "venue": "Milan",
      "event_type": "Event",
      "organiser": "Commercial Research",
      "audience": null,
      "link": null,
      "notes": null
    }
  ]
}
```

- **market** — one of the publication markets (Japan … India, Asia Pacific) or
  `Regional` / `Global`.
- **event_type** — `Webinar`, `Conference`, `Event` or `Other`.
- **audience** — `Internal`, `Client`, `Public` or `null`.
- **end_date** — same as `start_date` for a one-day event; later for multi-day.
- **link** / **notes** — optional (`null` hides them in the popover).

---

## Features

- **Calendar view** — month grid coloured by market, prev/next + Today + month
  picker, and a one-click **Forward 12-mo** strip (12 stacked mini-month lists).
- **Table view** — dense, sortable, all columns; click a row for detail.
- **Detail side panel** — right-hand slide-in (not a modal) with all fields, an
  **Edit** affordance, and **Copy as Markdown** for marketing.
- **Filter bar** (sticky) — Market, Report Scope, City/State, Asset Class,
  Publication Type, Language, Team, Date Range, and a History / Forward 12-mo
  window chip. Plus free-text search across name, notes, city, and team.
- **Shareable links** — every filter and the active tab are encoded in the URL
  (query string + `#view=` hash), so a planner can send a colleague a filtered link.
- **CSV export** of the currently-filtered set, all columns.
- **Add publication** — writes back to the repo via the GitHub API, or downloads
  an updated JSON file for manual commit.
- **Savills events layer** — events from `data/events.json` render as pink pills
  (above the publication pills) in 2 Months, Month and Forward 12-mo. Multi-day
  events draw as a continuous bar across the days they span (name repeated at
  the start of each week row). Caps match publications (2 / 4 per cell, counted
  separately) with a pink **+N more events** list. Click any event for a small
  popover with dates, type, market, city, venue, organiser, audience, link and
  notes. Events always show and ignore the filter bar. Legend: **Savills event**.
- **Events tab** — every event in a month-grouped table (Date(s), Name, Type,
  Market, City, Venue, Organiser, Audience, Link). Ignores filters; click a row
  for the event popover.
- **Holiday popover** — hover, focus or tap **+N more holidays** to see every
  holiday on that day as "Market – Holiday name".

---

## Adding a publication — two paths

### Path A — In-app + GitHub Personal Access Token (canonical)

1. Click **+ Add publication**.
2. Fill the form (it validates locally against the schema).
3. Enter **your name + email** (used as the commit author) and a **fine-grained PAT**.
4. Click **Commit to GitHub**. The app:
   - reads the current `data/publications.json` (to get the latest `sha`),
   - appends your record with a generated UUID,
   - PUTs the file back with a commit message `Add publication: <name> [<country>]`,
   - on a `409` conflict (someone else committed meanwhile) it re-fetches and
     retries once, then surfaces a clear error if it still fails.
5. On success the in-memory dataset refreshes immediately. GitHub Pages will serve
   the new file within a minute or two.

The token is held **in memory only** for that session and is never stored.

### Path B — Download → edit → commit (no token)

1. Click **+ Add publication**, fill the form, then **Download JSON instead**.
2. You get a `publications.json` containing all current records plus your new one.
3. Replace `data/publications.json` in the repo with this file and commit it
   (via the GitHub web UI or `git`).

---

## Adding an event (JSON edit)

Events are **JSON-edit-only in v1** — there is no in-app form.

1. Open `data/events.json` on GitHub (pencil icon) or in your editor.
2. Append a record to the `events` array (comma after the previous `}`).
3. Build the `id` as `<market-slug>--<name-slug>--<6-char hash>`. Any unique
   6 hex characters work; the convention is the first 6 of
   `sha1("<name>|<start_date>")`:
   ```bash
   python3 -c "import hashlib;print(hashlib.sha1(b'APAC Capital Markets Forum|2027-05-18').hexdigest()[:6])"
   ```
4. Update `generated_at` to the current ISO timestamp.
5. Commit to `main`. GitHub Pages serves it within a minute or two.

Worked example — a two-day Singapore conference added after the seed record:

```json
{
  "generated_at": "2026-11-02T09:00:00+08:00",
  "events": [
    {
      "id": "global--savills-annual-global-luxury-event--9c57dc",
      "name": "Savills Annual Global Luxury Event",
      "start_date": "2027-04-14",
      "end_date": "2027-04-14",
      "market": "Global",
      "city": "Milan",
      "venue": "Milan",
      "event_type": "Event",
      "organiser": "Commercial Research",
      "audience": null,
      "link": null,
      "notes": null
    },
    {
      "id": "singapore--apac-capital-markets-forum--8c4508",
      "name": "APAC Capital Markets Forum",
      "start_date": "2027-05-18",
      "end_date": "2027-05-19",
      "market": "Singapore",
      "city": "Singapore",
      "venue": "Marina Bay Sands Expo",
      "event_type": "Conference",
      "organiser": "APAC Research",
      "audience": "Client",
      "link": "https://www.savills.com.sg/",
      "notes": "Speaker slots confirmed by end-April."
    }
  ]
}
```

Rules: dates are `YYYY-MM-DD`; `end_date` ≥ `start_date`; enums must match the
schema exactly. Validate before committing (optional):

```bash
pip install jsonschema
python3 -c "import json,jsonschema;jsonschema.validate(json.load(open('data/events.json')),json.load(open('data/events.schema.json')));print('valid')"
```

A malformed file never breaks the app — the events layer simply shows nothing,
and individual records with a missing name or invalid start date are skipped.

---

## Creating a fine-grained Personal Access Token (PAT)

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Resource owner:** the org/user that owns this repo.
3. **Repository access:** *Only select repositories* → choose this repo.
4. **Permissions → Repository permissions → Contents: Read and write.**
5. Set a short expiry, generate, and copy the token (`github_pat_…`).
6. Paste it into the Add Publication form when committing. Never commit a token
   into the repo or paste it anywhere persistent.

---

## Pointing the app at your repo

Edit **`js/config.js`** — four constants drive the whole write workflow:

```js
GITHUB_OWNER:  "your-org",     // e.g. "savills-apac"
GITHUB_REPO:   "apac-pubcal",  // repository name
GITHUB_BRANCH: "main",         // branch GitHub Pages serves
DATA_PATH:     "data/publications.json"
```

That's the only file a team needs to change to adopt the tool.

---

## Market colour mapping

Colours are derived **only** from the Savills palette (Navy `#25273A`,
Steel Grey `#79828C`, Red `#CE181E`, Yellow `#FFDF00`) via disciplined
tints/shades. Each market has a chip fill and an auto-contrast text colour, and
**every pair passes WCAG AA (≥ 4.5:1)**. The canonical mapping lives in
`data/markets.json`:

| Market | Fill | Text | Contrast |
|---|---|---|---|
| Japan | `#212334` | white | 15.50 |
| China | `#25273A` | white | 14.69 |
| Hong Kong | `#424757` | white | 9.25 |
| Singapore | `#666875` | white | 5.52 |
| South Korea | `#5B6269` | white | 6.18 |
| Taiwan | `#79828C` | black | 5.38 |
| Australia | `#969EA5` | black | 7.73 |
| India | `#535967` | white | 7.02 |
| Thailand | `#A91419` | white | 7.50 |
| Vietnam | `#CE181E` | white | 5.56 |
| Indonesia | `#DC595D` | black | 5.63 |
| Malaysia | `#F0A309` | black | 9.95 |
| Philippines | `#D7C32A` | black | 11.73 |
| Global Research | `#E0C400` | black | 12.07 |

Yellow `#FFDF00` and Red `#CE181E` are reserved as **accents** in the chrome
(today indicator, primary CTA hover, future urgent/delayed flag) — not as the UI
foundation. To adjust a market colour, edit its `fill` in `data/markets.json` and
re-verify AA contrast (the `contrast` field documents the ratio).

---

## Project structure

```
index.html              entry point — load order of scripts matters
css/styles.css          Savills foundation; market colour comes from data
data/publications.json  SINGLE SOURCE OF TRUTH (array of records)
data/schema.json        JSON Schema for a record
data/markets.json       14 markets + colour assignments
data/events.json        Savills events (separate display-only layer)
data/events.schema.json JSON Schema for events.json
data/holidays.json      public holidays (refreshed by GitHub Action)
js/config.js            EDIT THIS to point at your repo
js/data.js              DATA LAYER: load, validate, GitHub read/write
js/state.js             STATE LAYER: filters, URL sync, applyFilters
js/views/helpers.js     shared DOM/date/chip utilities
js/events.js            EVENTS LAYER: SavillsEvents.load/all/forDate/isLoaded
js/views/popover.js     anchored popovers: EventPopover + HolidayPopover
js/views/calendar.js    month grid + forward-12 strip
js/views/table.js       dense sortable table
js/views/detail.js      right-hand detail side panel
js/views/form.js        add/edit form + GitHub commit UI
js/views/leadership.js  RESERVED v2 stub (#view=leadership)
js/views/events.js      Events tab (#view=events), month-grouped table
js/holidays.js          public holiday layer
js/app.js               orchestrator: filter bar, legend, tabs, CSV, boot
docs/MAINTENANCE.md     how to extend (Status field, leadership view, palette)
```

See **`docs/MAINTENANCE.md`** for how to add the Status field later, flesh out the
leadership view, and adjust the palette.
