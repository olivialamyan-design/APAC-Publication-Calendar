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

Updated 2026-11-06 (build script v6). The master workbook has these sheets,
and the build script reads three of them:

| Sheet | Used for |
|---|---|
| Instructions | Plain-language guide and colour legend for the team (not read) |
| Published & Planned | One row per issue. `Status` = `published` or `planned` |
| Upcoming Recurring | One row per recurring series (months, timing window) |
| Data Checks | Auto list of flagged rows (not read) |
| Event & Webinar | Rebuilds `data/events.json` (rows with TBD dates are skipped) |
| Reference Lists | Dropdown values (not read) |

Regenerate after any change:

```
python3 tools/build_publications.py --xlsx APAC-Publication-Calendar-Master_YYYYMMDD.xlsx \
  --out data/publications.json --events data/events.json --report build_report.json
```

Rules:

1. **Published & Planned rows** are shown at their exact date
   (`date_confidence = "Confirmed"`). `published` rows show a "Published" badge and
   link to the Savills URL. `planned` rows with a past date get `overdue = true`
   and an "Overdue - review" badge. `TBD` dates go to the TBD panel (no extra tag).
   The site title is always Publication Name + the Period typed on the sheet.
2. **Upcoming Recurring** series are projected forward only after the latest
   dated issue of that series. Quarter / half-year labels continue from the latest
   Period on Published & Planned (Q3 2026 -> Q4 2026 -> ...), never re-derived from
   the slot month; a slot is skipped if it is earlier than the series' own release
   lag allows. An estimated issue up to 45 days late stays on the site flagged
   `overdue` ("Overdue - review"). Date = Recurring Timing Window (`Early month`→5,
   `Mid-month`→15, `Late month`→25, weekend → previous business day), or the last
   business day of the month if no window. `Estimated`.
3. `Next Date` is retired: put the next confirmed date on a `planned` row instead.
   Date Confidence is computed automatically; there is no owner override.
4. Nothing before 2026-01-01 is published to the site. An old-format workbook
   (single `Publications` sheet) fails with a clear message.

Workbook colours: red = must fix (build fails), blue = review (planned date passed,
month outside the usual months, or published with a future date), amber = TBD.

---

## Savills events layer (added 2026-10-29)

A display-only overlay, deliberately separate from publications.

| Piece | File | Notes |
|---|---|---|
| Data | `data/events.json` | `{ generated_at, events: [...] }` — flat array, JSON-edit-only in v1 |
| Schema | `data/events.schema.json` | JSON Schema (draft-07), same style as `data/schema.json` |
| Loader | `js/events.js` → `SavillsEvents` | `load()`, `all()`, `forDate(iso)`, `isLoaded()`, plus `fmtRange(ev)` |
| Calendar | `js/views/calendar.js` | `layoutWeek()`, `sevPill()`, `buildSevBlock()`; strip interleave in `renderStrip()` |
| Popovers | `js/views/popover.js` | `Popover`, `EventPopover`, `HolidayPopover` |
| Events tab | `js/views/events.js` → `EventsView` | `#view=events`, routed in `App.rerender()` |
| Legend | `js/app.js → buildLegend()` | static "Savills event" swatch |

**Invariants — keep these when extending:**
- Events never enter `DataLayer`, `State.applyFilters()`, the URL, Table,
  Quarters, Leadership or CSV export. They ignore the filter bar entirely.
- No toggle and no storage. Loading is non-fatal (same pattern as `Holidays`):
  a missing/malformed file yields an empty list; bad records are skipped
  (`normalize()` drops records with no `name` or an invalid `start_date`, and
  clamps a missing/invalid/earlier `end_date` to `start_date`).
- Script order in `index.html`: `helpers → events.js → views/popover.js →
  views… → views/events.js → holidays → app`.

### Schema and enums

