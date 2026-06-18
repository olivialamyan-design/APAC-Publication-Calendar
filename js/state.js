/* =============================================================================
 * state.js — FILTER / STATE LAYER
 * Owns the active filter set + view, syncs to the URL (query string for
 * filters, hash for the view tab), and applies filters to the dataset.
 * Views subscribe to changes; they never read the URL themselves.
 * =========================================================================== */

const State = (() => {
  const listeners = [];
  const cfg = window.APP_CONFIG;

  // ---- the canonical filter state object ----
  const state = {
    view: "calendar",                 // calendar | quarters | table | usage | leadership(reserved)
    markets: [],                      // [] = all
    scope: cfg.DEFAULT_SCOPE,         // Regional | In-Country | Both
    cityState: "",                    // substring chip
    assetClasses: [],                 // [] = all
    pubTypes: [],                     // [] = all
    languages: [],                    // [] = all
    teams: [],                        // [] = all
    dateFrom: "",                     // YYYY-MM-DD
    dateTo: "",                       // YYYY-MM-DD
    range: cfg.DEFAULT_RANGE,         // all | history | forward12
    search: "",                       // free-text
    // ---- Public holiday display layer (2026-06-18) ----
    holidaysOn: true,                 // shown by default on first load
    holidayMarkets: [],               // [] = all configured holiday markets
    // ---------------------------------------------------------------------
    // FUTURE STATUS FILTER GOES HERE:
    //   statuses: [],  // [] = all; values from cfg.STATUS_VALUES
    // See docs/MAINTENANCE.md -> "Introducing the Status field".
    // ---------------------------------------------------------------------
    calendarMonth: null               // {y, m} the calendar is showing (0-based m)
  };

  function subscribe(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(fn => fn(state)); }

  // ---- mutation API (always re-syncs URL + notifies) ----
  function set(patch, opts = {}) {
    Object.assign(state, patch);
    if (!opts.silent) { syncToUrl(); notify(); }
  }
  function get() { return state; }

  // =========================================================================
  // URL sync — filters in query string, view in hash. Shareable links.
  // =========================================================================
  function syncToUrl() {
    const q = new URLSearchParams();
    if (state.markets.length) q.set("markets", state.markets.join(","));
    if (state.scope !== cfg.DEFAULT_SCOPE) q.set("scope", state.scope);
    if (state.cityState) q.set("city", state.cityState);
    if (state.assetClasses.length) q.set("asset", state.assetClasses.join(","));
    if (state.pubTypes.length) q.set("type", state.pubTypes.join(","));
    if (state.languages.length) q.set("lang", state.languages.join(","));
    if (state.teams.length) q.set("team", state.teams.join(","));
    if (state.dateFrom) q.set("from", state.dateFrom);
    if (state.dateTo) q.set("to", state.dateTo);
    if (state.range !== cfg.DEFAULT_RANGE) q.set("range", state.range);
    if (state.search) q.set("q", state.search);
    // holidays default ON; only record when explicitly turned off
    if (state.holidaysOn === false) q.set("hol", "0");
    if (state.holidayMarkets.length) q.set("holmkt", state.holidayMarkets.join(","));

    const qs = q.toString();
    const hash = `#view=${state.view}`;
    const url = `${location.pathname}${qs ? "?" + qs : ""}${hash}`;
    history.replaceState(null, "", url);
  }

  function readFromUrl() {
    const q = new URLSearchParams(location.search);
    const splitList = v => (v ? v.split(",").filter(Boolean) : []);
    if (q.has("markets")) state.markets = splitList(q.get("markets"));
    if (q.has("scope")) state.scope = q.get("scope");
    if (q.has("city")) state.cityState = q.get("city");
    if (q.has("asset")) state.assetClasses = splitList(q.get("asset"));
    if (q.has("type")) state.pubTypes = splitList(q.get("type"));
    if (q.has("lang")) state.languages = splitList(q.get("lang"));
    if (q.has("team")) state.teams = splitList(q.get("team"));
    if (q.has("from")) state.dateFrom = q.get("from");
    if (q.has("to")) state.dateTo = q.get("to");
    if (q.has("range")) state.range = q.get("range");
    if (q.has("q")) state.search = q.get("q");
    if (q.has("hol")) state.holidaysOn = q.get("hol") !== "0";
    if (q.has("holmkt")) state.holidayMarkets = splitList(q.get("holmkt"));

    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (h.has("view")) {
      const v = h.get("view");
      if (["calendar", "table", "quarters", "usage", "leadership"].includes(v)) state.view = v;
    }
  }

  // =========================================================================
  // Date window helpers
  // =========================================================================
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function plus12MonthsISO() {
    const d = new Date();
    d.setMonth(d.getMonth() + 12);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function minus12MonthsISO() {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  // =========================================================================
  // Apply the active filter set to the full dataset -> filtered array
  // =========================================================================
  function applyFilters(all) {
    const s = state;
    const today = todayISO();
    const fwdEnd = plus12MonthsISO();
    const histStart = minus12MonthsISO();
    const term = s.search.trim().toLowerCase();
    const city = s.cityState.trim().toLowerCase();

    return all.filter(p => {
      // TBD rows never appear in the main calendar/table/quarters streams.
      // They surface only in the dedicated TBD panel/column.
      if (p.is_tbd) return false;
      // market
      if (s.markets.length && !s.markets.includes(p.country)) return false;
      // scope (Both => no filter)
      if (s.scope !== "Both" && p.report_scope !== s.scope) return false;
      // city/state substring chip
      if (city && !(p.city_state || "").toLowerCase().includes(city)) return false;
      // asset class (match ANY selected)
      if (s.assetClasses.length &&
          !p.asset_class.some(a => s.assetClasses.includes(a))) return false;
      // publication type
      if (s.pubTypes.length && !s.pubTypes.includes(p.publication_type)) return false;
      // language
      if (s.languages.length && !s.languages.includes(p.language)) return false;
      // team
      if (s.teams.length && !s.teams.includes(p.team)) return false;
      // explicit date range (overrides nothing else; ANDs with range chip)
      if (s.dateFrom && p.expected_publication_date < s.dateFrom) return false;
      if (s.dateTo && p.expected_publication_date > s.dateTo) return false;
      // history vs forward chip
      if (s.range === "forward12") {
        if (p.expected_publication_date < today ||
            p.expected_publication_date > fwdEnd) return false;
      } else if (s.range === "history") {
        if (p.expected_publication_date >= today ||
            p.expected_publication_date < histStart) return false;
      }
      // ---- FUTURE STATUS FILTER would AND here:
      //   if (s.statuses.length && !s.statuses.includes(p.status)) return false;
      // search across name / notes / city_state / team
      if (term) {
        const hay = [p.publication_name, p.notes, p.city_state, p.team]
          .join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  // ---- distinct teams in the dataset (for the Team multi-select) ----
  function distinctTeams(all) {
    return Array.from(new Set(all.map(p => p.team).filter(Boolean))).sort();
  }

  return {
    subscribe, notify, set, get, readFromUrl, syncToUrl, applyFilters,
    distinctTeams, todayISO, plus12MonthsISO, minus12MonthsISO
  };
})();
