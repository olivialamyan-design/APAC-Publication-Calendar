# APAC Publication Calendar — Change Log (2026-06-18)

This round implements five approved feature areas (A–E) plus the build tooling
that ties the spreadsheet to the live data. **No rebuild** — every change is
additive and reversible, the design language and information architecture are
unchanged, and everything runs on static GitHub Pages.

---

## A. Usage tab (page-open tracking)

- **`js/usage.js`** — reads the shared, server-side daily counts from
  `data/usage.json`; keeps a faint per-device localStorage tally as a secondary
  reference only. CSV export of the daily series. No third-party analytics, no
  user identity, no unique-visitor tracking — just visit counts over time.
- **`js/views/usage.js`** — the Usage tab: 3 KPI cards, a daily bar chart, a
  source note, and a CSV export button.
- **`data/usage.json`** — the persistent, cross-user store (seed = zeros).
- **Where the data lives:** a static page can't securely write to the repo, so
  the authoritative shared counts come from a scheduled GitHub Action
  (`.github/workflows/usage-snapshot.yml`) that snapshots GitHub's own Pages
  traffic stats and commits them. The tab reads that committed file.

## B. Compressed 3-month calendar

- Desktop: 3 months side-by-side. Mobile: horizontal swipe. Default view =
  current month + next two. One shared filter/search bar; click an item to open
  the detail panel. Readability prioritised over density.

## C. APAC public holidays (14 markets)

- **`data/holidays.json`** — national (country-level) public holidays in
  English for HK, AU, CN, KR, JP, IN, ID, MY, PK, SG, TW, TH, VN, PH. Years =
  current + next.
- Shaded day-cell layer, a separate Holiday Markets selector, and an on/off
  toggle (**on by default**). Holidays are shown clearly but separately from
  publications.
- **Refreshes every 6 months** via `.github/workflows/refresh-holidays.yml`,
  which runs `tools/gen_holidays.py`.

## D. UI / UX fixes

- Default scope = **Both**, default window = **All** (`js/config.js`).
- Search bar moved into the Calendar / Quarters / Table tab row.
- Tooltip on the Legend.
- Dark-mode fix: City/State search box text is now readable.
- Asset Class / Publication Type / Language filters derive their options
  **dynamically** from the loaded data, not hardcoded lists.

## E. Spreadsheet (`APAC-Publication-Calendar-Master-5.xlsx`)

- New **Lead Author** (col M) and **Start Date** (col K) fields. Future
  recurring instances are only generated on/after Start Date.
- Duplicate Publication Names highlighted in **red** on the main data sheet.
- Dropdowns / validation preserved; Instructions sheet updated to v3.
- Backward-compatible: the parser maps columns by **header name**, so adding or
  reordering columns won't break the build.

---

## Build tooling (`tools/`)

### `tools/build_publications.py`

Rebuilds `data/publications.json` from the master xlsx.

- Maps columns by **header name** (robust to reorder), not position.
- Supports `lead_author` and `start_date`.
- Expands recurring series: one record per occurrence, dated the **last day of
  each recurring month**, projected over a fixed forward window
  (generation month .. +24 months), skipping any occurrence before a series'
  Start Date.
- Surfaces source-data typos (e.g. `un` vs `Jun` in Recurring Months) to
  stderr instead of silently dropping data.

```bash
cd <repo root>
python3 tools/build_publications.py \
  --xlsx APAC-Publication-Calendar-Master-5.xlsx \
  --out  data/publications.json
```

### `tools/gen_holidays.py`

Regenerates `data/holidays.json` using the Python `holidays` library
(country-level scope = national only, English names). Run from the repo root;
the GitHub Action calls it on a 6-month schedule.

```bash
pip install "holidays>=0.50"
python3 tools/gen_holidays.py
```

---

## GitHub Actions

| Workflow | Schedule | What it commits |
|---|---|---|
| `.github/workflows/usage-snapshot.yml` | daily 01:17 UTC | `data/usage.json` (accumulated Pages view counts) |
| `.github/workflows/refresh-holidays.yml` | Jan 2 & Jul 2, 03:00 UTC | `data/holidays.json` |

**Usage workflow notes**

