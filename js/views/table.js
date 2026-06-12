/* =============================================================================
 * views/table.js — TABLE VIEW
 * Dense, sortable table with all fields. Click row -> detail panel.
 * =========================================================================== */
const TableView = (() => {
  let sortKey = "expected_publication_date";
  let sortDir = 1; // 1 asc, -1 desc

  // column definitions. To ADD A STATUS COLUMN later, append:
  //   { key: "status", label: "Status", render: p => statusBadge(p.status) }
  // and add it to the sort handling. See docs/MAINTENANCE.md.
  const COLS = [
    { key: "expected_publication_date", label: "Date", cls: "tnum",
      render: p => H.fmtLong(p.expected_publication_date) },
    { key: "country", label: "Market",
      render: p => H.marketDot(p.country) + H.esc(p.country) },
    { key: "publication_name", label: "Publication", cls: "col-name",
      render: p => H.esc(p.publication_name) },
    { key: "city_state", label: "City / State", render: p => H.esc(p.city_state) },
    { key: "asset_class", label: "Asset Class",
      render: p => p.asset_class.map(a => `<span class="badge">${H.esc(a)}</span>`).join("") },
    { key: "publication_type", label: "Type", render: p => H.esc(p.publication_type) },
    { key: "language", label: "Language", render: p => H.esc(p.language) },
    { key: "team", label: "Team", render: p => H.esc(p.team) },
    { key: "report_scope", label: "Scope",
      render: p => `<span class="scope-tag scope-${p.report_scope==="Regional"?"reg":"loc"}">${H.esc(p.report_scope)}</span>` }
  ];

  function sortVal(p, key) {
    const v = p[key];
    if (Array.isArray(v)) return v.join(", ");
    return (v || "").toString().toLowerCase();
  }

  function render(mount, filtered) {
    mount.innerHTML = "";
    const rows = filtered.slice().sort((a, b) => {
      const av = sortVal(a, sortKey), bv = sortVal(b, sortKey);
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });

    const meta = H.el("div", { class: "tbl-meta" },
      `<strong>${rows.length}</strong> publication${rows.length===1?"":"s"}`);
    mount.appendChild(meta);

    const scroll = H.el("div", { class: "tbl-scroll" });
    const table = H.el("table", { class: "tbl" });
    const thead = H.el("thead");
    const htr = H.el("tr");
    COLS.forEach(c => {
      const th = H.el("th", { class: (c.cls || "") + (c.key===sortKey?" sorted":"") });
      th.innerHTML = `${c.label}<span class="sort-arrow">${c.key===sortKey?(sortDir>0?"▲":"▼"):""}</span>`;
      th.addEventListener("click", () => {
        if (sortKey === c.key) sortDir *= -1;
        else { sortKey = c.key; sortDir = 1; }
        App.rerender();
      });
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = H.el("tbody");
    if (!rows.length) {
      const tr = H.el("tr");
      tr.appendChild(H.el("td", { colspan: COLS.length, class: "tbl-empty" },
        "No publications match the current filters."));
      tbody.appendChild(tr);
    }
    rows.forEach(p => {
      const tr = H.el("tr", { "data-id": p.id, tabindex: "0" });
      if (H.isPast(p.expected_publication_date)) tr.classList.add("is-past");
      COLS.forEach(c => tr.appendChild(H.el("td", { class: c.cls || "" }, c.render(p))));
      tr.addEventListener("click", () => Detail.open(p.id));
      tr.addEventListener("keypress", e => { if (e.key === "Enter") Detail.open(p.id); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    mount.appendChild(scroll);
  }

  return { render };
})();
