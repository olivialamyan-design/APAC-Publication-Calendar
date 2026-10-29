/* =============================================================================
 * events.js — SAVILLS EVENTS LAYER (2026-10-29)
 * Loads Savills events (webinars, conferences, client events) from a static
 * data/events.json — see data/events.schema.json for the record shape.
 *
 * Design rules (mirrors the Holidays layer):
 *   - Display-only overlay. Events are ALWAYS shown, have no toggle, no
 *     filters and no URL state; they ignore the filter bar entirely.
 *   - Separate from publications: never mixed into DataLayer, the Table,
 *     Quarters or Leadership views, and never included in CSV export.
 *   - Non-fatal: if events.json is missing or malformed the app keeps working
 *     with an empty event list. Individual invalid records are skipped.
 *   - v1 is JSON-edit-only (no in-app form). A future GitHub Action may
 *     regenerate events.json from a shared source — see docs/MAINTENANCE.md.
 *
 * Public API:
 *   SavillsEvents.load()      -> Promise<array>  (idempotent)
 *   SavillsEvents.all()       -> array, sorted by start_date then name
 *   SavillsEvents.forDate(iso)-> array of events whose span covers that day
 *   SavillsEvents.isLoaded()  -> boolean
 * =========================================================================== */
const SavillsEvents = (() => {
  const URL = "data/events.json";
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  let _loaded = false;
  let _all = [];
  // _byDate: { "YYYY-MM-DD": [event, ...] } — multi-day events are indexed
  // onto EVERY day they span.
  let _byDate = {};

  const blank = v => (v === undefined || v === null || String(v).trim() === "") ? null : String(v).trim();

  function validDate(iso) {
    if (!ISO_RE.test(iso || "")) return false;
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // Normalise one raw record; returns null when it cannot be displayed.
  function normalize(r, i) {
    if (!r || typeof r !== "object") return null;
    const name = blank(r.name);
    const start = blank(r.start_date);
    if (!name || !validDate(start)) return null;
    let end = blank(r.end_date) || start;
    if (!validDate(end) || end < start) end = start;   // tolerate bad end dates
    return {
      id:         blank(r.id) || `event-${i}`,
      name,
      start_date: start,
      end_date:   end,
      market:     blank(r.market),
      city:       blank(r.city),
      venue:      blank(r.venue),
      event_type: blank(r.event_type),
      organiser:  blank(r.organiser),
      audience:   blank(r.audience),
      link:       blank(r.link),
      notes:      blank(r.notes),
      multi_day:  end !== start
    };
  }

  // Every ISO day from start to end inclusive (UTC arithmetic — no DST drift).
  function daysBetween(start, end) {
    const out = [];
    const [y, m, d] = start.split("-").map(Number);
    const cur = new Date(Date.UTC(y, m - 1, d));
    let guard = 0;
    while (guard++ < 400) {               // cap: no event spans > ~13 months
      const iso = cur.toISOString().slice(0, 10);
      out.push(iso);
      if (iso >= end) break;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }

  function index(json) {
    const list = Array.isArray(json) ? json : (json && Array.isArray(json.events) ? json.events : []);
    const all = list.map(normalize).filter(Boolean)
      .sort((a, b) => a.start_date.localeCompare(b.start_date) ||
                      b.end_date.localeCompare(a.end_date) ||
                      a.name.localeCompare(b.name));
    const map = {};
    all.forEach(ev => daysBetween(ev.start_date, ev.end_date)
      .forEach(iso => (map[iso] ||= []).push(ev)));
    return { all, map };
  }

  async function load() {
    if (_loaded) return _all;
    try {
      const res = await fetch(URL, { cache: "no-store" });
      if (!res.ok) throw new Error("events.json not found");
      const json = await res.json();
      const { all, map } = index(json);
      _all = all; _byDate = map;
    } catch (e) {
      // Non-fatal: app works without events.
      _all = []; _byDate = {};
    }
    _loaded = true;
    return _all;
  }

  const all = () => _all.slice();
  const forDate = iso => (_byDate[iso] || []).slice();
  const isLoaded = () => _loaded;

  // Shared label helper: "Apr 14, 2027" or "Apr 14 – Apr 16, 2027".
  function fmtRange(ev) {
    if (!ev.multi_day) return H.fmtLong(ev.start_date);
    const a = H.parseISO(ev.start_date), b = H.parseISO(ev.end_date);
    const sameYear = a.getFullYear() === b.getFullYear();
    const left = `${H.MONTHS_SHORT[a.getMonth()]} ${a.getDate()}` + (sameYear ? "" : `, ${a.getFullYear()}`);
    return `${left} – ${H.MONTHS_SHORT[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  }

  return { load, all, forDate, isLoaded, fmtRange, daysBetween };
})();
