/* =============================================================================
 * views/calendar.js — CALENDAR VIEW
 * Month grid. Publications coloured BY MARKET. Click event -> detail panel.
 * Month nav (prev / next / Today / month picker) + single-click forward-12-mo
 * "Strip" alternate layout (12 stacked mini-month lists).
 * =========================================================================== */
const CalendarView = (() => {
  let mountEl = null;
  let mode = "month";   // month | strip(forward12)

  function ensureMonth() {
    const s = State.get();
    if (!s.calendarMonth) {
      const now = new Date();
      State.set({ calendarMonth: { y: now.getFullYear(), m: now.getMonth() } }, { silent: true });
    }
  }

  function eventsByDate(filtered) {
    const map = {};
    filtered.forEach(p => {
      (map[p.expected_publication_date] ||= []).push(p);
    });
    return map;
  }

  // -------- styling for a calendar event pill (market colour) --------
  // FUTURE STATUS STYLING HOOK:
  //   if (p.status === "delayed") add a red urgent flag here.
  //   See docs/MAINTENANCE.md -> "Introducing the Status field".
  function eventPill(p) {
    const m = DataLayer.getMarket(p.country);
    const pill = H.el("button", {
      class: "cal-evt",
      style: `background:${m.fill};color:${m.text};`,
      "data-id": p.id,
      title: `${p.publication_name} — ${p.country}`
    }, H.esc(p.publication_name));
    pill.addEventListener("click", e => { e.stopPropagation(); Detail.open(p.id); });
    return pill;
  }

  function renderMonthGrid(filtered) {
    const s = State.get();
    const { y, m } = s.calendarMonth;
    const evts = eventsByDate(filtered);
    const today = State.todayISO();

    const wrap = H.el("div", { class: "cal-month" });

    // weekday header (Mon-first)
    const wk = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const head = H.el("div", { class: "cal-weekhead" });
    wk.forEach(d => head.appendChild(H.el("div", { class: "cal-wk" }, d)));
    wrap.appendChild(head);

    const grid = H.el("div", { class: "cal-grid" });
    const first = new Date(y, m, 1);
    // Mon=0 offset
    let startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();

    const cells = [];
    for (let i = 0; i < startOffset; i++)
      cells.push({ day: prevDays - startOffset + 1 + i, out: true, y, m: m - 1 });
    for (let d = 1; d <= daysInMonth; d++)
      cells.push({ day: d, out: false, y, m });
    while (cells.length % 7 !== 0 || cells.length < 35)
      cells.push({ day: cells.length - (startOffset + daysInMonth) + 1, out: true, y, m: m + 1 });

    cells.forEach(c => {
      const cy = c.m < 0 ? y - 1 : c.m > 11 ? y + 1 : y;
      const cm = (c.m + 12) % 12;
      const iso = `${cy}-${String(cm+1).padStart(2,"0")}-${String(c.day).padStart(2,"0")}`;
      const cell = H.el("div", { class: "cal-cell" + (c.out ? " out" : "") });
      const isToday = iso === today;
      if (isToday) cell.classList.add("today");
      const dnum = H.el("div", { class: "cal-daynum" }, String(c.day));
      if (isToday) dnum.classList.add("is-today");
      cell.appendChild(dnum);

      const dayEvts = evts[iso] || [];
      const list = H.el("div", { class: "cal-evts" });
      dayEvts.slice(0, 4).forEach(p => list.appendChild(eventPill(p)));
      if (dayEvts.length > 4) {
        const more = H.el("button", { class: "cal-more" }, `+${dayEvts.length - 4} more`);
        more.addEventListener("click", () => Detail.openList(dayEvts, iso));
        list.appendChild(more);
      }
      cell.appendChild(list);
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // -------- forward-12-month strip (single click) --------
  function renderStrip(allFiltered) {
    const wrap = H.el("div", { class: "cal-strip" });
    const start = new Date(); start.setDate(1);
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const y = d.getFullYear(), m = d.getMonth();
      const monthEvts = allFiltered.filter(p => {
        const pd = H.parseISO(p.expected_publication_date);
        return pd.getFullYear() === y && pd.getMonth() === m;
      }).sort((a,b) => a.expected_publication_date.localeCompare(b.expected_publication_date));

      const col = H.el("div", { class: "strip-month" });
      col.appendChild(H.el("div", { class: "strip-head" },
        `${H.MONTHS_SHORT[m]} ${y} <span class="strip-count">${monthEvts.length}</span>`));
      const body = H.el("div", { class: "strip-body" });
      if (!monthEvts.length) body.appendChild(H.el("div", { class: "strip-empty" }, "—"));
      monthEvts.forEach(p => {
        const m2 = DataLayer.getMarket(p.country);
        const row = H.el("button", {
          class: "strip-evt",
          style: `border-left-color:${m2.fill};`,
          "data-id": p.id
        }, `<span class="strip-date">${H.parseISO(p.expected_publication_date).getDate()}</span>
            <span class="strip-name">${H.esc(p.publication_name)}</span>
            <span class="mkt-dot" style="background:${m2.fill}"></span>`);
        row.addEventListener("click", () => Detail.open(p.id));
        body.appendChild(row);
      });
      col.appendChild(body);
      wrap.appendChild(col);
    }
    return wrap;
  }

  function toolbar() {
    const s = State.get();
    const { y, m } = s.calendarMonth;
    const bar = H.el("div", { class: "cal-toolbar" });

    const left = H.el("div", { class: "cal-tb-left" });
    const prev = H.el("button", { class: "btn-icon", title: "Previous month" }, "‹");
    const next = H.el("button", { class: "btn-icon", title: "Next month" }, "›");
    const todayBtn = H.el("button", { class: "btn-ghost" }, "Today");
    prev.addEventListener("click", () => stepMonth(-1));
    next.addEventListener("click", () => stepMonth(1));
    todayBtn.addEventListener("click", () => {
      const n = new Date();
      State.set({ calendarMonth: { y: n.getFullYear(), m: n.getMonth() } });
    });

    // month picker
    const picker = H.el("input", { type: "month", class: "cal-monthpick",
      value: `${y}-${String(m+1).padStart(2,"0")}` });
    picker.addEventListener("change", e => {
      const [yy, mm] = e.target.value.split("-").map(Number);
      State.set({ calendarMonth: { y: yy, m: mm - 1 } });
    });

    left.append(prev, next, todayBtn,
      H.el("div", { class: "cal-title" }, `${H.MONTHS[m]} ${y}`), picker);

    const right = H.el("div", { class: "cal-tb-right" });
    const monthBtn = H.el("button", { class: "seg" + (mode==="month"?" on":"") }, "Month");
    const stripBtn = H.el("button", { class: "seg" + (mode==="strip"?" on":""), title: "Forward 12 months" }, "Forward 12-mo");
    monthBtn.addEventListener("click", () => { mode = "month"; App.rerender(); });
    stripBtn.addEventListener("click", () => { mode = "strip"; App.rerender(); });
    right.append(H.el("div", { class: "seg-group" })); 
    right.firstChild.append(monthBtn, stripBtn);

    bar.append(left, right);
    return bar;
  }

  function stepMonth(delta) {
    const s = State.get();
    const d = new Date(s.calendarMonth.y, s.calendarMonth.m + delta, 1);
    State.set({ calendarMonth: { y: d.getFullYear(), m: d.getMonth() } });
  }

  function render(mount, filtered) {
    mountEl = mount;
    ensureMonth();
    mount.innerHTML = "";
    mount.appendChild(toolbar());
    if (mode === "strip") mount.appendChild(renderStrip(filtered));
    else mount.appendChild(renderMonthGrid(filtered));
  }

  return { render };
})();
