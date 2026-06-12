/* =============================================================================
 * app.js — APPLICATION ORCHESTRATOR
 * Boots data, builds the filter bar + legend, handles tab switching, CSV
 * export, and routes the active view. Glue only — logic lives in the layers.
 * =========================================================================== */
const App = (() => {
  let booted = false;

  // ------- toast -------
  let toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = H.el("div", { class: "toast" }); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  // ===========================================================================
  // Filter bar (sticky). Multi-select dropdowns implemented as popover chips.
  // ===========================================================================
  function multiSelect(label, key, options, selected) {
    const wrap = H.el("div", { class: "ms" });
    const btn = H.el("button", { class: "ms-btn" + (selected.length ? " active" : "") },
      `${label}${selected.length ? ` <span class="ms-count">${selected.length}</span>` : ""} <span class="ms-caret">▾</span>`);
    const pop = H.el("div", { class: "ms-pop" });
    options.forEach(o => {
      const id = `${key}-${o}`.replace(/\W/g, "");
      const row = H.el("label", { class: "ms-opt" });
      row.innerHTML = `<input type="checkbox" ${selected.includes(o) ? "checked" : ""}> <span>${H.esc(o)}</span>`;
      row.querySelector("input").addEventListener("change", e => {
        const s = State.get();
        const arr = s[key].slice();
        if (e.target.checked) arr.push(o); else arr.splice(arr.indexOf(o), 1);
        State.set({ [key]: arr });
      });
      pop.appendChild(row);
    });
    btn.addEventListener("click", e => {
      e.stopPropagation();
      document.querySelectorAll(".ms-pop.open").forEach(p => { if (p !== pop) p.classList.remove("open"); });
      pop.classList.toggle("open");
    });
    wrap.append(btn, pop);
    return wrap;
  }

  function segChip(label, value, current, onClick) {
    const b = H.el("button", { class: "chip-seg" + (value === current ? " on" : "") }, label);
    b.addEventListener("click", () => onClick(value));
    return b;
  }

  function buildFilterBar() {
    const s = State.get();
    const cfg = window.APP_CONFIG;
    const all = DataLayer.getAll();
    const bar = document.getElementById("filterBar");
    bar.innerHTML = "";

    // Row 1: search + scope + range
    const row1 = H.el("div", { class: "fb-row" });

    const search = H.el("input", { class: "fb-search", type: "search",
      placeholder: "Search name, notes, city, team…", value: s.search });
    let st;
    search.addEventListener("input", e => {
      clearTimeout(st);
      const v = e.target.value;
      st = setTimeout(() => State.set({ search: v }), 180);
    });
    row1.appendChild(search);

    // scope chips (default Regional)
    const scopeGrp = H.el("div", { class: "chip-group", title: "Report scope" });
    ["Regional", "In-Country", "Both"].forEach(v =>
      scopeGrp.appendChild(segChip(v, v, s.scope, val => State.set({ scope: val }))));
    row1.appendChild(labeled("Scope", scopeGrp));

    // range chips (default Forward 12mo)
    const rangeGrp = H.el("div", { class: "chip-group", title: "Time window" });
    [["All","all"],["History","history"],["Forward 12mo","forward12"]].forEach(([l,v]) =>
      rangeGrp.appendChild(segChip(l, v, s.range, val => State.set({ range: val }))));
    row1.appendChild(labeled("Window", rangeGrp));

    bar.appendChild(row1);

    // Row 2: multi-selects + city + dates
    const row2 = H.el("div", { class: "fb-row fb-row2" });
    row2.appendChild(multiSelect("Market", "markets", DataLayer.getMarkets().map(m => m.name), s.markets));
    row2.appendChild(multiSelect("Asset class", "assetClasses", cfg.ASSET_CLASSES, s.assetClasses));
    row2.appendChild(multiSelect("Type", "pubTypes", cfg.PUBLICATION_TYPES, s.pubTypes));
    row2.appendChild(multiSelect("Language", "languages", cfg.LANGUAGES, s.languages));
    row2.appendChild(multiSelect("Team", "teams", State.distinctTeams(all), s.teams));

    // ---- FUTURE STATUS MULTI-SELECT GOES HERE: ----
    //   row2.appendChild(multiSelect("Status", "statuses", cfg.STATUS_VALUES, s.statuses));
    // (Remember to add `statuses: []` to State and the filter in state.js.)

    const city = H.el("input", { class: "fb-city", type: "text",
      placeholder: "City / State…", value: s.cityState });
    let ct;
    city.addEventListener("input", e => {
      clearTimeout(ct); const v = e.target.value;
      ct = setTimeout(() => State.set({ cityState: v }), 180);
    });
    row2.appendChild(city);

    const from = H.el("input", { class: "fb-date", type: "date", value: s.dateFrom, title: "From date" });
    const to = H.el("input", { class: "fb-date", type: "date", value: s.dateTo, title: "To date" });
    from.addEventListener("change", e => State.set({ dateFrom: e.target.value }));
    to.addEventListener("change", e => State.set({ dateTo: e.target.value }));
    const dates = H.el("div", { class: "fb-dates" });
    dates.append(from, H.el("span", { class: "fb-dash" }, "→"), to);
    row2.appendChild(dates);

    const clear = H.el("button", { class: "btn-ghost fb-clear" }, "Clear");
    clear.addEventListener("click", resetFilters);
    row2.appendChild(clear);

    bar.appendChild(row2);
  }

  function labeled(label, node) {
    const w = H.el("div", { class: "fb-labeled" });
    w.append(H.el("span", { class: "fb-cap" }, label), node);
    return w;
  }

  function resetFilters() {
    const cfg = window.APP_CONFIG;
    State.set({
      markets: [], scope: cfg.DEFAULT_SCOPE, cityState: "", assetClasses: [],
      pubTypes: [], languages: [], teams: [], dateFrom: "", dateTo: "",
      range: cfg.DEFAULT_RANGE, search: ""
    });
  }

  // ===========================================================================
  // Market legend (visible from both views)
  // ===========================================================================
  function buildLegend() {
    const box = document.getElementById("legend");
    box.innerHTML = "";
    DataLayer.getMarkets().forEach(m => {
      const item = H.el("button", { class: "legend-item", title: `Filter to ${m.name}` });
      item.innerHTML = `<span class="mkt-dot" style="background:${m.fill}"></span>${H.esc(m.name)}`;
      item.addEventListener("click", () => {
        const s = State.get();
        const has = s.markets.includes(m.name);
        State.set({ markets: has ? s.markets.filter(x => x !== m.name) : s.markets.concat([m.name]) });
      });
      box.appendChild(item);
    });
  }

  // ===========================================================================
  // CSV export of the currently-filtered set (all columns)
  // ===========================================================================
  function exportCsv() {
    const rows = State.applyFilters(DataLayer.getAll());
    const cols = ["id","country","city_state","publication_name","asset_class",
      "publication_type","language","expected_publication_date","team","notes",
      "report_scope","status"];
    const escCsv = v => {
      if (Array.isArray(v)) v = v.join("; ");
      v = v == null ? "" : String(v);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const lines = [cols.join(",")].concat(
      rows.map(r => cols.map(c => escCsv(r[c])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = H.el("a", { href: url, download: `apac-publications-${State.todayISO()}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${rows.length} rows to CSV`);
  }

  // ===========================================================================
  // Tabs
  // ===========================================================================
  function buildTabs() {
    document.querySelectorAll(".tab").forEach(t => {
      t.addEventListener("click", () => State.set({ view: t.dataset.view }));
    });
  }
  function syncTabs() {
    const v = State.get().view;
    document.querySelectorAll(".tab").forEach(t =>
      t.classList.toggle("on", t.dataset.view === v));
  }

  // ===========================================================================
  // Render
  // ===========================================================================
  function rerender() {
    const s = State.get();
    syncTabs();
    const filtered = State.applyFilters(DataLayer.getAll());

    const mount = document.getElementById("viewMount");
    const rc = document.getElementById("resultCount");
    if (s.view === "table") {
      if (rc) rc.textContent = `${filtered.length} shown`;
      TableView.render(mount, filtered);
    } else if (s.view === "quarters") {
      if (rc) rc.textContent = `${filtered.length} in filter`;
      QuartersView.render(mount, filtered);
    } else if (s.view === "leadership") {
      if (rc) rc.textContent = `${filtered.length} shown`;
      LeadershipView.renderLeadershipView(mount, filtered);
    } else {
      // Calendar: clarify count so the month view isn't misread.
      const cm = s.calendarMonth;
      const inMonth = (cm && CalendarView.mode() === "month")
        ? filtered.filter(p => {
            const d = H.parseISO(p.expected_publication_date);
            return d.getFullYear() === cm.y && d.getMonth() === cm.m;
          }).length
        : null;
      if (rc) {
        rc.textContent = (CalendarView.mode() === "month" && inMonth !== null)
          ? `${inMonth} this month · ${filtered.length} in window`
          : `${filtered.length} in window`;
      }
      CalendarView.render(mount, filtered);
    }
  }

  function refreshFromData() {
    buildFilterBar();
    buildLegend();
    rerender();
  }

  // ===========================================================================
  // Boot
  // ===========================================================================
  async function boot() {
    if (booted) return; booted = true;
    State.readFromUrl();
    // initialise the calendar month BEFORE first render so the count label is
    // accurate on the initial paint.
    if (!State.get().calendarMonth) {
      const now = new Date();
      State.set({ calendarMonth: { y: now.getFullYear(), m: now.getMonth() } }, { silent: true });
    }
    try {
      await DataLayer.loadAll();
    } catch (err) {
      document.getElementById("viewMount").innerHTML =
        `<div class="stub"><h2>Could not load data</h2><p>${H.esc(err.message)}</p>
         <p>Check that <code>data/publications.json</code> and <code>data/markets.json</code> exist.</p></div>`;
      return;
    }

    buildTabs();
    buildFilterBar();
    buildLegend();

    document.getElementById("btnAdd").addEventListener("click", () => Form.open(null));
    document.getElementById("btnCsv").addEventListener("click", exportCsv);
    document.getElementById("btnLegend").addEventListener("click", () =>
      document.getElementById("legend").classList.toggle("open"));

    // mobile filter drawer toggle
    const fbToggle = document.getElementById("btnFilters");
    if (fbToggle) fbToggle.addEventListener("click", () =>
      document.getElementById("filterBar").classList.toggle("drawer-open"));

    // close popovers on outside click + Esc closes panels
    document.addEventListener("click", () =>
      document.querySelectorAll(".ms-pop.open").forEach(p => p.classList.remove("open")));
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { Detail.close(); Form.close(); }
    });

    // Rebuild the filter bar on state change so chip active-states reflect,
    // but preserve focus/caret on the text inputs the user is typing into.
    State.subscribe(() => {
      const active = document.activeElement;
      const reFocus = active && (active.classList.contains("fb-search") || active.classList.contains("fb-city"));
      const cls = reFocus ? (active.classList.contains("fb-search") ? "fb-search" : "fb-city") : null;
      const caret = reFocus ? active.selectionStart : null;
      buildFilterBar();
      if (cls) {
        const next = document.querySelector("." + cls);
        if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch (e) {} }
      }
      rerender();
    });
    rerender();
  }

  return { boot, rerender, refreshFromData, exportCsv, toast };
})();

document.addEventListener("DOMContentLoaded", App.boot);
