/* =============================================================================
 * views/events.js — EVENTS TAB (2026-10-29)
 * All Savills events (data/events.json via SavillsEvents) as a table grouped
 * by month, chronological. Ignores the filter bar entirely. Clicking a row
 * opens the same EventPopover used by the calendar pills.
 * Columns: Date(s), Name, Type, Market, Venue, Organiser, Audience, Link.
 * =========================================================================== */
const EventsView = (() => {
  const COLS = [
    { label: "Date(s)",   cls: "tnum ev-col-date", render: ev => H.esc(SavillsEvents.fmtRange(ev)) },
    { label: "Name",      cls: "col-name",
      render: ev => `<span class="sev-dot" aria-hidden="true"></span> <span class="ev-name">${H.esc(ev.name)}</span>` },
    { label: "Type",      render: ev => H.esc(ev.event_type) },
    { label: "Market",    render: ev => H.esc(ev.market) },
    { label: "Venue",     render: ev => H.esc(ev.venue) },
    { label: "Organiser", render: ev => H.esc(ev.organiser) },
    { label: "Audience",  render: ev => H.esc(ev.audience) },
    { label: "Link",
      render: ev => /^https?:\/\//i.test(ev.link || "")
        ? `<a class="sev-pop-link ev-link" href="${H.esc(ev.link)}" target="_blank" rel="noopener noreferrer">Open ↗</a>`
        : "" }
  ];

  function count() {
    return (typeof SavillsEvents !== "undefined") ? SavillsEvents.all().length : 0;
  }

  function render(mount) {
    mount.innerHTML = "";
    const events = (typeof SavillsEvents !== "undefined") ? SavillsEvents.all() : [];

    mount.appendChild(H.el("div", { class: "tbl-meta" },
      `<strong>${events.length}</strong> Savills event${events.length === 1 ? "" : "s"} · ` +
      `always shown; not affected by the filter bar`));

    const scroll = H.el("div", { class: "tbl-scroll" });
    const table = H.el("table", { class: "tbl ev-tbl" });
    const htr = H.el("tr");
    COLS.forEach(c => htr.appendChild(H.el("th", { class: c.cls || "" }, c.label)));
    const thead = H.el("thead"); thead.appendChild(htr); table.appendChild(thead);

    const tbody = H.el("tbody");
    if (!events.length) {
      const tr = H.el("tr");
      tr.appendChild(H.el("td", { colspan: COLS.length, class: "tbl-empty" },
        "No Savills events yet. Add one to <code>data/events.json</code> (see README)."));
      tbody.appendChild(tr);
    }

    let curKey = null;
    events.forEach(ev => {
      const d = H.parseISO(ev.start_date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (key !== curKey) {
        curKey = key;
        const n = events.filter(e => {
          const ed = H.parseISO(e.start_date);
          return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
        }).length;
        const mr = H.el("tr", { class: "ev-month-row" });
        mr.appendChild(H.el("td", { colspan: COLS.length },
          `${H.MONTHS[d.getMonth()]} ${d.getFullYear()} <span class="strip-count">${n}</span>`));
        tbody.appendChild(mr);
      }
      const tr = H.el("tr", {
        class: "ev-row", tabindex: "0", "data-ev-id": ev.id,
        "aria-haspopup": "dialog", "aria-expanded": "false",
        title: "Show event details"
      });
      COLS.forEach(c => tr.appendChild(H.el("td", { class: c.cls || "" }, c.render(ev))));
      // anchor to the Name cell so the card sits under the event name
      const open = () => EventPopover.open(ev, tr.querySelector(".col-name") || tr);
      tr.addEventListener("click", e => {
        if (e.target.closest("a")) return;          // link opens in a new tab only
        e.stopPropagation(); open();
      });
      tr.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    mount.appendChild(scroll);
  }

  return { render, count };
})();
