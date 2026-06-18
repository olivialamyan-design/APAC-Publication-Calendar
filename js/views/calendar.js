/* =============================================================================
 * views/calendar.js — CALENDAR VIEW
 * Modes:
 *   - "triple" (DEFAULT, 2026-06-18): three months side by side on desktop,
 *     horizontal swipe between months on mobile. Shows current + next 2 months.
 *   - "month": classic single-month grid (still available via the toggle).
 *   - "strip": forward-12-month list.
 * Publications coloured by report scope. Public holidays render as a SEPARATE
 * secondary layer: a faint shaded day-cell background + small flag marker.
 * Click an event -> detail panel.
 * =========================================================================== */
const CalendarView = (() => {
  let mountEl = null;
  let mode = "triple";   // triple | month | strip

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

  // -------- styling for a calendar event pill (scope colour) --------
  function eventPill(p) {
    const c = DataLayer.colourFor(p);
    const cls = "cal-evt" + (p.recurring ? " is-recurring" : "");
    const pill = H.el("button", {
      class: cls,
      style: `background:${c.fill};color:${c.text};`,
      "data-id": p.id,
      title: `${p.publication_name} — ${p.country}${p.recurring ? " (recurring)" : ""}`
    }, (p.recurring ? '<span class="cal-evt-rec" aria-hidden="true">↻</span> ' : "") + H.esc(p.publication_name));
    pill.addEventListener("click", e => { e.stopPropagation(); Detail.open(p.id); });
    return pill;
  }

  // -------- resolve active holidays for a given ISO date --------
  function holidaysFor(iso) {
    if (typeof Holidays === "undefined") return [];
    const s = State.get();
    if (!s.holidaysOn) return [];
    return Holidays.forDate(iso, s.holidayMarkets);
  }

  // -------- build ONE month block (weekday header + day grid) --------
  // Shared by the single-month and triple-month layouts.
  // maxPerCell controls density (triple view is denser, so show fewer pills).
  function buildMonthBlock(y, m, evts, opts = {}) {
    const today = State.todayISO();
    const maxPerCell = opts.maxPerCell || 4;

    const block = H.el("div", { class: "cal-month" + (opts.compact ? " cal-month-compact" : "") });

    // month caption (used in triple view; single view has its own toolbar title)
    if (opts.showCaption) {
      block.appendChild(H.el("div", { class: "cal-month-cap" }, `${H.MONTHS[m]} ${y}`));
    }

    const wk = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const head = H.el("div", { class: "cal-weekhead" });
    wk.forEach(d => head.appendChild(H.el("div", { class: "cal-wk" }, d)));
    block.appendChild(head);

    const grid = H.el("div", { class: "cal-grid" });
    const first = new Date(y, m, 1);
    let startOffset = (first.getDay() + 6) % 7;     // Mon=0
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

      // ---- holiday layer (secondary): shade the cell + flag marker ----
      const hols = c.out ? [] : holidaysFor(iso);
      if (hols.length) {
        cell.classList.add("is-holiday");
        const names = hols.map(h => `${h.market}: ${h.name}`).join("\n");
        cell.setAttribute("title", names);
      }

      const top = H.el("div", { class: "cal-cell-top" });
      const dnum = H.el("div", { class: "cal-daynum" }, String(c.day));
      if (isToday) dnum.classList.add("is-today");
      top.appendChild(dnum);
      if (hols.length) {
        const flag = H.el("span", { class: "cal-hol-flag", title: hols.map(h => `${h.market}: ${h.name}`).join("\n") },
          `⚑${hols.length > 1 ? `<span class="cal-hol-n">${hols.length}</span>` : ""}`);
        top.appendChild(flag);
      }
      cell.appendChild(top);

      // holiday name label (only on in-month days, kept subdued + separate)
      if (hols.length && !opts.compact) {
        const hl = H.el("div", { class: "cal-hol-label", title: hols.map(h => `${h.market}: ${h.name}`).join("\n") },
          H.esc(hols[0].name) + (hols.length > 1 ? ` +${hols.length - 1}` : ""));
        cell.appendChild(hl);
      } else if (hols.length && opts.compact) {
        const hl = H.el("div", { class: "cal-hol-label cal-hol-label-sm",
          title: hols.map(h => `${h.market}: ${h.name}`).join("\n") },
          H.esc(hols.length > 1 ? `${hols.length} holidays` : hols[0].name));
        cell.appendChild(hl);
      }

      const dayEvts = evts[iso] || [];
      const list = H.el("div", { class: "cal-evts" });
      dayEvts.slice(0, maxPerCell).forEach(p => list.appendChild(eventPill(p)));
      if (dayEvts.length > maxPerCell) {
        const more = H.el("button", { class: "cal-more" }, `+${dayEvts.length - maxPerCell} more`);
        more.addEventListener("click", () => Detail.openList(dayEvts, iso));
        list.appendChild(more);
      }
      cell.appendChild(list);
      grid.appendChild(cell);
    });
    block.appendChild(grid);
    return block;
  }

  // -------- single-month grid --------
  function renderMonthGrid(filtered) {
    const s = State.get();
    const { y, m } = s.calendarMonth;
    const evts = eventsByDate(filtered);
    const wrap = H.el("div", { class: "cal-single" });
    wrap.appendChild(buildMonthBlock(y, m, evts, { maxPerCell: 4 }));
    return wrap;
  }

  // -------- triple-month (3-up desktop / swipe mobile) --------
  function renderTriple(filtered) {
    const s = State.get();
    const base = s.calendarMonth;            // anchor = first of the three months
    const evts = eventsByDate(filtered);
    const wrap = H.el("div", { class: "cal-triple", role: "group", "aria-label": "Three-month calendar" });
    for (let i = 0; i < 3; i++) {
      const d = new Date(base.y, base.m + i, 1);
      const pane = H.el("div", { class: "cal-triple-pane" });
      pane.appendChild(buildMonthBlock(d.getFullYear(), d.getMonth(), evts,
        { compact: true, showCaption: true, maxPerCell: 3 }));
      wrap.appendChild(pane);
    }
    return wrap;
  }

  // -------- forward-12-month strip --------
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
        const c2 = DataLayer.colourFor(p);
        const row = H.el("button", {
          class: "strip-evt" + (p.recurring ? " is-recurring" : ""),
          style: `border-left-color:${c2.fill};`,
          "data-id": p.id
        }, `<span class="strip-date">${H.parseISO(p.expected_publication_date).getDate()}</span>
            <span class="strip-name">${p.recurring ? '<span class="strip-rec">↻</span> ' : ''}${H.esc(p.publication_name)}</span>
            <span class="mkt-dot" style="background:${c2.fill}"></span>`);
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
    const prev = H.el("button", { class: "btn-icon", title: mode === "triple" ? "Previous month" : "Previous month" }, "‹");
    const next = H.el("button", { class: "btn-icon", title: "Next month" }, "›");
    const todayBtn = H.el("button", { class: "btn-ghost" }, "Today");
    prev.addEventListener("click", () => stepMonth(-1));
    next.addEventListener("click", () => stepMonth(1));
    todayBtn.addEventListener("click", () => {
      const n = new Date();
      State.set({ calendarMonth: { y: n.getFullYear(), m: n.getMonth() } });
    });

    const picker = H.el("input", { type: "month", class: "cal-monthpick",
      value: `${y}-${String(m+1).padStart(2,"0")}` });
    picker.addEventListener("change", e => {
      const [yy, mm] = e.target.value.split("-").map(Number);
      State.set({ calendarMonth: { y: yy, m: mm - 1 } });
    });

    // Title: triple view spans 3 months, so show a range.
    let titleTxt;
    if (mode === "triple") {
      const end = new Date(y, m + 2, 1);
      titleTxt = `${H.MONTHS_SHORT[m]} – ${H.MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
    } else {
      titleTxt = `${H.MONTHS[m]} ${y}`;
    }
    left.append(prev, next, todayBtn,
      H.el("div", { class: "cal-title" }, titleTxt), picker);

    const right = H.el("div", { class: "cal-tb-right" });
    const grp = H.el("div", { class: "seg-group" });
    const tripleBtn = H.el("button", { class: "seg" + (mode==="triple"?" on":""), title: "Three months" }, "3 Months");
    const monthBtn = H.el("button", { class: "seg" + (mode==="month"?" on":"") }, "Month");
    const stripBtn = H.el("button", { class: "seg" + (mode==="strip"?" on":""), title: "Forward 12 months" }, "Forward 12-mo");
    tripleBtn.addEventListener("click", () => { mode = "triple"; App.rerender(); });
    monthBtn.addEventListener("click", () => { mode = "month"; App.rerender(); });
    stripBtn.addEventListener("click", () => { mode = "strip"; App.rerender(); });
    grp.append(tripleBtn, monthBtn, stripBtn);
    right.append(grp);

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
    else if (mode === "month") mount.appendChild(renderMonthGrid(filtered));
    else mount.appendChild(renderTriple(filtered));
  }

  return { render, mode: () => mode };
})();
