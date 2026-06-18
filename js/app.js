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

    // Row 1: scope + range + holiday controls.
    // (Search now lives next to the view tabs in the topbar — see wireTopSearch.)
    const row1 = H.el("div", { class: "fb-row" });

    // scope chips (default Both)
    const scopeGrp = H.el("div", { class: "chip-group", title: "Report scope" });
    ["Regional", "In-Country", "Both"].forEach(v =>
      scopeGrp.appendChild(segChip(v, v, s.scope, val => State.set({ scope: val }))));
    row1.appendChild(labeled("Scope", scopeGrp));

    // range chips (default Forward 12mo)
    const rangeGrp = H.el("div", { class: "chip-group", title: "Time window" });
    [["All","all"],["History","history"],["Forward 12mo","forward12"]].forEach(([l,v]) =>
      rangeGrp.appendChild(segChip(l, v, s.range, val => State.set({ range: val }))));
    row1.appendChild(labeled("Window", rangeGrp));

    // ---- Holiday controls (2026-06-18): toggle + market selector ----
    // Holidays are a secondary layer; shown by default on first load.
    const holToggleGrp = H.el("div", { class: "chip-group", title: "Show / hide public holidays" });
    [["On", true], ["Off", false]].forEach(([lbl, val]) =>
      holToggleGrp.appendChild(
        segChip(lbl, val, s.holidaysOn, v => State.set({ holidaysOn: v }))));
    row1.appendChild(labeled("Holidays", holToggleGrp));

    if (s.holidaysOn && typeof Holidays !== "undefined") {
      const hMarkets = Holidays.marketList();
      row1.appendChild(labeled("Holiday markets",
        multiSelect("Markets", "holidayMarkets", hMarkets, s.holidayMarkets)));
    }

    bar.appendChild(row1);

    // Row 2: multi-selects + city + dates
    const row2 = H.el("div", { class: "fb-row fb-row2" });
    // Filter options are derived dynamically from the loaded dataset so they
    // always reflect the master spreadsheet (cfg lists are ordering hints only).
    row2.appendChild(multiSelect("Market", "markets", DataLayer.getMarkets().map(m => m.name), s.markets));
    row2.appendChild(multiSelect("Asset class", "assetClasses", DataLayer.distinctAssetClasses(), s.assetClasses));
    row2.appendChild(multiSelect("Type", "pubTypes", DataLayer.distinctPubTypes(), s.pubTypes));
    row2.appendChild(multiSelect("Language", "languages", DataLayer.distinctLanguages(), s.languages));
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
      // Note: holiday on/off + holiday markets are intentionally NOT reset by
      // the publication Clear button — they are a separate display layer.
    });
    const ts = document.getElementById("topSearch");
    if (ts) ts.value = "";
  }

  // ---- Shared topbar search wiring (persistent input, not rebuilt) ----
  function wireTopSearch() {
    const input = document.getElementById("topSearch");
    if (!input) return;
    input.value = State.get().search || "";
    let t;
    input.addEventListener("input", e => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(() => State.set({ search: v }), 180);
    });
  }

  // ===========================================================================
  // Scope legend (two-tone). The colour system is now scope-based, not
  // per-market — yellow = Regional, steel grey = In-Country.
  // ===========================================================================
  function buildLegend() {
    // Legend is now a click-to-open tooltip popover anchored to the Legend
    // button (2026-06-18). Same content, rendered into #legendTip.
    const box = document.getElementById("legendTip");
    if (!box) return;
    box.innerHTML = "";
    const items = [
      { scope: "Regional",   label: "Regional reports",   c: { fill: "#FFDF00", text: "#25273A" } },
      { scope: "In-Country", label: "In-Country reports", c: { fill: "#79828C", text: "#FFFFFF" } }
    ];
    items.forEach(it => {
      const item = H.el("button", {
        class: "legend-item",
        title: `Filter to ${it.label}`
      });
      item.innerHTML =
        `<span class="legend-swatch" style="background:${it.c.fill}"></span>` +
        `<span class="legend-label">${H.esc(it.label)}</span>`;
      item.addEventListener("click", () => { State.set({ scope: it.scope }); closeLegend(); });
      box.appendChild(item);
    });
    // dotted swatch = recurring instance
    const rec = H.el("span", { class: "legend-item legend-static", title: "Recurring instance" });
    rec.innerHTML =
      `<span class="legend-swatch legend-swatch-rec" aria-hidden="true"></span>` +
      `<span class="legend-label">↻ Recurring instance</span>`;
    box.appendChild(rec);
    // holiday swatch = public holiday day (shaded cell)
    const hol = H.el("span", { class: "legend-item legend-static", title: "Public holiday" });
    hol.innerHTML =
      `<span class="legend-swatch legend-swatch-hol" aria-hidden="true"></span>` +
      `<span class="legend-label">Public holiday (shaded day)</span>`;
    box.appendChild(hol);
  }

  function openLegend() {
    const tip = document.getElementById("legendTip");
    const btn = document.getElementById("btnLegend");
    if (!tip) return;
    tip.classList.add("open");
    tip.setAttribute("aria-hidden", "false");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }
  function closeLegend() {
    const tip = document.getElementById("legendTip");
    const btn = document.getElementById("btnLegend");
    if (!tip) return;
    tip.classList.remove("open");
    tip.setAttribute("aria-hidden", "true");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function toggleLegend() {
    const tip = document.getElementById("legendTip");
    if (tip && tip.classList.contains("open")) closeLegend(); else openLegend();
  }

  // ===========================================================================
  // TBD side panel (collapsible right-edge drawer). Shows publications whose
  // date is unknown so they don't disappear off the calendar. Available on
  // every tab.
  // ===========================================================================
  function buildTbdPanel() {
    let panel = document.getElementById("tbdPanel");
    if (!panel) {
      panel = H.el("aside", { id: "tbdPanel", class: "tbd-panel",
        "aria-label": "TBD publications" });
      document.body.appendChild(panel);
      // floating toggle button (lives outside the panel so it stays visible)
      const tog = H.el("button", {
        id: "tbdToggle", class: "tbd-toggle",
        title: "Show publications with no date (TBD)",
        "aria-controls": "tbdPanel", "aria-expanded": "false"
      });
      tog.innerHTML = `<span class="tbd-toggle-num tnum">0</span> TBD`;
      document.body.appendChild(tog);
      tog.addEventListener("click", () => {
        const open = panel.classList.toggle("open");
        tog.setAttribute("aria-expanded", open ? "true" : "false");
        document.body.classList.toggle("tbd-open", open);
      });
    }
    const tbd = DataLayer.getTBD();
    document.getElementById("tbdToggle")
      .querySelector(".tbd-toggle-num").textContent = String(tbd.length);

    panel.innerHTML = "";
    const head = H.el("div", { class: "tbd-head" });
    head.innerHTML =
      `<div class="tbd-title">TBD <span class="tbd-count tnum">${tbd.length}</span></div>` +
      `<div class="tbd-sub">Publications without a confirmed date. Click any to open detail and set a date.</div>`;
    const close = H.el("button", { class: "btn-icon tbd-close", title: "Close" }, "✕");
    close.addEventListener("click", () => {
      panel.classList.remove("open");
      document.body.classList.remove("tbd-open");
      const t = document.getElementById("tbdToggle");
      if (t) t.setAttribute("aria-expanded", "false");
    });
    head.appendChild(close);
    panel.appendChild(head);

    const body = H.el("div", { class: "tbd-body" });
    if (!tbd.length) {
      body.appendChild(H.el("div", { class: "tbd-empty" },
        "No TBD publications. Everything has a date."));
    } else {
      tbd.forEach(p => {
        const c = DataLayer.colourFor(p);
        const card = H.el("article", {
          class: "tbd-card",
          style: `--scope:${c.fill};`,
          tabindex: "0",
          role: "button",
          title: "Open detail"
        });
        const tags = [p.country, p.publication_type, p.frequency]
          .filter(Boolean).join(" · ");
        card.innerHTML =
          `<div class="tbd-card-head">` +
            `<span class="chip mkt-chip" style="background:${c.fill};color:${c.text};">${H.esc(p.country)}</span>` +
            `<span class="tbd-card-tag">${H.esc(p.frequency || "Ad Hoc")}</span>` +
          `</div>` +
          `<h4 class="tbd-card-title">${H.esc(p.publication_name)}</h4>` +
          `<div class="tbd-card-meta">${H.esc(tags)}</div>` +
          (p.notes ? `<div class="tbd-card-notes">${H.esc(p.notes)}</div>` : "");
        const open = () => Detail.open(p.id);
        card.addEventListener("click", open);
        card.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        });
        body.appendChild(card);
      });
    }
    panel.appendChild(body);
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
    if (s.view === "usage") {
      if (rc) rc.textContent = "";
      UsageView.render(mount);
    } else if (s.view === "table") {
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
    buildTbdPanel();
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
    buildTbdPanel();

    document.getElementById("btnAdd").addEventListener("click", () => Form.open(null));
    document.getElementById("btnCsv").addEventListener("click", exportCsv);
    document.getElementById("btnLegend").addEventListener("click", e => {
      e.stopPropagation();
      toggleLegend();
    });

    // ---- Shared topbar search (drives State.search for every view) ----
    wireTopSearch();

    // ---- Load holiday data (non-blocking; calendar reads it when ready) ----
    if (typeof Holidays !== "undefined") {
      Holidays.load().then(() => { if (State.get().view === "calendar") rerender(); })
        .catch(() => {/* holidays optional; app still works without them */});
    }

    // ---- Record this page-open for usage tracking (best-effort) ----
    if (typeof Usage !== "undefined") Usage.recordOpen();

    // ---- Theme toggle (light <-> dark). Dark is default; preference is
    // persisted via localStorage when the host allows it. -----------------
    const themeBtn = document.getElementById("btnTheme");
    function applyThemeIcon() {
      const t = document.documentElement.getAttribute("data-theme") || "dark";
      if (!themeBtn) return;
      // crescent ☾ when in dark (offers to switch to light),
      // sun ☀ when in light (offers to switch to dark)
      themeBtn.querySelector(".icon").textContent = (t === "dark") ? "\u263E" : "\u2600";
      themeBtn.setAttribute("title", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
    }
    applyThemeIcon();
    if (themeBtn) themeBtn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("apac-theme", next); } catch (e) { /* sandbox */ }
      applyThemeIcon();
    });

    // mobile filter drawer toggle
    const fbToggle = document.getElementById("btnFilters");
    if (fbToggle) fbToggle.addEventListener("click", () =>
      document.getElementById("filterBar").classList.toggle("drawer-open"));

    // close popovers on outside click + Esc closes panels
    document.addEventListener("click", e => {
      document.querySelectorAll(".ms-pop.open").forEach(p => p.classList.remove("open"));
      // close the legend tooltip when clicking outside it / its button
      const lw = e.target.closest && e.target.closest(".legend-wrap");
      if (!lw) closeLegend();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { Detail.close(); Form.close(); closeLegend(); }
    });

    // Rebuild the filter bar on state change so chip active-states reflect,
    // but preserve focus/caret on the text inputs the user is typing into.
    State.subscribe(() => {
      // The topbar search input is persistent (not rebuilt) so it never loses
      // focus. Only the in-bar City/State field is rebuilt; preserve its caret.
      const active = document.activeElement;
      const reFocus = active && active.classList.contains("fb-city");
      const caret = reFocus ? active.selectionStart : null;
      buildFilterBar();
      if (reFocus) {
        const next = document.querySelector(".fb-city");
        if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch (e) {} }
      }
      // keep the persistent topbar search box in sync if state.search changed
      const ts = document.getElementById("topSearch");
      if (ts && ts !== active && ts.value !== (State.get().search || "")) {
        ts.value = State.get().search || "";
      }
      rerender();
    });
    rerender();
  }

  return { boot, rerender, refreshFromData, exportCsv, toast };
})();

document.addEventListener("DOMContentLoaded", App.boot);