- Needs GitHub Pages enabled and admin-read on the repo. The default
  `GITHUB_TOKEN` works in-repo (we request `administration: read`). If your org
  blocks that, add a fine-grained PAT (Administration: Read + Contents: Read &
  write) as secret **`USAGE_TOKEN`** — the workflow prefers it when present.
- The Pages views API only returns ~14 days, so the workflow **merges** each
  snapshot into the historical series (takes the max per day). History is never
  lost.

---

## ⚠️ Source-data items to fix in the spreadsheet (not code bugs)

The parser flagged these typos on the last build. They don't break anything but
are worth correcting so the data reads cleanly and the market-in-name rule holds:

- **"Austrlia - The Residential Review"** → should be "Australia …"
- **"Sngapore Industrial Briefing"** → should be "Singapore …"

(The `un` → `Jun` typo in Recurring Months for two rows was already corrected so
no June instances are lost.)

---

# APAC Publication Calendar — Change Log addendum (v4, 2026-06-18 PM)

This round adds an **estimated recurring date model** and a small holiday-row
styling tweak. As before: no rebuild — additive, reversible, same design
language and information architecture, still static GitHub Pages.

## Estimated recurring date model

Recurring rows whose exact date is unknown now resolve to an **estimated** date
instead of always landing on the calendar month-end. Date resolution priority,
per generated occurrence (all in `tools/build_publications.py`):

1. **Exact next-occurrence override** — if `Expected Publication Date` is set on
   a recurring row, it is used for the **next upcoming occurrence only**
   (Date Confidence = `Confirmed` for that instance). Later instances revert to
   the estimate.
2. **Recurring Timing Window** — `Early month` → 5th, `Mid-month` → 15th,
   `Late month` → 25th, each snapped to a **business day** (weekend → previous
   business day, same month). Date Confidence = `Estimated`.
3. **Fallback** — no window (or `TBD`) → **last business day of the month**
   (changed from last *calendar* day). Public holidays are ignored for this
   calculation; business day = Mon–Fri. Date Confidence = `Estimated`.

**Date Confidence** is auto-inferred when the owner leaves it blank
(exact date → `Confirmed`; window/fallback → `Estimated`; neither → `TBD`); an
owner-entered value always overrides inference. `Start Date` is now **required**
for recurring rows (projected from upload date if blank) and remains
backend-only (never shown in the detail panel).

**Retroactive:** existing rows with no timing window keep `recurring_timing_window
= null` and use the last-business-day fallback — windows are **not**
auto-assigned by publication type. The build now emits two new per-record
fields: `recurring_timing_window` and `date_confidence`.

- **`tools/build_publications.py`** — business-day helpers, timing-window anchor
  mapping, last-business-day fallback, next-occurrence override, confidence
  inference. Recurring expansion still happens at **build time**.
- **`data/schema.json`** — added `recurring_timing_window` and `date_confidence`
  enums; clarified `start_date` (required-in-sheet for recurring, backend-only).
- **`js/data.js`** — `normalize()` surfaces the two new fields.
- **`js/views/detail.js`** — renders a **Date Confidence** row when present
  (e.g. just `Date Confidence: Estimated`, no extra copy).

## Holiday rows — paler tint

- **`css/styles.css`** — calendar holiday-row background is now
  `rgba(238, 232, 227, 0.3)` (cream `#EEE8E3` at ~30% opacity). Text colour kept
  readable in **both** light and dark mode; the legend swatch matches. Holiday
  *logic* is unchanged — styling only.

## Spreadsheet (`APAC-Publication-Calendar-Master-5.xlsx`)

- New columns after `Start Date`: **Recurring Timing Window** (L, dropdown:
  Early month / Mid-month / Late month / TBD) and **Date Confidence** (M,
  dropdown: Confirmed / Estimated / TBD). Team / Lead Author / Notes / Report
  Scope / Status shift right to N–R.
- Reference Lists gains the two dropdown sources; all data validations and
  inline prompts rebuilt at the new positions.
- New conditional-format **inconsistency flags**: Confirmed-but-no-Expected-Date,
  recurring-with-no-Start-Date, Estimated-on-non-recurring-with-no-window
  (red); timing-window-on-Ad-Hoc and TBD cells (amber).
- Instructions sheet updated to **v4** (new fields, business-day fallback,
  next-occurrence override, confidence inference, inconsistency-flags section).
- Parser maps columns by **header name**, so the inserted columns don't break
  the build.
