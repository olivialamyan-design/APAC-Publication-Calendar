/* =============================================================================
 * views/calendar.js — CALENDAR VIEW
 * Modes:
 *   - "dual" (DEFAULT, 2026-06-19): TWO months side by side on desktop,
 *     one month at a time with horizontal swipe on tablet/mobile. Default
 *     range = current month + next month.
 *   - "month": classic single-month grid (still available via the toggle).
 *   - "strip": forward-12-month list.
 * Publications coloured by report scope. Public holidays render as full-width
 * pale rows (#EEE8E3) INSIDE the day cell, BELOW the publication items, in the
 * format "Market - Holiday Name".
 * Click an event -> detail panel.
 *
 * Savills events layer (2026-10-29): pink pills/bars rendered ABOVE the
 * publication pills in every day cell (all three modes). Events come from
 * SavillsEvents (js/events.js), ignore the filter bar, and are capped
 * separately from publications (2 in 2-Months, 4 in Month). Multi-day events
 * are laid out in per-week "lanes" so each event keeps the same vertical slot
 * across the days it spans and reads as one continuous bar; the name shows on
 * the first cell of each week segment. Click -> EventPopover (not the panel).
 * =========================================================================== */
const CalendarView = (() => {
  let mountEl = null;
  let mode = "dual";   // dual | month | strip

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
    const cls = "cal-evt" + (p.recurring ? " is-recurring" : "") + (p.published ? " is-published" : "");
    const pill = H.el("button", {
      class: cls,
      style: `background:${c.fill};color:${c.text};`,
      "data-id": p.id,
      title: `${p.publication_name} — ${p.country}${p.recurring ? " (recurring, " + (p.date_confidence || "Estimated").toLowerCase() + ")" : ""}${p.published ? " (published)" : ""}`
    }, (p.recurring ? '<span class="cal-evt-rec" aria-hidden="true">↻</span> ' : "") +
       (p.published ? '<span class="cal-evt-pub" aria-label="Published">✓</span> ' : "") + H.esc(p.publication_name));
    pill.addEventListener("click", e => { e.stopPropagation(); Detail.open(p.id); });
    return pill;
  }

  // -------- Savills events (2026-10-29) --------
  function eventsFor(iso) {
    return (typeof SavillsEvents !== "undefined") ? SavillsEvents.forDate(iso) : [];
  }

  // Assign each event a lane (vertical slot) within one 7-day week row so a
  // multi-day bar stays aligned across the days it spans.
  // Returns an array (per column) of { lanes: [ev|undefined...], all: [ev...] }.
  function layoutWeek(isos) {
    const seen = new Map();
    isos.forEach(iso => eventsFor(iso).forEach(ev => { if (!seen.has(ev.id)) seen.set(ev.id, ev); }));
    const evs = Array.from(seen.values()).sort((a, b) =>
      a.start_date.localeCompare(b.start_date) ||
      b.end_date.localeCompare(a.end_date) ||
      a.name.localeCompare(b.name));
    const cols = isos.map(() => ({ lanes: [], all: [] }));
    evs.forEach(ev => {
      const span = [];
      isos.forEach((iso, i) => { if (iso >= ev.start_date && iso <= ev.end_date) span.push(i); });
      let lane = 0;
      while (span.some(i => cols[i].lanes[lane])) lane++;
      span.forEach(i => { cols[i].lanes[lane] = ev; cols[i].all.push(ev); });
    });
    return cols;
  }

  // One pink pill / bar segment for an event in a given cell.
  function sevPill(ev, iso, col) {
    const segStart = iso === ev.start_date || col === 0;   // first cell of week segment
    let cls = "cal-evt cal-sev";
    if (iso !== ev.start_date) cls += " sev-cont-l";        // continues from the left
    if (iso !== ev.end_date)   cls += " sev-cont-r";        // continues to the right
    const range = SavillsEvents.fmtRange(ev);
    const pill = H.el("button", {
      class: cls, type: "button",
      "data-ev-id": ev.id,
      "aria-haspopup": "dialog", "aria-expanded": "false",
      "aria-label": `Savills event: ${ev.name}, ${range}${segStart ? "" : " (continued)"}`,
      title: `${ev.name} — ${range}`,
      tabindex: segStart ? null : "-1"
    }, segStart ? H.esc(ev.name) : "&nbsp;");
    pill.addEventListener("click", e => { e.stopPropagation(); EventPopover.open(ev, pill); });
    return pill;
  }

  // The event block for one cell: lanes < cap rendered (with invisible spacers
  // to hold alignment), events in lanes >= cap counted into "+N more events".
  function buildSevBlock(iso, col, layout, cap) {
    if (!layout || !layout.all.length) return null;
    const wrap = H.el("div", { class: "cal-sevs" });
    let lastShown = -1;
    for (let l = 0; l < Math.min(cap, layout.lanes.length); l++) if (layout.lanes[l]) lastShown = l;
    for (let l = 0; l <= lastShown; l++) {
      const ev = layout.lanes[l];
      if (ev) wrap.appendChild(sevPill(ev, iso, col));
      else wrap.appendChild(H.el("span", { class: "cal-evt cal-sev cal-sev-spacer", "aria-hidden": "true" }, "&nbsp;"));
    }
    const hidden = layout.all.filter(ev => layout.lanes.indexOf(ev) >= cap).length;
    if (hidden > 0) {
      const all = eventsFor(iso);
      const more = H.el("button", {
        class: "cal-more-sev", type: "button",
        "aria-haspopup": "dialog", "aria-expanded": "false",
        title: `Show all ${all.length} Savills events on ${H.fmtLong(iso)}`
      }, `+${hidden} more event${hidden > 1 ? "s" : ""}`);
      more.addEventListener("click", e => { e.stopPropagation(); EventPopover.openList(all, iso, more); });
      wrap.appendChild(more);
    }
    return wrap;
  }

  // -------- resolve active holidays for a given ISO date --------
  function holidaysFor(iso) {
    if (typeof Holidays === "undefined") return [];
    const s = State.get();
    if (!s.holidaysOn) return [];
    return Holidays.forDate(iso, s.holidayMarkets);
  }

  // -------- build ONE month block (weekday header + day grid) --------
  // Shared by the single-month and dual-month layouts.
  // maxPerCell controls density (dual view is denser, so show fewer pills).
  function buildMonthBlock(y, m, evts, opts = {}) {
    const today = State.todayISO();
    const maxPerCell = opts.maxPerCell || 4;

    const block = H.el("div", { class: "cal-month" + (opts.compact ? " cal-month-compact" : "") });

    // month caption (used in dual view; single view has its own toolbar title)
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

    const isoOf = c => {
      const cy = c.m < 0 ? y - 1 : c.m > 11 ? y + 1 : y;
      const cm = (c.m + 12) % 12;
      return `${cy}-${String(cm+1).padStart(2,"0")}-${String(c.day).padStart(2,"0")}`;
    };
    // Savills events: lay out lanes per week row (7 cells at a time).
    const sevLayout = [];
    for (let w = 0; w < cells.length; w += 7) {
      layoutWeek(cells.slice(w, w + 7).map(isoOf)).forEach(l => sevLayout.push(l));
    }

    cells.forEach((c, idx) => {
      const iso = isoOf(c);
      const cell = H.el("div", { class: "cal-cell" + (c.out ? " out" : "") });
      const isToday = iso === today;
      if (isToday) cell.classList.add("today");

      // ---- resolve holidays (rendered as full-width rows below items) ----
      const hols = c.out ? [] : holidaysFor(iso);
      if (hols.length) cell.classList.add("has-holiday");

      const top = H.el("div", { class: "cal-cell-top" });
      const dnum = H.el("div", { class: "cal-daynum" }, String(c.day));
      if (isToday) dnum.classList.add("is-today");
      top.appendChild(dnum);
      cell.appendChild(top);

      // ---- Savills events ABOVE publications (separate cap) ----
      const sevBlock = buildSevBlock(iso, idx % 7, sevLayout[idx], maxPerCell);
      if (sevBlock) { cell.appendChild(sevBlock); cell.classList.add("has-sev"); }

      // ---- publication items first: show only 1-2, then "+N more" ----
      const dayEvts = evts[iso] || [];
      const list = H.el("div", { class: "cal-evts" });
      dayEvts.slice(0, maxPerCell).forEach(p => list.appendChild(eventPill(p)));
      if (dayEvts.length > maxPerCell) {
        const more = H.el("button", { class: "cal-more" }, `+${dayEvts.length - maxPerCell} more`);
        more.addEventListener("click", () => Detail.openList(dayEvts, iso));
        list.appendChild(more);
      }
      cell.appendChild(list);

      // ---- holidays AFTER publications: full-width pale rows in the cell ----
      // Each row reads "Market - Holiday Name"; click opens the day list.
      if (hols.length) {
        const holWrap = H.el("div", { class: "cal-hols" });
        const maxHol = opts.compact ? 1 : 2;
        hols.slice(0, maxHol).forEach(h => {
          holWrap.appendChild(H.el("div", { class: "cal-hol-row",
            title: `${h.market} - ${h.name}` },
            `${H.esc(h.market)} - ${H.esc(h.name)}`));
        });
        if (hols.length > maxHol) {
          // 2026-10-29: custom hover / focus / tap card (HolidayPopover)
          // replaces the slow, touch-invisible native title tooltip. The card
          // lists ALL holidays for the day, including the visible rows.
          const n = hols.length - maxHol;
          const more = H.el("div", { class: "cal-hol-row cal-hol-more",
            "aria-label": `${n} more holiday${n > 1 ? "s" : ""} on ${H.fmtLong(iso)} — show all ${hols.length}` },
            `+${n} more holiday${n > 1 ? "s" : ""}`);
          HolidayPopover.attach(more, iso, hols);
          holWrap.appendChild(more);
        }
        cell.appendChild(holWrap);
      }

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

  // -------- dual-month (2-up desktop / 1-month swipe on tablet+mobile) --------
  function renderDual(filtered) {
    const s = State.get();
    const base = s.calendarMonth;            // anchor = first of the two months
    const evts = eventsByDate(filtered);
    const wrap = H.el("div", { class: "cal-dual", role: "group", "aria-label": "Two-month calendar" });
    for (let i = 0; i < 2; i++) {
      const d = new Date(base.y, base.m + i, 1);
      const pane = H.el("div", { class: "cal-dual-pane" });
      pane.appendChild(buildMonthBlock(d.getFullYear(), d.getMonth(), evts,
        { compact: true, showCaption: true, maxPerCell: 2 }));
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

      // Savills events overlapping this month (ignore filters), keyed by the
      // first day of the event that falls inside the month.
      const mStart = `${y}-${String(m+1).padStart(2,"0")}-01`;
      const mEnd   = `${y}-${String(m+1).padStart(2,"0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2,"0")}`;
      const monthSevs = (typeof SavillsEvents !== "undefined" ? SavillsEvents.all() : [])
        .filter(ev => ev.start_date <= mEnd && ev.end_date >= mStart)
        .map(ev => ({ kind: "sev", ev, key: ev.start_date < mStart ? mStart : ev.start_date }));
      // Interleave by date; events sort before publications on the same day.
      const items = monthSevs.concat(monthEvts.map(p => ({ kind: "pub", p, key: p.expected_publication_date })))
        .sort((a, b) => a.key.localeCompare(b.key) || (a.kind === b.kind ? 0 : a.kind === "sev" ? -1 : 1));

      const col = H.el("div", { class: "strip-month" });
      col.appendChild(H.el("div", { class: "strip-head" },
        `${H.MONTHS_SHORT[m]} ${y} <span class="strip-count">${items.length}</span>`));
      const body = H.el("div", { class: "strip-body" });
      if (!items.length) body.appendChild(H.el("div", { class: "strip-empty" }, "—"));
      items.forEach(it => {
        if (it.kind === "sev") {
          const ev = it.ev;
          const row = H.el("button", {
            class: "strip-evt strip-sev", type: "button",
            "data-ev-id": ev.id, "aria-haspopup": "dialog", "aria-expanded": "false",
            title: `Savills event: ${ev.name} — ${SavillsEvents.fmtRange(ev)}`
          }, `<span class="strip-date">${H.parseISO(it.key).getDate()}</span>
              <span class="strip-name">${H.esc(ev.name)}${ev.multi_day ? ` <span class="strip-sev-range">(${H.esc(SavillsEvents.fmtRange(ev))})</span>` : ""}</span>
              <span class="mkt-dot sev-dot"></span>`);
          row.addEventListener("click", e => { e.stopPropagation(); EventPopover.open(ev, row); });
          body.appendChild(row);
          return;
        }
        const p = it.p;
        const c2 = DataLayer.colourFor(p);
        const row = H.el("button", {
          class: "strip-evt" + (p.recurring ? " is-recurring" : "") + (p.published ? " is-published" : ""),
          style: `border-left-color:${c2.fill};`,
          "data-id": p.id
        }, `<span class="strip-date">${H.parseISO(p.expected_publication_date).getDate()}</span>
            <span class="strip-name">${p.recurring ? '<span class="strip-rec">↻</span> ' : ''}${p.published ? '<span class="cal-evt-pub" aria-label="Published">✓</span> ' : ''}${H.esc(p.publication_name)}</span>
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
    const prev = H.el("button", { class: "btn-icon", title: "Previous month" }, "‹");
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

    // Title: dual view spans 2 months, so show a range.
    let titleTxt;
    if (mode === "dual") {
      const end = new Date(y, m + 1, 1);
      titleTxt = `${H.MONTHS_SHORT[m]} – ${H.MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
    } else {
      titleTxt = `${H.MONTHS[m]} ${y}`;
    }
    left.append(prev, next, todayBtn,
      H.el("div", { class: "cal-title" }, titleTxt), picker);

    const right = H.el("div", { class: "cal-tb-right" });
    const grp = H.el("div", { class: "seg-group" });
    const dualBtn = H.el("button", { class: "seg" + (mode==="dual"?" on":""), title: "Two months" }, "2 Months");
    const monthBtn = H.el("button", { class: "seg" + (mode==="month"?" on":"") }, "Month");
    const stripBtn = H.el("button", { class: "seg" + (mode==="strip"?" on":""), title: "Forward 12 months" }, "Forward 12-mo");
    dualBtn.addEventListener("click", () => { mode = "dual"; App.rerender(); });
    monthBtn.addEventListener("click", () => { mode = "month"; App.rerender(); });
    stripBtn.addEventListener("click", () => { mode = "strip"; App.rerender(); });
    grp.append(dualBtn, monthBtn, stripBtn);
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
    if (typeof Popover !== "undefined") Popover.hideAll();   // anchors are about to be replaced
    ensureMonth();
    mount.innerHTML = "";
    mount.appendChild(toolbar());
    if (mode === "strip") mount.appendChild(renderStrip(filtered));
    else if (mode === "month") mount.appendChild(renderMonthGrid(filtered));
    else mount.appendChild(renderDual(filtered));
  }

  return { render, mode: () => mode };
})();
