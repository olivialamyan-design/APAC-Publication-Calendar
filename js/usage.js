/* =============================================================================
 * usage.js — USAGE / PAGE-OPEN TRACKING (2026-06-18)
 *
 * GOAL: count how many times the platform is opened per day, over time.
 * NOT clickstream analytics — just visit counts. No third-party analytics.
 *
 * WHERE THE DATA LIVES (important — GitHub Pages is static):
 *   A static page cannot securely write to the repo on its own, so the
 *   authoritative, SHARED, cross-user daily counts are produced server-side
 *   by a scheduled GitHub Action that snapshots GitHub Pages' own view-stats
 *   API into data/usage.json (see .github/workflows/usage-snapshot.yml).
 *   The Usage tab READS that committed file. This is passive (no client token)
 *   and persists across all users — front-end storage alone cannot do that.
 *
 *   data/usage.json shape:
 *     { "source": "github-pages-views",
 *       "updated_at": "2026-06-18",
 *       "daily": [ { "date": "2026-06-17", "count": 42 }, ... ] }
 *
 * LOCAL SIGNAL (secondary): we also keep a small localStorage tally of opens
 * from THIS browser. It is shown as a faint "this device" overlay and is NOT a
 * substitute for the shared server counts — it's a sanity reference only.
 * =========================================================================== */
const Usage = (() => {
  const LS_KEY = "apac-usage-local"; // { "YYYY-MM-DD": n }
  let _server = null;                // parsed data/usage.json (or null)

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  // ---- record one page open in this browser (best-effort, de-duped per load) ----
  // De-dupe: a single page load counts once even if boot runs twice.
  let _recordedThisLoad = false;
  function recordOpen() {
    if (_recordedThisLoad) return;
    _recordedThisLoad = true;
    try {
      const map = readLocal();
      const t = todayISO();
      map[t] = (map[t] || 0) + 1;
      localStorage.setItem(LS_KEY, JSON.stringify(map));
    } catch (e) { /* private mode / sandbox — ignore */ }
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
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

  // ---- merge server (authoritative) + local (this device) into one series ----
  // Returns sorted [{ date, count, local }] across the union of dates.
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

  // ---- CSV export of the daily usage series ----
  function exportCsv() {
    const rows = series();
    const cols = ["date", "opens", "this_device_opens"];
    const escCsv = v => {
      v = v == null ? "" : String(v);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const lines = [cols.join(",")].concat(
      rows.map(r => [escCsv(r.date), escCsv(r.count), escCsv(r.local)].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `apac-usage-${todayISO()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    if (typeof App !== "undefined" && App.toast) App.toast(`Exported ${rows.length} days to CSV`);
  }

  return { recordOpen, loadServer, series, meta, exportCsv, todayISO };
})();