| Field | Type | Allowed values |
|---|---|---|
| `id` | string | `<market-slug>--<name-slug>--<6 hex>`; hash = first 6 of `sha1("<name>\|<start_date>")` |
| `name` | string | non-empty |
| `start_date` / `end_date` | `YYYY-MM-DD` | `end_date ≥ start_date` (enforced in JS; JSON Schema can't compare fields) |
| `market` | enum | Japan, China, Thailand, Hong Kong, Singapore, Vietnam, Philippines, Malaysia, South Korea, Taiwan, Australia, Indonesia, India, Asia Pacific, **Regional**, **Global** |
| `city`, `venue`, `organiser` | string | free text |
| `event_type` | enum | Webinar, Conference, Event, Other |
| `audience` | enum / null | Internal, Client, Public, `null` |
| `link` | URI / null | `http(s)://` only is rendered as a link (opens in a new tab) |
| `notes` | string / null | free text |

All twelve keys are required (use `null` for blanks) and `additionalProperties`
is `false`, so the file stays predictable for automated regeneration. To add a
market or type, extend the enum in `data/events.schema.json` — no JS change is
needed (values are rendered as-is).

### Rendering rules

- Pills sit **above** publication pills in each day cell, in all three calendar
  modes. Caps are counted separately from publications: `maxPerCell` = 2 in
  2 Months, 4 in Month. Extra events collapse into a pink **+N more events**
  button that opens a list popover for the day.
- Multi-day events: `layoutWeek()` assigns each event a *lane* per 7-day row so
  it keeps the same vertical slot across its days (invisible spacers hold
  alignment). Segments use `.sev-cont-l` / `.sev-cont-r` to bleed into cell
  padding and square the joins. The name is shown on the first cell of each
  week segment; continuation cells are `tabindex=-1` with an `aria-label`.
- Forward 12-mo strip: events overlapping the month are interleaved with the
  month's publications by date (events first on ties), keyed by the first day
  inside that month; they count towards the month total.

### Changing the pink

The two tokens live at the top of the "SAVILLS EVENTS LAYER" block in
`css/styles.css`:

```css
--sev:      #D43880;   /* identity: legend swatch, strip border, dots */
--sev-pill: #CC2F77;   /* text-bearing fill (white text 4.95:1) */
```

White on Savills pink `#D43880` measures **4.49:1** — just below WCAG AA — so
every pink surface that carries text (calendar pills/bars, "+N more events")
uses **`#CC2F77`** (white = **4.95:1**). `#D43880` is kept for non-text uses
only: the legend swatch, the strip's left border and the dots. Both fills are
theme-independent, so the ratio holds in light and dark mode. Pink is never
used as a text colour. If you change either token, re-check white-on-fill ≥ 4.5:1.

### Popover components (`js/views/popover.js`)

- **`Popover.create(cls)`** — generic anchored card. Reuses the `.ms-pop`
  surface/hairline/shadow (so it follows the theme tokens) with
  `.app-pop { position: fixed }`; JS positions it below the anchor, flips above
  when there's no room, and clamps to the viewport. Dismissal is global:
  outside click (capture phase, so it also closes when the next click lands on
  a pill that calls `stopPropagation`), Esc (focus returns to the anchor),
  scroll and resize. `Popover.hideAll()` runs at the start of every
  `CalendarView.render()` because anchors are replaced.
- **`EventPopover.open(ev, anchor)` / `.openList(events, iso, anchor)`** — the
  event card (blank fields hidden) and the day list; selecting a list item
  swaps to that event's card. Used by calendar pills, the strip and the Events
  tab. It is intentionally *not* the detail side panel.
- **`HolidayPopover.attach(trigger, iso, hols)`** — wires a "+N more holiday(s)"
  row: mouse/pen hover, keyboard focus (Enter/Space) and touch tap (toggle) open
  a card listing **all** holidays for the day as "Market – Holiday name";
  pointer leave (120 ms grace so the pointer can cross into the card), blur, Esc
  or an outside tap close it. Caps are unchanged (1 row in 2 Months, 2 in Month).
  The publications "+N more" button still opens `Detail.openList()`.

### Future: regenerate events.json from a shared source (GitHub Action hook)

<!-- HOOK: events-shared-source-action
     A future workflow (e.g. .github/workflows/refresh-events.yml, modelled on
     refresh-holidays.yml) can read a shared source — a SharePoint/Excel list,
     Google Sheet or CSV export owned by Marketing / Commercial Research —
     map its columns to the twelve fields above, generate ids with
     sha1("<name>|<start_date>")[:6], validate against data/events.schema.json,
     rewrite data/events.json (stamping generated_at) and commit to main only
     when the content changes. The front end needs no change: it only reads
     data/events.json. Once the Action is live, treat the shared source as the
     master and stop hand-editing the JSON (manual edits would be overwritten). -->

Until then, follow README → *Adding an event (JSON edit)*.

---

## Common tasks

- **Change the landing defaults** (scope / window): `js/config.js → DEFAULT_SCOPE`
  and `DEFAULT_RANGE`.
- **Add an asset class / publication type / language**: edit the arrays in
  `js/config.js` (the form and filters read from there).
- **Change the script load order**: keep `config → data → state → helpers →
  events → views (popover first, events tab last) → holidays → app` in
  `index.html`; views depend on helpers, app depends on everything.
