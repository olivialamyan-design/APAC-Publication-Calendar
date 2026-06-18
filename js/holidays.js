/* =============================================================================
 * holidays.js — PUBLIC HOLIDAY LAYER (2026-06-18)
 * Loads national public holidays for the 14 APAC markets from a static,
 * pre-generated data/holidays.json (refreshed every 6 months by a GitHub
 * Action — see .github/workflows/refresh-holidays.yml).
 *
 * Why static JSON:
 *   - GitHub Pages is static; we want zero runtime API dependency for speed
 *     and offline-safety.
 *   - A scheduled Action runs the Python `holidays` library (national /
 *     country-level public holidays, English names) for the current + next
 *     year and commits holidays.json.
 *   - The app just reads that file. National holidays only — the generator
 *     requests country-level scope (no subdivisions), so no regional/state
 *     entries appear.
 *
 * The holiday layer is intentionally SEPARATE from publications: it is rendered
 * as a faint shaded day-cell background + a small flag marker, never mixed into
 * the publication event pills.
 * =========================================================================== */
const Holidays = (() => {
  // The 14 markets the user requested, mapped to ISO-3166-1 alpha-2 codes.
  // (Order = display order in the holiday-market selector.)
  const MARKETS = [
    { name: "Hong Kong",   code: "HK" },
    { name: "Australia",   code: "AU" },
    { name: "China",       code: "CN" },
    { name: "South Korea", code: "KR" },
    { name: "Japan",       code: "JP" },
    { name: "India",       code: "IN" },
    { name: "Indonesia",   code: "ID" },
    { name: "Malaysia",    code: "MY" },
    { name: "Pakistan",    code: "PK" },
    { name: "Singapore",   code: "SG" },
    { name: "Taiwan",      code: "TW" },
    { name: "Thailand",    code: "TH" },
    { name: "Vietnam",     code: "VN" },
    { name: "Philippines", code: "PH" }
  ];
  const NAME_BY_CODE = Object.fromEntries(MARKETS.map(m => [m.code, m.name]));

  let _loaded = false;
  // _byDate: { "YYYY-MM-DD": [ { code, market, name } ] }
  let _byDate = {};

  async function load() {
    if (_loaded) return _byDate;
    try {
      const res = await fetch("data/holidays.json", { cache: "no-store" });
      if (!res.ok) throw new Error("holidays.json not found");
      const json = await res.json();
      _byDate = indexHolidays(json);
    } catch (e) {
      // Non-fatal: app works without holidays. Leave _byDate empty.
      _byDate = {};
    }
    _loaded = true;
    return _byDate;
  }

  // Accepts either:
  //   { generated_at, markets: { HK: [ {date,name}, ... ], ... } }   (preferred)
  //   or a flat array [ {date, countryCode, name}, ... ]             (fallback)
  function indexHolidays(json) {
    const map = {};
    const push = (date, code, name) => {
      if (!date || !code) return;
      (map[date] ||= []).push({
        code,
        market: NAME_BY_CODE[code] || code,
        name: name || "Public holiday"
      });
    };
    if (json && json.markets && typeof json.markets === "object") {
      Object.entries(json.markets).forEach(([code, list]) => {
        (list || []).forEach(h => push(h.date, code, h.name || h.localName));
      });
    } else if (Array.isArray(json)) {
      json.forEach(h => push(h.date, h.countryCode || h.code, h.name || h.localName));
    }
    return map;
  }

  // List of market names for the selector (only those we have data for, else all).
  function marketList() {
    return MARKETS.map(m => m.name);
  }

  // Holidays for a given ISO date, filtered by the active holiday-market set.
  // selectedMarkets: array of market NAMES ([] = all configured markets).
  function forDate(iso, selectedMarkets) {
    const all = _byDate[iso] || [];
    if (!selectedMarkets || !selectedMarkets.length) return all;
    const set = new Set(selectedMarkets);
    return all.filter(h => set.has(h.market));
  }

  const isLoaded = () => _loaded;

  return { load, marketList, forDate, isLoaded, MARKETS };
})();
