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
