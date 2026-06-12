/* =============================================================================
 * quarters.js — QUARTERS KANBAN VIEW
 * Rolls up the currently-filtered set into a forward-looking kanban board
 * grouped by calendar quarter (e.g. Q3 2026, Q4 2026, Q1 2027 …).
 * Each card is a publication. Click → opens the same Detail side panel.
 *
 * Design notes
 *   - Forward-only by definition: the board always shows from "current quarter"
 *     onward, regardless of the History/Forward chip. (Anything already in the
 *     past is hidden here; use Table or Calendar for retrospective views.)
 *   - Columns span the next N quarters (default 6 = 18 months horizon, which
 *     comfortably covers the forward-12mo window plus the spillover quarter).
 *   - Within a column, cards are sorted by date ascending, with the soonest
 *     publication's month subheading inserted as a divider for scanability.
 *   - Cards are coloured by a left market accent stripe, matching the rest of
 *     the app's market-coloured language. Asset class badges sit underneath.
 *
 * The Status field (future) is rendered if present so this view is forward-
 * compatible — see the // STATUS hook below.
 * =========================================================================== */
const QuartersView = (() => {
  const HORIZON_QUARTERS = 6; // ~18 months of forward planning

  // ---- quarter helpers ----
  // Quarter key: "YYYY-Qn"  (n = 1..4)
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

  // ---- one publication card ----
  function card(p) {
    const m = DataLayer.getMarket(p.country);
    const c = H.el("article", {
      class: "qk-card",
      style: `--mkt:${m.fill}`,
      tabindex: "0",
      role: "button",
      title: "Open details"
    });

    // header: market name + date
    const head = H.el("div", { class: "qk-head" });
    head.innerHTML =
      `<span class="qk-mkt"><span class="mkt-dot" style="background:${m.fill}"></span>${H.esc(p.country)}</span>` +
      `<span class="qk-date tnum">${H.esc(H.fmtLong(p.expected_publication_date))}</span>`;
    c.appendChild(head);

    // title
    c.appendChild(H.el("h4", { class: "qk-title" }, H.esc(p.publication_name)));

    // meta line: type · language · team
    const meta = [p.publication_type, p.language, p.team].filter(Boolean).join(" · ");
    if (meta) c.appendChild(H.el("div", { class: "qk-meta" }, H.esc(meta)));

    // asset class badges
    if (p.asset_class && p.asset_class.length) {
      const badges = H.el("div", { class: "qk-badges" });
      p.asset_class.forEach(a => badges.appendChild(H.badge(a)));
      c.appendChild(badges);
    }

    // scope pill (Regional vs In-Country) + future Status
    const tags = H.el("div", { class: "qk-tags" });
    tags.appendChild(H.el("span", { class: "qk-scope" }, H.esc(p.report_scope || "—")));
    // -----------------------------------------------------------------------
    // FUTURE STATUS BADGE GOES HERE:
    //   if (p.status) tags.appendChild(H.el("span",
    //     { class: "qk-status qk-status-" + p.status.replace(/\s+/g,"-") },
    //     H.esc(p.status)));
    // -----------------------------------------------------------------------
    c.appendChild(tags);

    // open detail on click / enter
    const open = () => Detail.open(p);
    c.addEventListener("click", open);
    c.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    return c;
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
      // sort by date ascending; insert month subheaders for scanability
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

  // ---- main render ----
  function render(mount, filtered) {
    mount.innerHTML = "";

    // Build the forward horizon and bucket records into it.
    const quarters = nextQuarters(HORIZON_QUARTERS);
    const allowed = new Set(quarters.map(q => q.key));
    const buckets = Object.fromEntries(quarters.map(q => [q.key, []]));

    let hiddenPast = 0;
    filtered.forEach(p => {
      const qk = quarterOf(p.expected_publication_date).key;
      if (!allowed.has(qk)) {
        if (p.expected_publication_date < State.todayISO()) hiddenPast++;
        // forward records beyond the horizon are silently dropped — note in toolbar
        return;
      }
      buckets[qk].push(p);
    });

    // Toolbar / context strip
    const tb = H.el("div", { class: "qk-toolbar" });
    const lead = H.el("div", { class: "qk-lead" });
    lead.innerHTML =
      `<strong>Quarterly planning</strong> · forward ${HORIZON_QUARTERS} quarters` +
      `<span class="qk-lead-sub">Click any card for full details. Filters above apply.</span>`;
    tb.appendChild(lead);

    const totalForward = quarters.reduce((s, q) => s + buckets[q.key].length, 0);
    const meta = H.el("div", { class: "qk-meta-strip tnum" });
    meta.innerHTML = `${totalForward} publication${totalForward === 1 ? "" : "s"} across ${HORIZON_QUARTERS} quarters` +
      (hiddenPast ? ` · <span class="qk-muted">${hiddenPast} past hidden</span>` : "");
    tb.appendChild(meta);
    mount.appendChild(tb);

    // Board
    const board = H.el("div", { class: "qk-board" });
    quarters.forEach(q => board.appendChild(column(q, buckets[q.key])));
    mount.appendChild(board);

    // Empty state
    if (totalForward === 0) {
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
