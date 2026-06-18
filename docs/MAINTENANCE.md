# Maintenance & Extension Guide

This document explains the internal architecture and how to extend the calendar
safely. Read the top-level `README.md` first for usage.

---

## Architecture in one minute

The app is split into three layers so future work touches one place, not many:

| Layer | File(s) | Responsibility |
|---|---|---|
| **Data** | `js/data.js` | Load, parse, validate, and write `data/publications.json`. Owns the GitHub Contents API read/write workflow. No DOM. |
| **State / filters** | `js/state.js` | The active filter set + view; syncs to the URL; `applyFilters()` produces the filtered array. |
| **Views** | `js/views/*.js` | Pure render functions. Views call `DataLayer.*` and `State.*`; they never touch GitHub or the URL directly. |
| **Glue** | `js/app.js` | Builds the filter bar, legend, tabs, CSV export; boots everything. |

`js/config.js` holds repo settings and the shared taxonomies (asset classes,
publication types, languages, scopes, and the future status list).

---

## The GitHub-backed write workflow (how it works)

Implemented in `js/data.js`:

1. **GET** `…/contents/data/publications.json?ref=<branch>` → decode base64
   `content` + capture `sha`. This guarantees we append to the latest version.
2. Append the new record (with a generated UUID), re-encode to base64.
3. **PUT** the same path with the prior `sha`, a commit message
   `Add publication: <name> [<country>]`, and `committer` from the form.
4. On **409** (sha mismatch — concurrent commit) the code re-fetches and retries
   **once**; if it still conflicts it shows: *"The data file changed while you were
   editing — please re-submit."*
5. On success the in-memory dataset is replaced with what was committed.

**Token handling:** the PAT is passed per-call from the form and held in memory
only. It is never written to storage. (In a real GitHub Pages deployment outside
the preview sandbox you *could* opt into `sessionStorage`, but the shipped app
intentionally keeps it in memory for security.)

**Caveats:**
- GitHub Pages serves a *cached* copy of the file; after a commit the public site
  may take a minute or two to reflect the change. The in-app view updates instantly
  because it refreshes from the API response.
- The browser calls `api.github.com` directly, so the PAT must have
  `contents: read & write` on exactly this repo (fine-grained PAT recommended).
- The preview/deploy sandbox may restrict outbound calls to `api.github.com`; the
  write path is fully functional on a real GitHub Pages host. The **Download JSON**
  fallback always works regardless.

---

## Introducing the Status field (planned v2)

Status already exists in the schema as a **nullable** field. Planned values:
`idea, drafting, review, sign off, published, delayed` (defined once in
`js/config.js → STATUS_VALUES`). To turn it on, touch these four places — each is
marked with a comment in the code:

1. **`data/schema.json`** — Status is already in the schema; no change needed
   unless you want to make it required (don't, for backward compatibility).
2. **`js/state.js`** —
   - add `statuses: []` to the `state` object (next to the marked comment block),
   - add the filter clause in `applyFilters()`:
     `if (s.statuses.length && !s.statuses.includes(p.status)) return false;`
   - add it to `syncToUrl()` / `readFromUrl()` so it shares in links.
3. **`js/app.js → buildFilterBar()`** — uncomment the marked line:
   `row2.appendChild(multiSelect("Status", "statuses", cfg.STATUS_VALUES, s.statuses));`
4. **Views** —
   - `js/views/table.js`: add a `status` column to `COLS` (a `statusBadge()` helper).
   - `js/views/calendar.js`: in `eventPill()` (marked hook) style delayed items with
     the red accent `#CE181E`; optionally add a small badge for other statuses.
   - `js/views/detail.js`: the panel already renders a Status row when present.
   - `js/views/form.js`: add a Status `<select>` at the marked comment (keep nullable).

Use Yellow `#FFDF00` / Red `#CE181E` only as accents for urgent/delayed — keep
market colour the primary visual encoding.

---

## Leadership view stub (planned v2)

The route `#view=leadership` is reserved and wired:
- `js/state.js` accepts `leadership` as a valid view.
- `js/app.js → rerender()` dispatches to `LeadershipView.renderLeadershipView()`.
- `js/views/leadership.js` currently renders a placeholder with a TODO.

To build it: render a chrome-free "upcoming publications" board for regional
leadership — large type, grouped by month, market chips only, no filter bar.
Pull the forward-12-month Regional set via `State.applyFilters(DataLayer.getAll())`
(or a dedicated leadership filter), and make it print-friendly. Add a top-bar tab
`<button class="tab" data-view="leadership">Leadership</button>` in `index.html`
once the view is ready.

---

## Adjusting the market palette

Colours live in `data/markets.json`. Each market has `fill`, `text`, and a
documented `contrast` ratio. Rules when changing a colour:

1. Derive it from the four Savills base hues only (Navy, Steel, Red, Yellow) —
   no unrelated colours.
2. After changing a `fill`, re-check the **WCAG AA** contrast of the paired `text`
   (must be ≥ 4.5:1). A quick check: paste fill + text into any WCAG contrast
   checker, or compute relative luminance. Pick black/white text for whichever
   gives the higher ratio.
3. Update the `contrast` field and the table in `README.md`.

The chrome (top bar, filter bar, panels) is intentionally palette-neutral so the
14 market colours read clearly. Keep Yellow/Red as accents only.

---

## Adding a new market

1. Add it to the `country` enum in `data/schema.json`.
2. Add a `{ name, family, fill, text, contrast }` entry to `data/markets.json`
   (derive the colour per the palette rules above).
3. It automatically appears in the Market filter, the legend, and the form select.

No code change is required — the market list is data-driven.

---

## Recurring date model (build-time expansion)

Recurring rows are pre-expanded into `data/publications.json` by
`tools/build_publications.py` — the browser never computes dates. Regenerate
after any change:

```
python3 tools/build_publications.py --xlsx APAC-Publication-Calendar-Master-5.xlsx --out data/publications.json
```

Date for each generated occurrence is resolved in priority order:

1. **Exact next-occurrence override** — `Expected Publication Date` on a
   recurring row is used for the next upcoming occurrence only
   (`date_confidence = "Confirmed"`); later instances revert to the estimate.
2. **Recurring Timing Window** — `Early month`→5, `Mid-month`→15,
   `Late month`→25, snapped to a business day via `adjust_to_business_day()`
   (weekend → previous business day, kept in the same month). `Estimated`.
3. **Fallback** — no window / `TBD` → `last_business_day_of_month()`
   (Mon–Fri; public holidays ignored). `Estimated`.

`date_confidence` is inferred when blank (exact→Confirmed, window/fallback→
Estimated, neither→TBD); an owner value overrides. `Start Date` gates the first
generated instance and is backend-only. Two fields are emitted per record:
`recurring_timing_window` and `date_confidence` (both surfaced by
`js/data.js → normalize()`; `detail.js` renders the Date Confidence row).

Existing rows with no window keep `null` and use the fallback — windows are
never auto-assigned by publication type.

---

## Common tasks

- **Change the landing defaults** (scope / window): `js/config.js → DEFAULT_SCOPE`
  and `DEFAULT_RANGE`.
- **Add an asset class / publication type / language**: edit the arrays in
  `js/config.js` (the form and filters read from there).
- **Change the script load order**: keep `config → data → state → helpers → views
  → app` in `index.html`; views depend on helpers, app depends on everything.
