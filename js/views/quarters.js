/* =============================================================================
 * quarters.js — QUARTERS KANBAN VIEW
 * Rolls up the currently-filtered set into a forward-looking kanban board
 * grouped by calendar quarter (e.g. Q3 2026, Q4 2026, Q1 2027 …) plus a
 * dedicated TBD column at the right for date-less publications.
 *
 * Cards collapse to title-only by default. Clicking the title toggles the
 * expanded card showing date, market, asset, scope, etc. A separate "Open
 * details" affordance still opens the full Detail panel for editing/copy.
 *
 * Updated 2026-06-15:
 *   - Scope-based colours (DataLayer.colourFor) replace per-market palette
 *   - Cards collapse to title; toggle on click; secondary button opens detail
 *   - Trailing TBD column for publications with no date set
 *   - Recurring instances show ↻ glyph next to title
 * =========================================================================== */
const QuartersView = (() => {
  const HORIZON_QUARTERS = 6; // ~18 months of forward planning

  // ---- quarter helpers ----
  function quarterOf(iso) {
    const d = H.parseISO(iso);
    const q = Math.floor(d.getMonth() / 3) + 1;
    return { y: d.getFullYear(), q, key: `${d.getFullYear()}-Q${q}` };
  }
  function currentQuarter() {
    const d = new Date();
    return { y: d.getFullYear(), q: Math.floor(d.getMonth() / 3) + 1 };
  }
  function nextQuarters(n) {
    const out = [];
    let { y, q } = currentQuarter();
    for (let i = 0; i < n; i++) {
      out.push({ y, q, key: `${y}-Q${q}` });
      q++; if (q > 4) { q = 1; y++; }
    }
    return out;
  }
  function quarterLabel({ y, q }) {
    const months = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"][q - 1];
    return { title: `Q${q} ${y}`, sub: months };
  }

  // ---- one publication card (collapsed by default) ----
  function card(p) {
    const c = DataLayer.colourFor(p);
    const isRec = !!p.recurring;
    const recIcon = isRec ? '<span class="qk-rec" aria-hidden="true">↻</span>' : "";

    const cardEl = H.el("article", {
      class: "qk-card collapsed" + (isRec ? " is-recurring" : ""),
      style: `--scope:${c.fill};--scope-text:${c.text};`,
      tabindex: "0",
      role: "button",
      "aria-expanded": "false",
      title: "Click to expand"
    });

    // Collapsed view — title only
    const titleRow = H.el("div", { class: "qk-card-title-row" });
    titleRow.innerHTML =
      `<span class="qk-card-date tnum">${p.expected_publication_date ? H.parseISO(p.expected_publication_date).getDate() : ""}</span>` +
      `<span class="qk-card-title">${recIcon}${H.esc(p.publication_name)}</span>` +
      `<span class="qk-card-caret" aria-hidden="true">▾</span>`;
    cardEl.appendChild(titleRow);

    // Expanded body — hidden until .expanded
    const body = H.el("div", { class: "qk-card-body" });

    const head = H.el("div", { class: "qk-head" });
    head.innerHTML =
      `<span class="qk-mkt"><span class="mkt-dot" style="background:${c.fill}"></span>${H.esc(p.country)}${p.city_state ? ` <span class="qk-city">· ${H.esc(p.city_state)}</span>` : ""}</span>` +
      `<span class="qk-date tnum">${p.expected_publication_date ? H.esc(H.fmtLong(p.expected_publication_date)) : "TBD"}</span>`;
    body.appendChild(head);

    // meta line: type · language · team
    const meta = [p.publication_type, p.language, p.team].filter(Boolean).join(" · ");
    if (meta) body.appendChild(H.el("div", { class: "qk-meta" }, H.esc(meta)));

    // asset class badges
    if (p.asset_class && p.asset_class.length) {
      const badges = H.el("div", { class: "qk-badges" });
      p.asset_class.forEach(a => badges.appendChild(H.badge(a)));
      body.appendChild(badges);
    }

    // scope pill (Regional vs In-Country) + Frequency
    const tags = H.el("div", { class: "qk-tags" });
    tags.appendChild(H.el("span", { class: "qk-scope" }, H.esc(p.report_scope || "—")));
    if (p.frequency) {
      tags.appendChild(H.el("span", { class: "qk-freq" }, H.esc(p.frequency)));
    }
    body.appendChild(tags);

    // Open-detail link
    const openBtn = H.el("button", { class: "qk-card-open", type: "button" }, "Open details →");
    openBtn.addEventListener("click", e => {
      e.stopPropagation();
      Detail.open(p.id);
    });
    body.appendChild(openBtn);

    cardEl.appendChild(body);

    // Toggle expand/collapse on click of the card itself (not the inner button)
    const toggle = e => {
      // Ignore clicks bubbling up from the Open Details button
      if (e.target.closest(".qk-card-open")) return;
      const expanded = cardEl.classList.toggle("expanded");
      cardEl.classList.toggle("collapsed", !expanded);
      cardEl.setAttribute("aria-expanded", expanded ? "true" : "false");
    };
    cardEl.addEventListener("click", toggle);
    cardEl.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); }
    });

    return cardEl;
  }

  // ---- one column ----
  function column(qDef, items) {
    const col = H.el("section", { class: "qk-col", "data-q": qDef.key });
    const { title, sub } = quarterLabel(qDef);

    // header
    const head = H.el("header", { class: "qk-col-head" });
    head.innerHTML =
      `<div class="qk-col-title">${H.esc(title)}` +
      `<span class="qk-col-sub">${H.esc(sub)}</span></div>` +
      `<span class="qk-col-count tnum" title="Publications in this quarter">${items.length}</span>`;
    col.appendChild(head);

    // body
    const body = H.el("div", { class: "qk-col-body" });
    if (!items.length) {
      body.appendChild(H.el("div", { class: "qk-empty" }, "No publications planned"));
    } else {
      items.sort((a, b) => a.expected_publication_date.localeCompare(b.expected_publication_date));
      let lastMonth = -1;
      items.forEach(p => {
        const d = H.parseISO(p.expected_publication_date);
        if (d.getMonth() !== lastMonth) {
          lastMonth = d.getMonth();
          body.appendChild(H.el("div", { class: "qk-month" },
            `${H.MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`));
        }
        body.appendChild(card(p));
      });
    }
    col.appendChild(body);
    return col;
  }

  // ---- TBD column (rightmost) ----
  function tbdColumn(items) {
    const col = H.el("section", { class: "qk-col qk-col-tbd", "data-q": "TBD" });
    const head = H.el("header", { class: "qk-col-head" });
    head.innerHTML =
      `<div class="qk-col-title">TBD` +
      `<span class="qk-col-sub">No date set</span></div>` +
      `<span class="qk-col-count tnum" title="Publications without a date">${items.length}</span>`;
    col.appendChild(head);

    const body = H.el("div", { class: "qk-col-body" });
    if (!items.length) {
      body.appendChild(H.el("div", { class: "qk-empty" }, "No TBD publications"));
    } else {
      items.forEach(p => body.appendChild(card(p)));
    }
    col.appendChild(body);
    return col;
  }

  // ---- main render ----
  function render(mount, filtered) {
    mount.innerHTML = "";

    // Build the forward horizon and bucket records into it.
    const quarters = nextQuarters(HORIZON_QUARTERS);
    const allowed = new Set(quarters.map(q => q.key));
    const buckets = Object.fromEntries(quarters.map(q => [q.key, []]));

    let hiddenPast = 0;
    filtered.forEach(p => {
      if (!p.expected_publication_date) return;
      const qk = quarterOf(p.expected_publication_date).key;
      if (!allowed.has(qk)) {
        if (p.expected_publication_date < State.todayISO()) hiddenPast++;
        return;
      }
      buckets[qk].push(p);
    });

    // TBD publications (excluded from main filter pipeline but surfaced here).
    // We respect the scope and other filters as best we can — TBD rows still
    // carry scope/asset_class/etc — but date filters are obviously irrelevant.
    const tbdAll = DataLayer.getTBD();
    const s = State.get();
    const tbd = tbdAll.filter(p => {
      if (s.scope !== "Both" && p.report_scope !== s.scope) return false;
      if (s.markets.length && !s.markets.includes(p.country)) return false;
      if (s.assetClasses.length &&
          !p.asset_class.some(a => s.assetClasses.includes(a))) return false;
      if (s.pubTypes.length && !s.pubTypes.includes(p.publication_type)) return false;
      if (s.languages.length && !s.languages.includes(p.language)) return false;
      if (s.teams.length && !s.teams.includes(p.team)) return false;
      const term = s.search.trim().toLowerCase();
      if (term) {
        const hay = [p.publication_name, p.notes, p.city_state, p.team]
          .join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });

    // Toolbar / context strip
    const tb = H.el("div", { class: "qk-toolbar" });
    const lead = H.el("div", { class: "qk-lead" });
    lead.innerHTML =
      `<strong>Quarterly planning</strong> · forward ${HORIZON_QUARTERS} quarters` +
      `<span class="qk-lead-sub">Click a card to expand; click Open details for full record.</span>`;
    tb.appendChild(lead);

    const totalForward = quarters.reduce((s, q) => s + buckets[q.key].length, 0);
    const meta = H.el("div", { class: "qk-meta-strip tnum" });
    meta.innerHTML = `${totalForward} scheduled · ${tbd.length} TBD across ${HORIZON_QUARTERS} quarters` +
      (hiddenPast ? ` · <span class="qk-muted">${hiddenPast} past hidden</span>` : "");
    tb.appendChild(meta);
    mount.appendChild(tb);

    // Board
    const board = H.el("div", { class: "qk-board" });
    quarters.forEach(q => board.appendChild(column(q, buckets[q.key])));
    board.appendChild(tbdColumn(tbd));
    mount.appendChild(board);

    // Empty state
    if (totalForward === 0 && tbd.length === 0) {
      const empty = H.el("div", { class: "qk-empty-state" });
      empty.innerHTML =
        `<h3>No upcoming publications</h3>` +
        `<p>Nothing matches the current filters in the next ${HORIZON_QUARTERS} quarters. ` +
        `Try widening the scope, clearing filters, or switching to the Table view to see history.</p>`;
      mount.appendChild(empty);
    }
  }

  return { render };
})();
