/* =============================================================================
 * usage.js — USAGE / PAGE-OPEN TRACKING (2026-07-08)
 *
 * GOAL: count how many times the platform is opened per day, over time.
 * Also detects and records the device type (Desktop vs Mobile) for each open
 * on this browser, shown in the Usage tab breakdown.
 *
 * WHERE THE DATA LIVES (important — GitHub Pages is static):
 *   Shared cross-user daily counts come from data/usage.json, written by a
 *   scheduled GitHub Action (see .github/workflows/usage-snapshot.yml).
 *   Device-type breakdown is stored in localStorage per browser (local only).
 *
 *   data/usage.json shape:
 *     { "source": "github-pages-views",
 *       "updated_at": "2026-07-08",
 *       "daily": [ { "date": "2026-07-07", "count": 42 }, ... ] }
 *
 * LOCAL SIGNAL (this browser):
 *   localStorage key "apac-usage-local"  → { "YYYY-MM-DD": n }
 *   localStorage key "apac-device-opens" → { "desktop": n, "mobile": n }
 * =========================================================================== */
const Usage = (() => {
  const LS_KEY        = "apac-usage-local";  // { "YYYY-MM-DD": n }
  const LS_DEVICE_KEY = "apac-device-opens"; // { desktop: n, mobile: n }
  let _server = null;

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  // ---- detect device type: "mobile" or "desktop" ----
  function detectDevice() {
    const ua = (navigator.userAgent || "").toLowerCase();
    const hasTouchPoints = navigator.maxTouchPoints > 1;
    const mobileUA = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/.test(ua);
    // iPad with iPadOS reports as desktop UA but has touch points
    if (mobileUA || (hasTouchPoints && window.innerWidth <= 1024)) return "mobile";
    return "desktop";
  }

  // ---- record one page open (de-duped per load) ----
  let _recordedThisLoad = false;
  function recordOpen() {
    if (_recordedThisLoad) return;
    _recordedThisLoad = true;
    try {
      // daily tally
      const map = readLocal();
      const t = todayISO();
      map[t] = (map[t] || 0) + 1;
      localStorage.setItem(LS_KEY, JSON.stringify(map));
      // device type tally
      const device = detectDevice();
      const dev = readDeviceLocal();
      dev[device] = (dev[device] || 0) + 1;
      localStorage.setItem(LS_DEVICE_KEY, JSON.stringify(dev));
    } catch (e) { /* private mode / sandbox — ignore */ }
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function readDeviceLocal() {
    try {
      const raw = localStorage.getItem(LS_DEVICE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  // Returns { desktop: n, mobile: n, currentDevice: "desktop"|"mobile" }
  function deviceStats() {
    const dev = readDeviceLocal();
    return {
      desktop: dev.desktop || 0,
      mobile:  dev.mobile  || 0,
      currentDevice: detectDevice()
    };
  }

  // ---- load the shared server-side counts ----
  async function loadServer() {
    if (_server) return _server;
    try {
      const res = await fetch("data/usage.json", { cache: "no-store" });
      if (!res.ok) throw new Error("usage.json not found");
      _server = await res.json();
    } catch (e) {
      _server = null;
    }
    return _server;
  }

  // ---- merge server + local into one series ----
  function series() {
    const local = readLocal();
    const out = {};
    const serverDaily = (_server && Array.isArray(_server.daily)) ? _server.daily : [];
    serverDaily.forEach(d => {
      if (!d || !d.date) return;
      out[d.date] = { date: d.date, count: Number(d.count) || 0, local: 0 };
    });
    Object.entries(local).forEach(([date, n]) => {
      out[date] = out[date] || { date, count: 0, local: 0 };
      out[date].local = Number(n) || 0;
    });
    return Object.values(out).sort((a, b) => a.date.localeCompare(b.date));
  }

  function meta() {
    return {
      hasServer: !!(_server && Array.isArray(_server.daily) && _server.daily.length),
      source: _server && _server.source || null,
      updatedAt: _server && _server.updated_at || null
    };
  }

  return { recordOpen, loadServer, series, meta, deviceStats, todayISO };
})();
